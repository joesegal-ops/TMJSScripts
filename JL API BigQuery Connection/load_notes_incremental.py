#!/usr/bin/env python3
"""
Incremental job + engineer (visit) notes -> raw.notes.

raw.notes was populated ONCE by load_notes_full.py (2026-07-14, ~20h, WRITE_TRUNCATE) and never
scheduled, so Engineer_Notes silently froze at 16 Jul 2026. This keeps it current.

Picks jobs that are "touched" in the last JL_NOTES_DAYS days -- UpdatedAt in the window OR a visit
that STARTED in the window (engineer notes are written on attendance, which may not bump the job)
-- and for each one re-fetches everything:
  Note/GetAll(Job)                     -> job notes
  Visit/GetAll(JobId)                  -> visit GUIDs (Note/GetAll needs EntityUniqueId)
  Note/GetAll(Visit) per started visit -> engineer notes (future visits are skipped: no notes yet)
Rows land in raw.notes with the same shape as load_notes_full.py, so models.notes is unchanged.

Write strategy: per chunk of jobs, load to a run-private stage table, then in one transaction
DELETE that chunk's jobs from raw.notes and INSERT the stage. A job's notes are therefore replaced
wholesale (edits AND deletions are reflected) and a re-run is idempotent. Chunks commit as they go,
so a long catch-up that dies part-way keeps what it has done; just re-run it.

Env: JL_NOTES_DAYS (default 3). Creds come from run_notes.sh (Secret Manager), BQ auth = VM ADC.
"""
import datetime as dt
import json
import logging
import os
import sys
import tempfile
import time
import uuid

import requests
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger("notes")


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
TABLE = f"{BQ_PROJECT}.{BQ_DATASET}.notes"
JOBS = f"{BQ_PROJECT}.{BQ_DATASET}.jobs"

DAYS = int(env("JL_NOTES_DAYS", "3"))
CHUNK = int(env("JL_NOTES_CHUNK", "300"))  # jobs per BQ commit
RATE_MIN_INTERVAL = float(env("JL_MIN_INTERVAL", "0.72"))  # ~83/min, headroom for the jobs cron
HTTP_TIMEOUT = int(env("JL_HTTP_TIMEOUT", "60"))
MAX_RETRIES = int(env("JL_MAX_RETRIES", "6"))
PAGE = 50

_last = [0.0]
_tok = {"v": None, "t": 0.0}


