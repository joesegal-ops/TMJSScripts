#!/usr/bin/env python3
"""
Backfill/refresh per-job cost & sell totals from the JobCost detail endpoint.

The list endpoint (Job/getall) returns NO costing. GET /api/v1/JobCost?Id=<job UniqueId GUID>&tenantId=
returns GetJobCostResponse with grand totals (TotalCost/SellExcludingVAT, ...IncludingVAT) plus per-category
line arrays (Material/Labour/Travel/Expense/Subcontractor/etc). NB Id is the job's UniqueId GUID, NOT the
integer Id (integer -> HTTP 400). Writes raw.job_costs.

Modes (env JL_JC_MODE):
  full  -> every job in raw.jobs; RESUMABLE (done-file); WRITE_TRUNCATE load at the end
  incr  -> jobs updated in the last JL_JC_DAYS days OR not yet in raw.job_costs; upsert by job_id

Stores the grand totals + the full line JSON (lines_json) so line-level models (cost_line_items /
pending_costs) can be built later WITHOUT re-pulling. Creds/config from env (wrapper run_job_costs.sh
pulls them from Secret Manager), same as loader.py. BigQuery auth = VM service account (ADC).
"""
import datetime as dt
import json
import logging
import os
import sys
import time

import requests
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("job_costs")


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and not v:
        log.error("missing required env %s", name)
        sys.exit(2)
    return v


TOKEN_URL = env("JL_TOKEN_URL", "https://identityservice.joblogic.com/connect/token")
API_BASE = env("JL_API_BASE", "https://api.joblogic.com")
SCOPE = env("JL_SCOPE", "JL.Api")
CLIENT_ID = env("JL_CLIENT_ID", required=True)
CLIENT_SECRET = env("JL_CLIENT_SECRET", required=True)
TENANT_ID = env("JL_TENANT_ID", required=True)

BQ_PROJECT = env("BQ_PROJECT", "vmimporteddata")
BQ_DATASET = env("BQ_DATASET", "raw")
TABLE = f"{BQ_PROJECT}.{BQ_DATASET}.job_costs"

MODE = env("JL_JC_MODE", "incr").strip().lower()
DAYS = int(env("JL_JC_DAYS", "7"))
RATE_MIN_INTERVAL = float(env("JL_MIN_INTERVAL", "0.65"))  # ~92 req/min, under the 100 cap
HTTP_TIMEOUT = int(env("JL_HTTP_TIMEOUT", "60"))
MAX_RETRIES = int(env("JL_MAX_RETRIES", "5"))
OUT = env("JL_JC_OUT", "/tmp/job_costs.jsonl")
DONE = env("JL_JC_DONE", "/tmp/job_costs_done.txt")

LINE_KEYS = ["MaterialLines", "ExpenseLines", "CalloutLines", "MileageLines", "TravelLines",
             "LabourLines", "OvertimeLines", "SubcontractorLines", "ScheduleOfRatesLines", "OtherLines"]

SCHEMA = [
    bigquery.SchemaField("job_id", "INTEGER"),
    bigquery.SchemaField("job_uid", "STRING"),
    bigquery.SchemaField("job_number", "STRING"),
    bigquery.SchemaField("total_cost_exvat", "FLOAT"),
    bigquery.SchemaField("total_sell_exvat", "FLOAT"),
    bigquery.SchemaField("total_cost_incvat", "FLOAT"),
    bigquery.SchemaField("total_sell_incvat", "FLOAT"),
    bigquery.SchemaField("n_lines", "INTEGER"),
    bigquery.SchemaField("lines_json", "STRING"),
    bigquery.SchemaField("_ingested_at", "TIMESTAMP"),
]

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


def get_job_cost(guid, token):
    url = f"{API_BASE}/api/v1/JobCost"
    params = {"Id": guid, "tenantId": TENANT_ID}
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    for attempt in range(1, MAX_RETRIES + 1):
        _pace()
        r = requests.get(url, params=params, headers=headers, timeout=HTTP_TIMEOUT)
        if r.status_code == 429 or r.status_code >= 500:
            wait = min(2 ** attempt, 30)
            log.warning("HTTP %s job %s (try %s/%s) wait %ss", r.status_code, guid, attempt, MAX_RETRIES, wait)
            time.sleep(wait)
            continue
        if 400 <= r.status_code < 500:
            # 400 "Job doesn't exist" (brand-new jobs not yet in the costing subsystem), 403/404 etc.
            # Skip the job rather than kill the whole batch.
            log.warning("HTTP %s job %s — skipping (%s)", r.status_code, guid,
                        r.text[:80].replace("\n", " "))
            return None
        r.raise_for_status()
        return r.json()
    return None


