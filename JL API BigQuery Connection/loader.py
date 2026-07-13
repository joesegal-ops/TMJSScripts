"""
Joblogic API -> BigQuery raw-layer loader (VM edition).

Confirmed pattern (verified live 2026-07-03):
  token: POST https://identityservice.joblogic.com/connect/token
         (grant_type=client_credentials, scope=JL.Api)  -> Bearer, ~1h TTL
  list:  POST https://api.joblogic.com/api/v1/<Entity>/GetAll
         body {"TenantId": <guid>, "PageIndex": n(1-based), "PageSize": <=50}
         resp {"Items": [...], "TotalCount": int, "PageIndex": int, "PageSize": int}
  limits: PageSize max 50; 100 requests/min (429 + backoff).

Loads each entity verbatim into dataset `raw` (one table per entity) with a `_ingested_at`
timestamp. WRITE_TRUNCATE snapshot per run. The `models` dataset (built separately in SQL)
does typing/joins to reproduce the report tables.

Auth to BigQuery uses the VM's service account (ADC). Joblogic creds come from Secret Manager
via run.sh (exported as env vars). Config via env; sane defaults below.

Run one entity:      JL_ENTITIES=Job/getall:jobs python3 loader.py
Run the whole suite: (default JL_ENTITIES list below)
"""

import datetime as dt
import json
import logging
import os
import sys
import time
from io import BytesIO

import requests
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("jl-raw")


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and not v:
        log.error("Missing required env var: %s", name); sys.exit(2)
    return v


TOKEN_URL = env("JL_TOKEN_URL", "https://identityservice.joblogic.com/connect/token")
API_BASE  = env("JL_API_BASE", "https://api.joblogic.com")
SCOPE     = env("JL_SCOPE", "JL.Api")
CLIENT_ID = env("JL_CLIENT_ID", required=True)
CLIENT_SECRET = env("JL_CLIENT_SECRET", required=True)
TENANT_ID = env("JL_TENANT_ID", required=True)

BQ_PROJECT = env("BQ_PROJECT", "vmimporteddata")
BQ_DATASET = env("BQ_DATASET", "raw")

PAGE_SIZE = min(int(env("JL_PAGE_SIZE", "50")), 50)     # hard max 50
RATE_MIN_INTERVAL = float(env("JL_MIN_INTERVAL", "0.65"))  # ~92 req/min, under the 100 cap
HTTP_TIMEOUT = int(env("JL_HTTP_TIMEOUT", "60"))
MAX_RETRIES = int(env("JL_MAX_RETRIES", "5"))

# Date range for endpoints that require it. Data exists from 31 Jul; widen START if unsure.
START_DATE = env("JL_START_DATE", "2024-07-31T00:00:00Z")
END_DATE   = env("JL_END_DATE", dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))

# entity GetAll path : BigQuery table  (exact casing from the swagger spec).
# Default = the entities that return data today. Job/Visit/Invoice list is blocked pending
# Joblogic enabling list/search access (get-by-id works); add them here once unblocked.
DEFAULT_ENTITIES = [
    "Job/getall:jobs",
    "Invoice/getall:invoices",
    "Customer/GetAll:customers",
    "Site/GetAll:sites",
    "Quote/GetAll:quotes",
    "Asset/GetAll:assets",
    "Subcontractor/GetAll:subcontractors",
    "Supplier/GetAll:suppliers",
    "Part/GetAll:parts",
    "Staff/GetAll:staff",
    "Expense/GetAll:expenses",
    "FormsLogbook/getall:forms_logbook",
    "purchaseorder/getall:purchase_orders",
    "SubcontractorPurchaseOrder/GetAll:subcontractor_purchase_orders",
]
# Visit/GetAll is per-job (needs a job auto-id) -> handled by load_visits.py, not this list.
# Timesheet/GetAll needs StartDate+EndDate in <=7-day windows (CHUNKED_WEEKLY, run explicitly).
ENTITIES = [e for e in env("JL_ENTITIES", ",".join(DEFAULT_ENTITIES)).split(",") if e.strip()]

# Per-endpoint required search filters (merged into the request body for that entity).
# Job & Invoice need Include* flags or they return 0 (flags default to false).
PER_ENTITY_BODY = {
    "purchaseorder/getall": {"DateRaised": START_DATE},
    "SubcontractorPurchaseOrder/GetAll": {"StartDateRaised": START_DATE, "EndDateRaised": END_DATE},
    "Job/getall": {
        "IncludeReactiveJobs": True, "IncludePPMJobs": True, "IncludeInactive": True,
        "OnlyIncludePrimaryJobTrade": True, "IncludeTags": True, "IncludeContacts": True,
        "IncludeNotes": True, "OrderBy": 0,
    },
    "Invoice/getall": {
        "IncludeStandardInvoices": True, "IncludePPMInvoices": True, "IncludeCGroupInvoices": True,
        "IncludeSORInvoices": True, "IncludeRelatedJobInvoices": True, "OrderBy": 0,
    },
}
# Run-level override, e.g. JL_EXTRA_BODY='{"StartDate":"...","EndDate":"..."}'
EXTRA_BODY = json.loads(env("JL_EXTRA_BODY", "{}"))

_last_req = [0.0]


