"""
Joblogic API -> BigQuery loader.

Runs as a Cloud Run Job, triggered by Cloud Scheduler. All outbound traffic is
routed through a VPC + Cloud NAT so it egresses from a single reserved static IP
(the address you whitelist with Joblogic for API access).

Flow per run:
  1. Fetch an OAuth client-credentials access token (Bearer, ~1h TTL).
  2. Page through the configured Joblogic API endpoint.
  3. Load the rows into BigQuery (WRITE_TRUNCATE by default = idempotent snapshot).

Config is via environment variables (see README). Secrets come from Secret Manager,
injected as env vars by Cloud Run.
"""

import json
import logging
import os
import sys
import time
from typing import Any, Iterator

import requests
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("jl-bq")


# --- Config -----------------------------------------------------------------

def env(name: str, default: str | None = None, required: bool = False) -> str:
    val = os.environ.get(name, default)
    if required and not val:
        log.error("Missing required env var: %s", name)
        sys.exit(2)
    return val  # type: ignore[return-value]

TOKEN_URL   = env("JL_TOKEN_URL", "https://identityserver.joblogic.com/connect/token")
API_BASE    = env("JL_API_BASE", "https://api.joblogic.com")
SCOPE       = env("JL_SCOPE", "JL.Api")
CLIENT_ID   = env("JL_CLIENT_ID", required=True)
CLIENT_SECRET = env("JL_CLIENT_SECRET", required=True)

# The entity/report endpoint to pull, e.g. "/job" or "/visit". Set to match the
# report you're replicating. Pagination params below match common JL conventions
# adjust PAGE_PARAM / SIZE_PARAM / PAGE_SIZE to whatever the endpoint documents.
API_PATH    = env("JL_API_PATH", required=True)
PAGE_PARAM  = env("JL_PAGE_PARAM", "pageNumber")
SIZE_PARAM  = env("JL_SIZE_PARAM", "pageSize")
PAGE_SIZE   = int(env("JL_PAGE_SIZE", "200"))
# JSON key that holds the array of records in the response (dot-path supported,
# e.g. "data.items"). Empty = response body is itself the array.
RECORDS_KEY = env("JL_RECORDS_KEY", "")
EXTRA_QUERY = env("JL_EXTRA_QUERY", "")  # raw querystring appended, e.g. "modifiedSince=2026-06-01"

BQ_PROJECT  = env("BQ_PROJECT", required=True)
BQ_DATASET  = env("BQ_DATASET", required=True)
BQ_TABLE    = env("BQ_TABLE", required=True)
WRITE_MODE  = env("BQ_WRITE_MODE", "WRITE_TRUNCATE")  # or WRITE_APPEND

HTTP_TIMEOUT = int(env("HTTP_TIMEOUT", "60"))
MAX_RETRIES  = int(env("HTTP_MAX_RETRIES", "4"))


# --- Auth -------------------------------------------------------------------

def get_token() -> str:
    log.info("Requesting access token from %s", TOKEN_URL)
    resp = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "scope": SCOPE,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=HTTP_TIMEOUT,
    )
    resp.raise_for_status()
    tok = resp.json()["access_token"]
    log.info("Token acquired (expires_in=%ss)", resp.json().get("expires_in"))
    return tok


# --- Fetch ------------------------------------------------------------------

def _dig(obj: Any, dotted: str) -> Any:
    if not dotted:
        return obj
    for part in dotted.split("."):
        obj = obj[part]
    return obj

def _request_with_retry(url: str, headers: dict, params: dict) -> dict:
    for attempt in range(1, MAX_RETRIES + 1):
        resp = requests.get(url, headers=headers, params=params, timeout=HTTP_TIMEOUT)
        if resp.status_code in (429, 500, 502, 503, 504):
            wait = min(2 ** attempt, 30)
            log.warning("HTTP %s on %s (attempt %s/%s) — retrying in %ss",
                        resp.status_code, url, attempt, MAX_RETRIES, wait)
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json()
    resp.raise_for_status()  # exhausted retries
    return {}

def fetch_all(token: str) -> Iterator[dict]:
    url = f"{API_BASE}{API_PATH}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    page = 1
    total = 0
    while True:
        params: dict[str, Any] = {PAGE_PARAM: page, SIZE_PARAM: PAGE_SIZE}
        if EXTRA_QUERY:
            for kv in EXTRA_QUERY.split("&"):
                k, _, v = kv.partition("=")
                params[k] = v
        body = _request_with_retry(url, headers, params)
        records = _dig(body, RECORDS_KEY)
        if not isinstance(records, list):
            raise ValueError(
                f"Expected a list at JL_RECORDS_KEY='{RECORDS_KEY}', got {type(records)}. "
                f"Check the endpoint's response shape."
            )
        if not records:
            break
        for r in records:
            yield r
        total += len(records)
        log.info("Fetched page %s (%s rows, %s total)", page, len(records), total)
        if len(records) < PAGE_SIZE:
            break
        page += 1
    log.info("Fetch complete: %s rows", total)


# --- Load -------------------------------------------------------------------

def load_to_bq(rows: list[dict]) -> None:
    client = bigquery.Client(project=BQ_PROJECT)
    table_id = f"{BQ_PROJECT}.{BQ_DATASET}.{BQ_TABLE}"
    # Load as newline-delimited JSON with schema autodetect. For a stable schema,
    # swap autodetect for an explicit `schema=[...]` (see README).
    job_config = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=WRITE_MODE,
        autodetect=True,
    )
    payload = "\n".join(json.dumps(r, default=str) for r in rows).encode("utf-8")
    if not payload:
        log.warning("No rows fetched — skipping load (table left unchanged).")
        return
    from io import BytesIO
    job = client.load_table_from_file(BytesIO(payload), table_id, job_config=job_config)
    job.result()
    table = client.get_table(table_id)
    log.info("Loaded %s rows into %s (now %s total rows)", len(rows), table_id, table.num_rows)


# --- Entrypoint -------------------------------------------------------------

def main() -> None:
    token = get_token()
    rows = list(fetch_all(token))
    load_to_bq(rows)
    log.info("Done.")


if __name__ == "__main__":
    main()
