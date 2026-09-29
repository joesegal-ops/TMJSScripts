#!/usr/bin/env python3
"""
Quote COST + SELL per quote -> raw.quote_costs.

Why this exists: the cost of won work mostly lives on the QUOTE, not the job. Measured 2026-09-29:
of 2,899 upgraded quotes, only 627 (21.6%) of the resulting jobs carry any cost in JobLogic, so
raw.job_costs alone can't produce a margin. `Quote/getall` returns only QuoteValue* (both SELL).
The detail endpoint GET /api/v1/Quote/GetById?includeLines=true returns the lines, and each line
carries Cost/Sell -- that is the missing half of the margin.

`Lines` is a DICT of 8 category arrays (MaterialLines, LabourLines, SubcontractorLines,
TravelLines, CalloutLines, ExpenseLines, OtherLines, ScheduleOfRatesLines), NOT a list. With
includeLines omitted or false it comes back null, which is why load_quote_types.py never saw it.

Modes (env JL_QC_MODE):
  full -> every quote Id in raw.quotes; WRITE_TRUNCATE (also picks up edited quotes)
  incr -> only quote Ids not already in raw.quote_costs; WRITE_APPEND (new quotes)
Incr never revisits a quote, so lines edited after the first fetch are only corrected by the
weekly full -- same trade-off as load_quote_types.py.

Creds from env (run_quote_costs.sh pulls them from Secret Manager). BigQuery auth = ADC.
NOTE: the JL API is IP-whitelisted to the loader VM; this cannot run from a laptop.
"""
import datetime as dt
import json
import logging
import os
import sys
import tempfile
import time

import requests
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger("quote_costs")


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and not v:
        log.error("missing required env %s", name); sys.exit(2)
    return v


TOKEN_URL = env("JL_TOKEN_URL", "https://identityservice.joblogic.com/connect/token")
API_BASE  = env("JL_API_BASE", "https://api.joblogic.com")
SCOPE     = env("JL_SCOPE", "JL.Api")
CLIENT_ID = env("JL_CLIENT_ID", required=True)
CLIENT_SECRET = env("JL_CLIENT_SECRET", required=True)
TENANT_ID = env("JL_TENANT_ID", required=True)

BQ_PROJECT = env("BQ_PROJECT", "vmimporteddata")
BQ_DATASET = env("BQ_DATASET", "raw")
TABLE = f"{BQ_PROJECT}.{BQ_DATASET}.quote_costs"

MODE = env("JL_QC_MODE", "incr").strip().lower()
RATE_MIN_INTERVAL = float(env("JL_MIN_INTERVAL", "0.65"))   # ~92 req/min, under the 100 cap
HTTP_TIMEOUT = int(env("JL_HTTP_TIMEOUT", "60"))
MAX_RETRIES = int(env("JL_MAX_RETRIES", "5"))
KEEP_LINES = env("JL_QC_KEEP_LINES", "1") == "1"            # store the raw line JSON too
LIMIT = int(env("JL_QC_LIMIT", "0"))                        # >0 = stop after N quotes (smoke test)


# Private per-run temp file. NOT a fixed /tmp path: the VM runs fs.protected_regular=2, which
# blocks re-opening a sticky-/tmp file owned by another user, including as root -- that silently
# killed the quote_types cron for a week in Jul 2026.
def _default_out():
    fd, path = tempfile.mkstemp(prefix="quote_costs_", suffix=".jsonl")
    os.close(fd)
    return path


OUT = env("JL_QC_OUT") or _default_out()

# Lines dict key -> our column suffix
CATEGORIES = {
    "MaterialLines": "material", "LabourLines": "labour",
    "SubcontractorLines": "subcontractor", "TravelLines": "travel",
    "CalloutLines": "callout", "ExpenseLines": "expense",
    "OtherLines": "other", "ScheduleOfRatesLines": "sor",
}

_last = [0.0]


