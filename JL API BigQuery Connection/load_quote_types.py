#!/usr/bin/env python3
"""
Backfill/refresh quote Job Type + Job Category (and TradeId) which the Quote/getall LIST
endpoint returns as NULL. The per-quote DETAIL endpoint GET /api/v1/Quote/GetById DOES return
them (as short codes: JobType e.g. 'D'/'E', JobCategory e.g. 'T23'). Writes to raw.quote_types.

Modes (env JL_QT_MODE):
  full  -> fetch every quote Id in raw.quotes; WRITE_TRUNCATE raw.quote_types
  incr  -> fetch only quote Ids in raw.quotes not yet in raw.quote_types; WRITE_APPEND (new quotes)

Creds/config come from env (wrapper run_quote_types.sh pulls them from Secret Manager), same as loader.py.
BigQuery auth = VM service account (ADC).
"""
import datetime as dt
import json
import logging
import os
import sys
import time

import requests
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger("quote_types")


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
TABLE = f"{BQ_PROJECT}.{BQ_DATASET}.quote_types"

MODE = env("JL_QT_MODE", "incr").strip().lower()
RATE_MIN_INTERVAL = float(env("JL_MIN_INTERVAL", "0.65"))  # ~92 req/min, under the 100 cap
HTTP_TIMEOUT = int(env("JL_HTTP_TIMEOUT", "60"))
MAX_RETRIES = int(env("JL_MAX_RETRIES", "5"))
OUT = env("JL_QT_OUT", "/tmp/quote_types.jsonl")

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
    params = {"id": qid, "tenantId": TENANT_ID, "includeLines": "false"}
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    for attempt in range(1, MAX_RETRIES + 1):
        _pace()
        r = requests.get(url, params=params, headers=headers, timeout=HTTP_TIMEOUT)
        if r.status_code == 429 or r.status_code >= 500:
            wait = min(2 ** attempt, 30)
            log.warning("HTTP %s on quote %s (try %s/%s) wait %ss", r.status_code, qid, attempt, MAX_RETRIES, wait)
            time.sleep(wait)
            continue
        if r.status_code == 404:
            return None
        r.raise_for_status()
        body = r.json()
        return body.get("Data") or body.get("data") or body
    return None


def ids_to_fetch(client):
    if MODE == "full":
        q = f"SELECT Id, QuoteNumber FROM `{BQ_PROJECT}.{BQ_DATASET}.quotes` WHERE Id IS NOT NULL"
    else:
        # incremental: quotes not already typed
        q = f"""
        SELECT q.Id, q.QuoteNumber
        FROM `{BQ_PROJECT}.{BQ_DATASET}.quotes` q
        WHERE q.Id IS NOT NULL
          AND q.Id NOT IN (SELECT quote_id FROM `{TABLE}`)
        """
    return [(row.Id, row.QuoteNumber) for row in client.query(q).result()]


SCHEMA = [
    bigquery.SchemaField("quote_id", "INTEGER"),
    bigquery.SchemaField("quote_number", "STRING"),
    bigquery.SchemaField("job_type_code", "STRING"),
    bigquery.SchemaField("job_category_code", "STRING"),
    bigquery.SchemaField("trade_id", "STRING"),
    bigquery.SchemaField("_ingested_at", "TIMESTAMP"),
]


def main():
    client = bigquery.Client(project=BQ_PROJECT)
    try:
        ids = ids_to_fetch(client)
    except Exception as e:
        # incr mode but table missing -> fall back to full
        if MODE != "full" and "Not found" in str(e):
            log.warning("quote_types missing; running FULL instead")
            globals()["MODE"] = "full"
            ids = ids_to_fetch(client)
        else:
            raise
    log.info("mode=%s quotes to fetch=%s", MODE, len(ids))
    if not ids:
        log.info("nothing to do")
        return

    token, t0 = get_token()
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    n = 0
    with open(OUT, "w") as f:
        for qid, qnum in ids:
            if time.monotonic() - t0 > 3000:  # refresh token every ~50 min
                token, t0 = get_token()
            it = get_by_id(qid, token)
            if not isinstance(it, dict):
                continue
            f.write(json.dumps({
                "quote_id": qid,
                "quote_number": it.get("QuoteNumber") or qnum,
                "job_type_code": it.get("JobType"),
                "job_category_code": it.get("JobCategory"),
                "trade_id": it.get("TradeId"),
                "_ingested_at": now,
            }) + "\n")
            n += 1
            if n % 250 == 0:
                log.info("%s/%s", n, len(ids))
    log.info("fetched %s rows; loading BQ (%s)...", n, MODE)

    job_cfg = bigquery.LoadJobConfig(
        schema=SCHEMA,
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=(bigquery.WriteDisposition.WRITE_TRUNCATE if MODE == "full"
                           else bigquery.WriteDisposition.WRITE_APPEND),
    )
    with open(OUT, "rb") as f:
        client.load_table_from_file(f, TABLE, job_config=job_cfg).result()
    log.info("loaded %s: %s rows (%s)", TABLE, n, MODE)


if __name__ == "__main__":
    main()
