"""Generalised incremental / chunked loader for the high-volume, date-filterable entities.

The Joblogic API has no 'updated since' filter, so we window on the dates it DOES expose and
upsert by key. Two modes:
  incr     (default): pull the last JL_INCREMENTAL_DAYS days, upsert changed/new rows into raw.<table>
  backfill          : walk monthly windows START_DATE..now, full-replace raw.<table>
                      (keeps each request tiny -> also avoids the invoice endpoint's 403 quota)

Entity chosen via JL_INCR. Config below. Nightly full refreshes (loader.py / run_tier.sh) remain the
correctness net for changes the date windows can't see.
"""
import os, json, time, datetime as dt
from io import BytesIO
import requests
from google.cloud import bigquery

TID = os.environ["JL_TENANT_ID"]; CID = os.environ["JL_CLIENT_ID"]; CSEC = os.environ["JL_CLIENT_SECRET"]
PROJECT = "vmimporteddata"; BASE = "https://api.joblogic.com/api/v1"
TOKEN_URL = "https://identityservice.joblogic.com/connect/token"
ENTITY = os.environ["JL_INCR"]
MODE = os.environ.get("JL_MODE", "incr")
DAYS = int(os.environ.get("JL_INCREMENTAL_DAYS", "14"))
START_DATE = os.environ.get("JL_START_DATE", "2024-07-31T00:00:00Z")
PACE = 0.65

JOB_FLAGS = {"IncludeReactiveJobs": True, "IncludePPMJobs": True, "IncludeInactive": True,
             "OnlyIncludePrimaryJobTrade": True, "IncludeTags": True, "IncludeContacts": True,
             "IncludeNotes": True, "OrderBy": 0}
INV_FLAGS = {"IncludeStandardInvoices": True, "IncludePPMInvoices": True, "IncludeCGroupInvoices": True,
             "IncludeSORInvoices": True, "IncludeRelatedJobInvoices": True, "OrderBy": 0}
CONFIG = {
    "jobs":          {"path": "Job/getall", "table": "jobs", "key": "Id", "flags": JOB_FLAGS,
                      "windows": [("StartLoggedDate", "EndLoggedDate"), ("StartDate", "EndDate"),
                                  ("StartCompleteDate", "EndCompleteDate")]},
    "quotes":        {"path": "Quote/GetAll", "table": "quotes", "key": "Id", "flags": {},
                      "windows": [("StartDate", "EndDate")]},
    "invoices":      {"path": "Invoice/getall", "table": "invoices", "key": "Id", "flags": INV_FLAGS,
                      "windows": [("StartDate", "EndDate")]},
    "forms_logbook": {"path": "FormsLogbook/getall", "table": "forms_logbook", "key": "UniqueId", "flags": {},
                      "windows": [("StartDate", "EndDate")]},
}
CFG = CONFIG[ENTITY]

_tok = {"v": None, "t": 0.0}
def token():
    if _tok["v"] is None or time.time() - _tok["t"] > 2700:
        r = requests.post(TOKEN_URL, data={"grant_type": "client_credentials", "client_id": CID,
            "client_secret": CSEC, "scope": "JL.Api"}, timeout=60)
        r.raise_for_status(); _tok["v"] = r.json()["access_token"]; _tok["t"] = time.time()
    return _tok["v"]

def fetch(sf, ef, frm, to):
    rows, page = [], 1
    while True:
        body = {"TenantId": TID, "PageIndex": page, "PageSize": 50, sf: frm, ef: to}
        body.update(CFG["flags"])
        for attempt in range(1, 6):
            time.sleep(PACE)
            r = requests.post(f"{BASE}/{CFG['path']}", json=body,
                headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"}, timeout=60)
            if r.status_code in (429, 403) or r.status_code >= 500:
                if r.status_code == 401: _tok["v"] = None
                time.sleep(min(5 * attempt, 60)); continue
            r.raise_for_status(); break
        d = r.json(); items = d.get("Items", []) if isinstance(d, dict) else d
        rows.extend(items)
        if not items or len(items) < 50 or len(rows) >= (d.get("TotalCount", 0) if isinstance(d, dict) else 0):
            break
        page += 1
    return rows

def gather(date_windows):
    by_key = {}
    for frm, to in date_windows:
        for sf, ef in CFG["windows"]:
            for r in fetch(sf, ef, frm, to):
                if isinstance(r, dict) and r.get(CFG["key"]) is not None:
                    by_key[r[CFG["key"]]] = r
    return list(by_key.values())

def main():
    now = dt.datetime.now(dt.timezone.utc)
    bq = bigquery.Client(project=PROJECT)
    tbl = f"{PROJECT}.raw.{CFG['table']}"
    ing = now.isoformat()

    if MODE == "backfill":
        start = dt.datetime.fromisoformat(START_DATE.replace("Z", "+00:00"))
        wins, cur = [], start
        while cur < now:
            nxt = min(cur + dt.timedelta(days=31), now)
            wins.append((cur.strftime("%Y-%m-%dT%H:%M:%SZ"), nxt.strftime("%Y-%m-%dT%H:%M:%SZ")))
            cur = nxt
        print(f"{now:%H:%M:%S} {ENTITY} backfill over {len(wins)} monthly windows", flush=True)
        rows = gather(wins)
        for r in rows: r["_ingested_at"] = ing
        if not rows:
            print("no rows.", flush=True); return
        bq.load_table_from_file(BytesIO("\n".join(json.dumps(r, default=str) for r in rows).encode()),
            tbl, job_config=bigquery.LoadJobConfig(
                source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
                write_disposition="WRITE_TRUNCATE", autodetect=True)).result()
        print(f"{dt.datetime.now(dt.timezone.utc):%H:%M:%S} backfill loaded {len(rows)} -> {tbl}", flush=True)
        return

    # incr
    frm = (now - dt.timedelta(days=DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    to = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"{now:%H:%M:%S} {ENTITY} incremental {frm}..{to}", flush=True)
    rows = gather([(frm, to)])
    if not rows:
        print("no changed rows.", flush=True); return
    for r in rows: r["_ingested_at"] = ing
    schema = bq.get_table(tbl).schema
    tmp = f"{PROJECT}.raw._{CFG['table']}_delta"
    bq.load_table_from_file(BytesIO("\n".join(json.dumps(r, default=str) for r in rows).encode()),
        tmp, job_config=bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            schema=schema, write_disposition="WRITE_TRUNCATE", ignore_unknown_values=True)).result()
    key = CFG["key"]
    bq.query(f"""
    BEGIN TRANSACTION;
    DELETE FROM `{tbl}` WHERE {key} IN (SELECT {key} FROM `{tmp}`);
    INSERT INTO `{tbl}` SELECT * FROM `{tmp}`;
    COMMIT TRANSACTION;""").result()
    print(f"{dt.datetime.now(dt.timezone.utc):%H:%M:%S} upserted {len(rows)} -> {tbl} (now {bq.get_table(tbl).num_rows} rows)", flush=True)

if __name__ == "__main__":
    main()