def _pace():
    wait = RATE_MIN_INTERVAL - (time.monotonic() - _last_req[0])
    if wait > 0:
        time.sleep(wait)
    _last_req[0] = time.monotonic()


def get_token():
    r = requests.post(TOKEN_URL, data={
        "grant_type": "client_credentials", "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET, "scope": SCOPE,
    }, headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    return r.json()["access_token"]


def post_page(url, token, page, extra_body=None):
    body = {"TenantId": TENANT_ID, "PageIndex": page, "PageSize": PAGE_SIZE}
    if extra_body:
        body.update(extra_body)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json",
               "Accept": "application/json"}
    for attempt in range(1, MAX_RETRIES + 1):
        _pace()
        r = requests.post(url, json=body, headers=headers, timeout=HTTP_TIMEOUT)
        if r.status_code == 429 or r.status_code >= 500:
            wait = min(2 ** attempt, 30)
            log.warning("HTTP %s on %s p%s (try %s/%s) — wait %ss",
                        r.status_code, url, page, attempt, MAX_RETRIES, wait)
            time.sleep(wait)
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def fetch_entity(path, token):
    """Page through POST /api/v1/<path>. Returns (rows, error_or_None)."""
    url = f"{API_BASE}/api/v1/{path}"
    extra = {**PER_ENTITY_BODY.get(path, {}), **EXTRA_BODY}
    rows, page = [], 1
    while True:
        try:
            body = post_page(url, token, page, extra)
        except Exception as e:
            return rows, f"{type(e).__name__}: {e}"
        items = body.get("Items") if isinstance(body, dict) else None
        if items is None:
            return rows, f"no 'Items' in response (keys={list(body)[:8] if isinstance(body,dict) else type(body)})"
        rows.extend(items)
        total = body.get("TotalCount")
        if not items or len(items) < PAGE_SIZE or (total is not None and len(rows) >= total):
            break
        page += 1
    return rows, None


CHUNKED_WEEKLY = {"Timesheet/GetAll"}  # requires StartDate/EndDate in <=7-day windows


def fetch_weekly(path, token):
    """For endpoints capped at a 7-day window: walk START_DATE..END_DATE week by week."""
    url = f"{API_BASE}/api/v1/{path}"
    start = dt.datetime.fromisoformat(START_DATE.replace("Z", "+00:00"))
    end = dt.datetime.fromisoformat(END_DATE.replace("Z", "+00:00"))
    step = dt.timedelta(days=7)
    rows, cur = [], start
    while cur < end:
        w_end = min(cur + step - dt.timedelta(seconds=1), end)
        extra = {"StartDate": cur.strftime("%Y-%m-%dT%H:%M:%SZ"),
                 "EndDate": w_end.strftime("%Y-%m-%dT%H:%M:%SZ")}
        page, wrows = 1, 0
        while True:
            try:
                body = post_page(url, token, page, extra)
            except Exception as e:
                return rows, f"{type(e).__name__}: {e} (window {extra['StartDate']})"
            # Timesheet returns a bare list per week (no Items/paging); others use {Items,TotalCount}
            if isinstance(body, list):
                rows.extend(body)
                break
            items = body.get("Items") if isinstance(body, dict) else None
            if items is None:
                return rows, f"no 'Items' (window {extra['StartDate']})"
            rows.extend(items); wrows += len(items)
            total = body.get("TotalCount")
            if not items or len(items) < PAGE_SIZE or (total is not None and wrows >= total):
                break
            page += 1
        cur += step
    return rows, None


def load_to_bq(client, table, rows, ingested_at):
    table_id = f"{BQ_PROJECT}.{BQ_DATASET}.{table}"
    if not rows:
        log.warning("  %s: 0 rows — skipping load (table left unchanged)", table_id)
        return
    for r in rows:
        if isinstance(r, dict):
            r["_ingested_at"] = ingested_at
    cfg = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition="WRITE_TRUNCATE", autodetect=True,
    )
    payload = "\n".join(json.dumps(r, default=str) for r in rows).encode("utf-8")
    job = client.load_table_from_file(BytesIO(payload), table_id, job_config=cfg)
    job.result()
    log.info("  loaded %s rows -> %s", len(rows), table_id)


def main():
    token = get_token()
    log.info("token acquired; loading %s entities", len(ENTITIES))
    client = bigquery.Client(project=BQ_PROJECT)
    ingested_at = dt.datetime.now(dt.timezone.utc).isoformat()
    summary = []
    for spec in ENTITIES:
        path, _, table = spec.partition(":")
        path, table = path.strip(), table.strip()
        log.info("== %s -> raw.%s ==", path, table)
        rows, err = fetch_weekly(path, token) if path in CHUNKED_WEEKLY else fetch_entity(path, token)
        if err:
            log.error("  %s FAILED after %s rows: %s", path, len(rows), err)
            summary.append((table, len(rows), err))
            if rows:
                load_to_bq(client, table, rows, ingested_at)  # load what we got
            continue
        load_to_bq(client, table, rows, ingested_at)
        summary.append((table, len(rows), "ok"))
    log.info("=== SUMMARY ===")
    for t, n, s in summary:
        log.info("  %-26s %8d  %s", t, n, s)


if __name__ == "__main__":
    main()