def _pace():
    wait = RATE_MIN_INTERVAL - (time.monotonic() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.monotonic()


def token():
    if _tok["v"] is None or time.monotonic() - _tok["t"] > 2700:
        r = requests.post(TOKEN_URL, data={
            "grant_type": "client_credentials", "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET, "scope": SCOPE,
        }, headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        _tok["v"], _tok["t"] = r.json()["access_token"], time.monotonic()
    return _tok["v"]


def call(path, body):
    """POST with pacing + backoff. 403s here are the Azure WAF, not auth (see jl-azure-waf-rate-limit)."""
    for attempt in range(1, MAX_RETRIES + 1):
        _pace()
        try:
            r = requests.post(f"{API_BASE}/api/v1/{path}", json=body, timeout=HTTP_TIMEOUT,
                              headers={"Authorization": f"Bearer {token()}",
                                       "Content-Type": "application/json"})
        except requests.RequestException as e:
            log.warning("%s %s (try %s/%s)", path, type(e).__name__, attempt, MAX_RETRIES)
            time.sleep(min(5 * attempt, 60))
            continue
        if r.status_code == 401:
            _tok["v"] = None
            continue
        if r.status_code in (403, 429) or r.status_code >= 500:
            wait = min(5 * attempt, 60)
            log.warning("HTTP %s on %s (try %s/%s) wait %ss", r.status_code, path, attempt, MAX_RETRIES, wait)
            time.sleep(wait)
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError(f"{path} failed after {MAX_RETRIES} tries")


def paged(path, body):
    out, page = [], 1
    while True:
        d = call(path, {**body, "TenantId": TENANT_ID, "PageIndex": page, "PageSize": PAGE})
        items = d.get("Items", []) if isinstance(d, dict) else []
        out.extend(items)
        total = d.get("TotalCount", 0) if isinstance(d, dict) else 0
        if len(items) < PAGE or len(out) >= total:
            return out
        page += 1


def notes_for(etype, uid):
    return paged("Note/GetAll", {"EntityType": etype, "EntityUniqueId": uid})


def jobs_to_fetch(bq):
    q = f"""
    SELECT Id, UniqueId, NoOfVisits
    FROM `{JOBS}` j
    WHERE j.UpdatedAt >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {DAYS} DAY)
       OR EXISTS (SELECT 1 FROM UNNEST(j.VisitsStatus) v
                  WHERE v.StartDate BETWEEN TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {DAYS} DAY)
                                        AND CURRENT_TIMESTAMP())
    ORDER BY Id
    """
    return list(bq.query(q).result())


def fetch_job(job, ing, now):
    """All note rows for one job. Raises on failure so the job is NOT committed (old rows kept)."""
    rows = []
    for n in notes_for("Job", job.UniqueId):
        n.update({"_EntityType": "Job", "_JobId": job.Id, "_JobUniqueId": job.UniqueId, "_ingested_at": ing})
        rows.append(n)
    if (job.NoOfVisits or 0) > 0:
        for v in paged("Visit/GetAll", {"JobId": str(job.Id)}):
            vuid = v.get("UniqueId")
            start = v.get("StartDate")
            if not vuid or (start and start[:19] > now):  # future visit: nothing to fetch yet
                continue
            for n in notes_for("Visit", vuid):
                n.update({"_EntityType": "Visit", "_JobId": job.Id, "_JobUniqueId": job.UniqueId,
                          "_VisitId": v.get("Id"), "_VisitUniqueId": vuid, "_ingested_at": ing})
                rows.append(n)
    return rows


def commit(bq, schema, stage, job_ids, rows):
    """Replace raw.notes rows for job_ids with rows, atomically."""
    fd, path = tempfile.mkstemp(prefix="notes_", suffix=".jsonl")
    try:
        with os.fdopen(fd, "w") as f:
            for r in rows:
                f.write(json.dumps(r, default=str) + "\n")
        with open(path, "rb") as f:
            bq.load_table_from_file(f, stage, job_config=bigquery.LoadJobConfig(
                schema=schema, source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
                write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
                ignore_unknown_values=True)).result()
    finally:
        os.unlink(path)
    cols = ", ".join(f"`{c.name}`" for c in schema)
    bq.query(f"""
    BEGIN TRANSACTION;
    DELETE FROM `{TABLE}` WHERE _JobId IN UNNEST(@ids);
    INSERT INTO `{TABLE}` ({cols}) SELECT {cols} FROM `{stage}`;
    COMMIT TRANSACTION;
    """, job_config=bigquery.QueryJobConfig(query_parameters=[
        bigquery.ArrayQueryParameter("ids", "INT64", job_ids)])).result()


def main():
    bq = bigquery.Client(project=BQ_PROJECT)
    schema = bq.get_table(TABLE).schema
    jobs = jobs_to_fetch(bq)
    log.info("window=%sd jobs to fetch=%s", DAYS, len(jobs))
    if not jobs:
        return

    stage = f"{BQ_PROJECT}.{BQ_DATASET}._notes_stage_{uuid.uuid4().hex[:8]}"
    st = bigquery.Table(stage, schema=schema)
    st.expires = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2)
    bq.create_table(st)

    ing = dt.datetime.now(dt.timezone.utc).isoformat()
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    ids, rows, failed, total_rows = [], [], 0, 0
    try:
        for i, job in enumerate(jobs, 1):
            try:
                rows.extend(fetch_job(job, ing, now))
                ids.append(job.Id)
            except Exception as e:
                failed += 1
                log.warning("job %s skipped: %s %s", job.Id, type(e).__name__, e)
            if len(ids) >= CHUNK or (i == len(jobs) and ids):
                commit(bq, schema, stage, ids, rows)
                total_rows += len(rows)
                log.info("%s/%s jobs, committed %s jobs / %s notes (failed so far %s)",
                         i, len(jobs), len(ids), len(rows), failed)
                ids, rows = [], []
    finally:
        bq.delete_table(stage, not_found_ok=True)

    log.info("done: %s jobs, %s notes, %s failed", len(jobs) - failed, total_rows, failed)
    # Fail the cron (=> jl-run.sh mails) if a meaningful share of jobs couldn't be fetched.
    if failed and failed > max(5, len(jobs) // 20):
        sys.exit(1)


if __name__ == "__main__":
    main()
