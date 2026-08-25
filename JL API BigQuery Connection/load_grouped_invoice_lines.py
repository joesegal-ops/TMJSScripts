"""
Loader: per-job line breakdown of Customer Grouped invoices (Type 2) -> raw.customer_grouped_invoice_lines.

Customer Grouped invoices bill many jobs on one invoice; the header (in raw.invoices) has no
JobNumber. The per-job amounts live in JobLines, reachable only via:
    GET /api/v1/Invoice/CustomerGrouped/GetById?uniqueId={GUID}&tenantId={tid}
which returns JobLines[] = {JobNumber, JobUniqueId, TotalExcludingVat, ...}. We explode those into
one row per (grouped invoice, job line) so the models can net grouped billing off per job.

Modes (JL_MODE):
  full    : fetch every Type-2 invoice; load to staging then swap in (won't replace on high failure)
  incr    : fetch only Type-2 invoices not yet captured OR raised in the last JL_INCREMENTAL_DAYS days;
            upsert those (delete+insert by grouped invoice uid)

Auth + pacing mirror the other loaders. Read-only against Joblogic; writes only its own BQ table.
"""
import os, json, time, datetime as dt
from io import BytesIO
import requests
from google.cloud import bigquery

TID  = os.environ["JL_TENANT_ID"]; CID = os.environ["JL_CLIENT_ID"]; CSEC = os.environ["JL_CLIENT_SECRET"]
PROJECT = os.environ.get("BQ_PROJECT", "vmimporteddata")
APIV = "https://api.joblogic.com/api/v1"
TOKEN_URL = "https://identityservice.joblogic.com/connect/token"
MODE = os.environ.get("JL_MODE", "incr")
DAYS = int(os.environ.get("JL_INCREMENTAL_DAYS", "21"))
PACE = float(os.environ.get("JL_MIN_INTERVAL", "0.65"))
TABLE = f"{PROJECT}.raw.customer_grouped_invoice_lines"

SCHEMA = [
    bigquery.SchemaField("grouped_invoice_uid", "STRING"),
    bigquery.SchemaField("grouped_invoice_number", "STRING"),
    bigquery.SchemaField("grouped_invoice_id", "INT64"),
    bigquery.SchemaField("date_raised", "TIMESTAMP"),
    bigquery.SchemaField("line_uid", "STRING"),
    bigquery.SchemaField("job_number", "STRING"),
    bigquery.SchemaField("job_unique_id", "STRING"),
    bigquery.SchemaField("description", "STRING"),
    bigquery.SchemaField("quantity", "FLOAT64"),
    bigquery.SchemaField("price_per_unit", "FLOAT64"),
    bigquery.SchemaField("total_excl_vat", "FLOAT64"),
    bigquery.SchemaField("total_incl_vat", "FLOAT64"),
    bigquery.SchemaField("total_vat", "FLOAT64"),
    bigquery.SchemaField("_ingested_at", "TIMESTAMP"),
]

_tok = {"v": None, "t": 0.0}
def token():
    if _tok["v"] is None or time.time() - _tok["t"] > 2700:
        r = requests.post(TOKEN_URL, data={"grant_type": "client_credentials",
            "client_id": CID, "client_secret": CSEC, "scope": "JL.Api"}, timeout=60)
        r.raise_for_status(); _tok["v"] = r.json()["access_token"]; _tok["t"] = time.time()
    return _tok["v"]

def fetch_detail(uid):
    """Return the CustomerGrouped invoice detail dict, or None on hard failure."""
    for attempt in range(1, 6):
        time.sleep(PACE)
        r = requests.get(f"{APIV}/Invoice/CustomerGrouped/GetById",
            headers={"Authorization": f"Bearer {token()}", "Accept": "application/json"},
            params={"uniqueId": uid, "tenantId": TID}, timeout=60)
        if r.status_code == 401:
            _tok["v"] = None; time.sleep(2 * attempt); continue
        if r.status_code in (429, 403) or r.status_code >= 500:
            time.sleep(min(5 * attempt, 60)); continue
        if r.status_code != 200:
            return None  # 4xx other than throttling -> skip this invoice
        return r.json()
    return None  # retries exhausted

def f(v):
    try: return float(v) if v is not None else None
    except (TypeError, ValueError): return None