def jobs_to_fetch(client):
    if MODE == "full":
        q = f"SELECT Id, UniqueId, JobNumber FROM `{BQ_PROJECT}.{BQ_DATASET}.jobs` WHERE UniqueId IS NOT NULL"
    else:
        q = f"""
        SELECT j.Id, j.UniqueId, j.JobNumber
        FROM `{BQ_PROJECT}.{BQ_DATASET}.jobs` j
        WHERE j.UniqueId IS NOT NULL
          AND (j.Id NOT IN (SELECT job_id FROM `{TABLE}`)
               OR j.UpdatedAt >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {DAYS} DAY))
        """
    limit = env("JL_JC_LIMIT")  # smoke-test convenience: cap the job set
    if limit:
        q += f"\nLIMIT {int(limit)}"
    return [(r.Id, r.UniqueId, r.JobNumber) for r in client.query(q).result()]


def main():
    client = bigquery.Client(project=BQ_PROJECT)
    try:
        jobs = jobs_to_fetch(client)
    except Exception as e:
        if MODE != "full" and "Not found" in str(e):
            log.warning("job_costs missing; running FULL instead")
            globals()["MODE"] = "full"
            jobs = jobs_to_fetch(client)
        else:
            raise

    done = set()
    if MODE == "full" and os.path.exists(DONE):
        with open(DONE) as f:
            done = set(l.strip() for l in f if l.strip())
    jobs = [j for j in jobs if str(j[0]) not in done]
    log.info("mode=%s jobs to fetch=%s (skipping %s already done)", MODE, len(jobs), len(done))

    token, t0 = get_token()
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    n = 0
    fmode = "a" if (MODE == "full" and done) else "w"
    with open(OUT, fmode) as fout, open(DONE, "a") as fdone:
        for jid, guid, jnum in jobs:
            if time.monotonic() - t0 > 3000:  # refresh token every ~50 min
                token, t0 = get_token()
            d = get_job_cost(guid, token)
            if isinstance(d, dict):
                nlines = sum(len(d.get(k) or []) for k in LINE_KEYS)
                fout.write(json.dumps({
                    "job_id": jid, "job_uid": guid, "job_number": jnum,
                    "total_cost_exvat": d.get("TotalCostExcludingVAT"),
                    "total_sell_exvat": d.get("TotalSellExcludingVAT"),
                    "total_cost_incvat": d.get("TotalCostIncludingVAT"),
                    "total_sell_incvat": d.get("TotalSellIncludingVAT"),
                    "n_lines": nlines,
                    "lines_json": json.dumps({k: d.get(k) for k in LINE_KEYS if d.get(k)}),
                    "_ingested_at": now,
                }) + "\n")
                n += 1
            fout.flush()
            fdone.write(f"{jid}\n")
            fdone.flush()
            if (n and n % 250 == 0):
                log.info("%s fetched / %s to do", n, len(jobs))

    if n == 0:
        log.info("no rows fetched; nothing to load")
        return
    log.info("fetched %s rows; loading BQ (%s)...", n, MODE)

    if MODE == "full":
        cfg = bigquery.LoadJobConfig(schema=SCHEMA,
                                     source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
                                     write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE)
        with open(OUT, "rb") as f:
            client.load_table_from_file(f, TABLE, job_config=cfg).result()
        log.info("loaded %s (full truncate): %s rows", TABLE, n)
    else:
        tmp = f"{TABLE}_delta"
        cfg = bigquery.LoadJobConfig(schema=SCHEMA,
                                     source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
                                     write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE)
        with open(OUT, "rb") as f:
            client.load_table_from_file(f, tmp, job_config=cfg).result()
        client.query(
            f"DELETE FROM `{TABLE}` WHERE job_id IN (SELECT job_id FROM `{tmp}`); "
            f"INSERT INTO `{TABLE}` SELECT * FROM `{tmp}`;"
        ).result()
        log.info("upserted %s rows into %s", n, TABLE)


if __name__ == "__main__":
    main()
