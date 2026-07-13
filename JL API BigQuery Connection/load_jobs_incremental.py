"""Incremental jobs refresh (hourly). The Joblogic API has no 'updated since' filter, so we
pull jobs whose LOGGED, APPOINTMENT, or COMPLETION date falls in the last N days (union, deduped
by Id) and upsert them into raw.jobs. A nightly full refresh (loader.py) is the correctness net.

Upsert = load delta to a temp table (using raw.jobs' exact schema), then DELETE matching Ids +
INSERT in one transaction. Keeps raw.jobs complete while touching only changed rows.
"""
import os, json, time, datetime as dt
import requests
from google.cloud import bigquery

TID = os.environ["JL_TENANT_ID"]; CID = os.environ["JL_CLIENT_ID"]; CSEC = os.environ["JL_CLIENT_SECRET"]
PROJECT = "vmimporteddata"; BASE = "https://api.joblogic.com/api/v1"
TOKEN_URL = "https://identityservice.joblogic.com/connect/token"
DAYS = int(os.environ.get("JL_INCREMENTAL_DAYS", "14"))
PACE = 0.65
FLAGS = {"IncludeReactiveJobs": True, "IncludePPMJobs": True, "IncludeInactive": True,
         "OnlyIncludePrimaryJobTrade": True, "IncludeTags": True, "IncludeContacts": True,
         "IncludeNotes": True, "OrderBy": 0}

_tok = {"v": None, "t": 0.0}
def token():
    if _tok["v"] is None or time.time() - _tok["t"] > 2700:
        r = requests.post(TOKEN_URL, data={"grant_type": "client_credentials", "client_id": CID,
            "client_secret": CSEC, "scope": "JL.Api"}, timeout=60)
        r.raise_for_status(); _tok["v"] = r.json()["access_token"]; _tok["t"] = time.time()
    return _tok["v"]

def fetch_window(start_field, end_field, frm, to):
    rows, page = [], 1
    while True:
        body = {"TenantId": TID, "PageIndex": page, "PageSize": 50, start_field: frm, end_field: to}
        body.update(FLAGS)
        for attempt in range(1, 6):
            time.sleep(PACE)
            r = requests.post(f"{BASE}/Job/getall", json=body,
                headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"}, timeout=60)
            if r.status_code in (429, 403) or r.status_code >= 500:
                if r.status_code == 401: _tok["v"] = None
                time.sleep(min(5 * attempt, 60)); continue
            r.raise_for_status(); break
        d = r.json(); items = d.get("Items", [])
        rows.extend(items)
        if not items or len(items) < 50 or len(rows) >= d.get("TotalCount", 0):
            break
        page += 1
    return rows

def main():
    now = dt.datetime.now(dt.timezone.utc)
    frm = (now - dt.timedelta(days=DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    to = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"{now:%H:%M:%S} incremental window {frm}..{to}", flush=True)

    by_id = {}
    for sf, ef in [("StartLoggedDate", "EndLoggedDate"), ("StartDate", "EndDate"),
                   ("StartCompleteDate", "EndCompleteDate")]:
        rows = fetch_window(sf, ef, frm, to)
        for r in rows:
            if isinstance(r, dict) and r.get("Id") is not None:
                by_id[r["Id"]] = r
        print(f"  {sf}: {len(rows)} rows (running unique={len(by_id)})", flush=True)

    delta = list(by_id.values())
    if not delta:
        print("no changed jobs; nothing to upsert.", flush=True); return
    ing = now.isoformat()
    for r in delta:
        r["_ingested_at"] = ing

    bq = bigquery.Client(project=PROJECT)
    jobs_tbl = bq.get_table(f"{PROJECT}.raw.jobs")
    tmp = f"{PROJECT}.raw._jobs_delta"
    from io import BytesIO
    payload = "\n".join(json.dumps(r, default=str) for r in delta).encode()
    bq.load_table_from_file(BytesIO(payload), tmp, job_config=bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        schema=jobs_tbl.schema, write_disposition="WRITE_TRUNCATE",
        ignore_unknown_values=True)).result()

    merge = f"""
    BEGIN TRANSACTION;
    DELETE FROM `{PROJECT}.raw.jobs` WHERE Id IN (SELECT Id FROM `{tmp}`);
    INSERT INTO `{PROJECT}.raw.jobs` SELECT * FROM `{tmp}`;
    COMMIT TRANSACTION;
    """
    bq.query(merge).result()
    n = bq.get_table(f"{PROJECT}.raw.jobs").num_rows
    print(f"{dt.datetime.now(dt.timezone.utc):%H:%M:%S} upserted {len(delta)} jobs; raw.jobs now {n} rows", flush=True)

if __name__ == "__main__":
    main()