def _pace():
    wait = RATE_MIN_INTERVAL - (time.monotonic() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.monotonic()


def get_token():
    r = requests.post(TOKEN_URL, data={
        "grant_type": "client_credentials", "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET, "scope": SCOPE,
    }, headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    return r.json()["access_token"], time.monotonic()


def get_by_id(qid, token):
    url = f"{API_BASE}/api/v1/Quote/GetById"
    params = {"id": qid, "tenantId": TENANT_ID, "includeLines": "true"}
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    for attempt in range(1, MAX_RETRIES + 1):
        _pace()
        try:
            r = requests.get(url, params=params, headers=headers, timeout=HTTP_TIMEOUT)
        except requests.RequestException as e:
            wait = min(2 ** attempt, 30)
            log.warning("%s on quote %s (try %s/%s) wait %ss", type(e).__name__, qid,
                        attempt, MAX_RETRIES, wait)
            time.sleep(wait); continue
        if r.status_code == 429 or r.status_code >= 500:
            wait = min(2 ** attempt, 30)
            log.warning("HTTP %s on quote %s (try %s/%s) wait %ss", r.status_code, qid,
                        attempt, MAX_RETRIES, wait)
            time.sleep(wait); continue
        if r.status_code == 404:
            return None
        r.raise_for_status()
        body = r.json()
        return body.get("Data") or body.get("data") or body
    return None


def _num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def line_money(ln, kind):
    """cost/sell for one line. Field names vary by category, so fall back to unit x qty.
    Returns (value, resolved) -- resolved=False means we could not find a figure at all."""
    if kind == "cost":
        keys, unit = ("TotalCostExcludingVat", "TotalCost", "CostExcludingVat"), "Cost"
    else:
        keys, unit = ("TotalSellExcludingVat", "TotalSell", "SellExcludingVat"), "Sell"
    for k in keys:
        v = _num(ln.get(k))
        if v is not None:
            return v, True
    u = _num(ln.get(unit))
    if u is not None:
        q = _num(ln.get("Quantity"))
        return u * (q if q is not None else 1.0), True
    return 0.0, False


def summarise(it):
    lines = it.get("Lines")
    if not isinstance(lines, dict):
        return None                      # includeLines didn't take, or quote has no line block
    out = {"n_lines": 0, "n_lines_no_cost": 0,
           "total_cost_exvat": 0.0, "total_sell_exvat": 0.0}
    for suffix in CATEGORIES.values():
        out[f"cost_{suffix}"] = 0.0
        out[f"sell_{suffix}"] = 0.0
    for key, suffix in CATEGORIES.items():
        arr = lines.get(key)
        if not isinstance(arr, list):
            continue
        for ln in arr:
            if not isinstance(ln, dict):
                continue
            c, c_ok = line_money(ln, "cost")
            s, _    = line_money(ln, "sell")
            out["n_lines"] += 1
            if not c_ok:
                out["n_lines_no_cost"] += 1
            out[f"cost_{suffix}"] += c
            out[f"sell_{suffix}"] += s
            out["total_cost_exvat"] += c
            out["total_sell_exvat"] += s
    return out


def ids_to_fetch(client):
    if MODE == "full":
        q = f"SELECT Id, QuoteNumber FROM `{BQ_PROJECT}.{BQ_DATASET}.quotes` WHERE Id IS NOT NULL"
    else:
        q = f"""
        SELECT q.Id, q.QuoteNumber
        FROM `{BQ_PROJECT}.{BQ_DATASET}.quotes` q
        WHERE q.Id IS NOT NULL
          AND q.Id NOT IN (SELECT quote_id FROM `{TABLE}`)
        """
    rows = [(r.Id, r.QuoteNumber) for r in client.query(q).result()]
    return rows[:LIMIT] if LIMIT else rows


SCHEMA = [
    bigquery.SchemaField("quote_id", "INTEGER"),
    bigquery.SchemaField("quote_number", "STRING"),
    bigquery.SchemaField("quote_status", "STRING"),
    bigquery.SchemaField("is_upgraded", "BOOL"),
    bigquery.SchemaField("parent_job_number", "STRING"),
    bigquery.SchemaField("date_logged", "TIMESTAMP"),
    bigquery.SchemaField("approved_datetime", "TIMESTAMP"),
    bigquery.SchemaField("quote_value_exvat", "FLOAT"),   # header sell, for cross-checking
    bigquery.SchemaField("total_cost_exvat", "FLOAT"),
    bigquery.SchemaField("total_sell_exvat", "FLOAT"),
    bigquery.SchemaField("n_lines", "INTEGER"),
    bigquery.SchemaField("n_lines_no_cost", "INTEGER"),   # self-diagnosing: >0 = unmapped field
] + [bigquery.SchemaField(f"{m}_{s}", "FLOAT")
     for s in CATEGORIES.values() for m in ("cost", "sell")] + [
    bigquery.SchemaField("lines_json", "STRING"),
    bigquery.SchemaField("_ingested_at", "TIMESTAMP"),
]


def main():
    client = bigquery.Client(project=BQ_PROJECT)
    try:
        ids = ids_to_fetch(client)
    except Exception as e:
        if MODE != "full" and "Not found" in str(e):
            log.warning("quote_costs missing; running FULL instead")
            globals()["MODE"] = "full"
            ids = ids_to_fetch(client)
        else:
            raise
    log.info("mode=%s quotes to fetch=%s (~%.0f min at %.2fs/req)",
             MODE, len(ids), len(ids) * RATE_MIN_INTERVAL / 60, RATE_MIN_INTERVAL)
    if not ids:
        log.info("nothing to do"); return

    token, t0 = get_token()
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    n = skipped = no_cost_lines = 0
    with open(OUT, "w") as f:
        for qid, qnum in ids:
            if time.monotonic() - t0 > 3000:          # token ~1h TTL; refresh at 50 min
                token, t0 = get_token()
            it = get_by_id(qid, token)
            if not isinstance(it, dict):
                skipped += 1; continue
            s = summarise(it)
            if s is None:
                skipped += 1; continue
            no_cost_lines += s["n_lines_no_cost"]
            row = {
                "quote_id": qid,
                "quote_number": it.get("QuoteNumber") or qnum,
                "quote_status": it.get("QuoteStatusDescription"),
                "is_upgraded": it.get("IsUpgraded"),
                "parent_job_number": it.get("ParentJobStringId"),
                "date_logged": it.get("DateLogged"),
                "approved_datetime": it.get("ApprovedDatetime"),
                "quote_value_exvat": it.get("QuoteValueExcludingVat"),
                "lines_json": json.dumps(it.get("Lines")) if KEEP_LINES else None,
                "_ingested_at": now,
            }
            row.update(s)
            f.write(json.dumps(row, default=str) + "\n")
            n += 1
            if n % 250 == 0:
                log.info("%s/%s", n, len(ids))
    log.info("fetched %s rows (%s skipped); loading BQ (%s)...", n, skipped, MODE)
    if no_cost_lines:
        log.warning("%s line(s) had no recognisable cost field -- check n_lines_no_cost in the "
                    "table and extend line_money() if a category uses different names",
                    no_cost_lines)
    if not n:
        log.error("0 rows fetched; refusing to load"); sys.exit(1)

    cfg = bigquery.LoadJobConfig(
        schema=SCHEMA, source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=(bigquery.WriteDisposition.WRITE_TRUNCATE
                           if MODE == "full" and not LIMIT
                           else bigquery.WriteDisposition.WRITE_APPEND),
    )
    with open(OUT, "rb") as f:
        client.load_table_from_file(f, TABLE, job_config=cfg).result()
    log.info("loaded %s: %s rows (%s)", TABLE, n, MODE)
    if not os.environ.get("JL_QC_OUT"):
        try:
            os.unlink(OUT)
        except OSError:
            pass


if __name__ == "__main__":
    main()
