"""Per-job visits backfill. Visit/GetAll needs a job auto-id, so we iterate every job
with NoOfVisits>0 (~29k). Long run (~5h): refreshes the token, checkpoints progress so it
can resume, backs off on 403/429, and loads raw.visits at the end.

Resume-safe: appends visits to visits.jsonl and processed ids to visits_done.txt; rerun to
continue. Run in background:  nohup .../python load_visits.py > visits.log 2>&1 &
"""
import os, json, time, datetime as dt
import requests
from google.cloud import bigquery

TID = os.environ["JL_TENANT_ID"]; CID = os.environ["JL_CLIENT_ID"]; CSEC = os.environ["JL_CLIENT_SECRET"]
PROJECT = "vmimporteddata"
BASE = "https://api.joblogic.com/api/v1"
TOKEN_URL = "https://identityservice.joblogic.com/connect/token"
JSONL = "/tmp/visits.jsonl"; DONE = "/tmp/visits_done.txt"; FAILED = "/tmp/visits_failed.txt"
PACE = 0.65

_tok = {"v": None, "t": 0.0}
def token():
    if _tok["v"] is None or time.time() - _tok["t"] > 2700:  # refresh every 45 min
        r = requests.post(TOKEN_URL, data={"grant_type": "client_credentials", "client_id": CID,
            "client_secret": CSEC, "scope": "JL.Api"},
            headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=60)
        r.raise_for_status(); _tok["v"] = r.json()["access_token"]; _tok["t"] = time.time()
    return _tok["v"]

def visits_for(job_id):
    """Return (list_of_visits, ok). ok=False means give up on this job (record as failed)."""
    out, page = [], 1
    while True:
        body = {"TenantId": TID, "PageIndex": page, "PageSize": 50, "JobId": str(job_id)}
        got = None
        for attempt in range(1, 6):
            time.sleep(PACE)
            try:
                r = requests.post(f"{BASE}/Visit/GetAll", json=body,
                    headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"}, timeout=60)
            except Exception:
                time.sleep(min(2 ** attempt, 30)); continue
            if r.status_code in (429, 403) or r.status_code >= 500:
                if r.status_code == 401:
                    _tok["v"] = None
                time.sleep(min(5 * attempt, 60)); continue
            if r.status_code == 401:
                _tok["v"] = None; continue
            got = r; break
        if got is None or got.status_code != 200:
            return out, False
        d = got.json()
        items = d.get("Items", []) if isinstance(d, dict) else d
        out.extend(items)
        total = d.get("TotalCount") if isinstance(d, dict) else None
        if not items or len(items) < 50 or (total is not None and len(out) >= total):
            break
        page += 1
    return out, True

def main():
    bq = bigquery.Client(project=PROJECT)
    ids = [r.Id for r in bq.query(
        "SELECT Id FROM `vmimporteddata.raw.jobs` WHERE NoOfVisits > 0 ORDER BY Id").result()]
    done = set()
    if os.path.exists(DONE):
        done = {int(x) for x in open(DONE).read().split() if x.strip()}
    todo = [i for i in ids if i not in done]
    print(f"{dt.datetime.now():%H:%M:%S} jobs_with_visits={len(ids)} done={len(done)} todo={len(todo)}", flush=True)
    ingested = dt.datetime.now(dt.timezone.utc).isoformat()
    fj = open(JSONL, "a"); fd = open(DONE, "a"); ff = open(FAILED, "a")
    n = 0
    for jid in todo:
        vs, ok = visits_for(jid)
        for v in vs:
            if isinstance(v, dict):
                v["_ingested_at"] = ingested
            fj.write(json.dumps(v, default=str) + "\n")
        (fd if ok else ff).write(f"{jid}\n")
        if ok: fd.flush()
        else: ff.flush()
        fj.flush()
        n += 1
        if n % 500 == 0:
            print(f"{dt.datetime.now():%H:%M:%S} processed {n}/{len(todo)}", flush=True)
    fj.close(); fd.close(); ff.close()
    print(f"{dt.datetime.now():%H:%M:%S} fetch done; loading raw.visits ...", flush=True)
    with open(JSONL, "rb") as f:
        job = bq.load_table_from_file(f, f"{PROJECT}.raw.visits", job_config=bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition="WRITE_TRUNCATE", autodetect=True))
        job.result()
    print(f"{dt.datetime.now():%H:%M:%S} loaded raw.visits: {bq.get_table(f'{PROJECT}.raw.visits').num_rows} rows", flush=True)

if __name__ == "__main__":
    main()