def candidates(bq):
    """Type-2 invoices to (re)fetch."""
    base = f"SELECT UniqueId, InvoiceNumber, Id, DateRaised FROM `{PROJECT}.raw.invoices` WHERE Type = 2"
    if MODE == "full":
        q = base
    else:
        exists = False
        try:
            bq.get_table(TABLE); exists = True
        except Exception:
            exists = False
        if not exists:
            q = base  # first run -> behave as full
        else:
            q = (base + f" AND (UniqueId NOT IN (SELECT DISTINCT grouped_invoice_uid FROM `{TABLE}`)"
                        f" OR DATE(DateRaised) >= DATE_SUB(CURRENT_DATE(), INTERVAL {DAYS} DAY))")
    return [(r.UniqueId, r.InvoiceNumber, r.Id, r.DateRaised) for r in bq.query(q).result()]

def main():
    bq = bigquery.Client(project=PROJECT)
    ing = dt.datetime.now(dt.timezone.utc).isoformat()
    invs = candidates(bq)
    print(f"{MODE}: {len(invs)} Customer Grouped invoices to fetch", flush=True)
    if not invs:
        print("nothing to do.", flush=True); return

    rows, ok, failed = [], 0, []
    for i, (uid, num, hid, raised) in enumerate(invs, 1):
        d = fetch_detail(uid)
        if d is None:
            failed.append(uid); continue
        obj = d.get("Data", d) if isinstance(d, dict) else d
        jlines = (obj or {}).get("JobLines") or []
        rz = raised.isoformat() if hasattr(raised, "isoformat") else raised
        for ln in jlines:
            rows.append({
                "grouped_invoice_uid": uid,
                "grouped_invoice_number": num,
                "grouped_invoice_id": hid,
                "date_raised": rz,
                "line_uid": ln.get("UniqueId"),
                "job_number": ln.get("JobNumber"),
                "job_unique_id": ln.get("JobUniqueId"),
                "description": ln.get("Description"),
                "quantity": f(ln.get("Quantity")),
                "price_per_unit": f(ln.get("PricePerUnit")),
                "total_excl_vat": f(ln.get("TotalExcludingVat")),
                "total_incl_vat": f(ln.get("TotalIncludingVat")),
                "total_vat": f(ln.get("TotalVatAmount")),
                "_ingested_at": ing,
            })
        ok += 1
        if i % 50 == 0:
            print(f"  {i}/{len(invs)} fetched ({len(rows)} lines, {len(failed)} failed)", flush=True)

    print(f"fetched {ok}/{len(invs)} invoices, {len(rows)} job-lines, {len(failed)} failed", flush=True)
    if failed:
        print(f"  failed uids (first 10): {failed[:10]}", flush=True)

    payload = BytesIO("\n".join(json.dumps(r, default=str) for r in rows).encode())

    if MODE == "full":
        # Safety: don't replace the table off a badly-degraded fetch.
        if invs and ok < 0.9 * len(invs):
            raise RuntimeError(f"full refused: only {ok}/{len(invs)} invoices fetched OK")
        stg = f"{TABLE}_stg"
        bq.load_table_from_file(payload, stg, job_config=bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            schema=SCHEMA, write_disposition="WRITE_TRUNCATE")).result()
        bq.query(f"CREATE OR REPLACE TABLE `{TABLE}` AS SELECT * FROM `{stg}`").result()
        bq.query(f"DROP TABLE `{stg}`").result()
        print(f"full loaded {len(rows)} lines -> {TABLE}", flush=True)
    else:
        if not rows:
            print("no new lines.", flush=True); return
        tmp = f"{TABLE}_delta"
        bq.load_table_from_file(payload, tmp, job_config=bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            schema=SCHEMA, write_disposition="WRITE_TRUNCATE")).result()
        bq.query(f"""
        BEGIN TRANSACTION;
        DELETE FROM `{TABLE}` WHERE grouped_invoice_uid IN (SELECT DISTINCT grouped_invoice_uid FROM `{tmp}`);
        INSERT INTO `{TABLE}` SELECT * FROM `{tmp}`;
        COMMIT TRANSACTION;""").result()
        print(f"upserted {len(rows)} lines -> {TABLE}", flush=True)

if __name__ == "__main__":
    main()
