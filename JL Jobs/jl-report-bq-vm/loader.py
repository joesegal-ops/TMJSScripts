"""
Joblogic API -> BigQuery loader (VM edition).

Runs on the fixed-IP VM via hourly cron. Uses the VM's attached service account for
BigQuery auth (Application Default Credentials - no key files). Joblogic API creds are
read from /opt/jl-loader/secrets.env.

Phase 2 TODO is the transform(): the API returns nested entities, but the downstream
views need the report's exact flat columns (dd/mm/yyyy strings, Engineer_Active Yes/No).
Until that mapping is built and validated, run with LOADER_TARGET=staging + autodetect.
"""

import json
import logging
import os
import sys
import time
from io import BytesIO
from typing import Any, Iterator

import requests
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("jl-report-bq")


def env(name: str, default: str | None = None, required: bool = False) -> str:
    val = os.environ.get(name, default)
    if required and not val:
        log.error("Missing required env var: %s", name)
        sys.exit(2)
    return val  # type: ignore[return-value]


# --- Config (from secrets.env / environment) --------------------------------
TOKEN_URL   = env("JL_TOKEN_URL", "https://identityserver.joblogic.com/connect/token")
API_BASE    = env("JL_API_BASE", "https://api.joblogic.com")
SCOPE       = env("JL_SCOPE", "JL.Api")
CLIENT_ID   = env("JL_CLIENT_ID", required=True)
CLIENT_SECRET = env("JL_CLIENT_SECRET", required=True)

TENANT_ID   = env("JL_TENANT_ID", required=True)         # required on every JL request
API_PATH    = env("JL_API_PATH", required=True)          # e.g. /job or /visit  (confirm in apidocs.joblogic.com)
PAGE_PARAM  = env("JL_PAGE_PARAM", "PageIndex")          # JL uses PageIndex (1-based)
SIZE_PARAM  = env("JL_SIZE_PARAM", "PageSize")
PAGE_SIZE   = min(int(env("JL_PAGE_SIZE", "50")), 50)    # JL hard max is 50
RECORDS_KEY = env("JL_RECORDS_KEY", "")                  # dot-path to the array, "" if body is the array
EXTRA_QUERY = env("JL_EXTRA_QUERY", "")                  # e.g. modifiedSince=... once JL confirms the field

BQ_PROJECT  = env("BQ_PROJECT", "importdata-494110")
BQ_DATASET  = env("BQ_DATASET", "JobLogic")
# Safety: default to a STAGING table so a half-built mapping never clobbers the live table.
LOADER_TARGET = env("LOADER_TARGET", "staging")          # "staging" | "prod"
BQ_TABLE = (
    "Job_and_Visit_Details" if LOADER_TARGET == "prod"
    else "Job_and_Visit_Details_api_staging"
)
WRITE_MODE  = env("BQ_WRITE_MODE", "WRITE_TRUNCATE")
AUTODETECT  = env("BQ_AUTODETECT", "true").lower() == "true"  # Phase 2: set false + explicit schema

HTTP_TIMEOUT = int(env("HTTP_TIMEOUT", "60"))
MAX_RETRIES  = int(env("HTTP_MAX_RETRIES", "4"))


# --- Auth -------------------------------------------------------------------
def get_token() -> str:
    log.info("Requesting access token from %s", TOKEN_URL)
    resp = requests.post(
        TOKEN_URL,
        data={"grant_type": "client_credentials", "client_id": CLIENT_ID,
              "client_secret": CLIENT_SECRET, "scope": SCOPE},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=HTTP_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


# --- Fetch ------------------------------------------------------------------
def _dig(obj: Any, dotted: str) -> Any:
    if not dotted:
        return obj
    for part in dotted.split("."):
        obj = obj[part]
    return obj


def _request_with_retry(url: str, headers: dict, params: dict) -> dict:
    resp = None
    for attempt in range(1, MAX_RETRIES + 1):
        resp = requests.get(url, headers=headers, params=params, timeout=HTTP_TIMEOUT)
        if resp.status_code in (429, 500, 502, 503, 504):
            wait = min(2 ** attempt, 30)
            log.warning("HTTP %s (attempt %s/%s) - retry in %ss", resp.status_code, attempt, MAX_RETRIES, wait)
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json()
    resp.raise_for_status()
    return {}


def fetch_all(token: str) -> Iterator[dict]:
    url = f"{API_BASE}{API_PATH}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    page, total = 1, 0
    while True:
        params: dict[str, Any] = {PAGE_PARAM: page, SIZE_PARAM: PAGE_SIZE, "tenantId": TENANT_ID}
        for kv in filter(None, EXTRA_QUERY.split("&")):
            k, _, v = kv.partition("=")
            params[k] = v
        records = _dig(_request_with_retry(url, headers, params), RECORDS_KEY)
        if not isinstance(records, list):
            raise ValueError(f"Expected a list at JL_RECORDS_KEY='{RECORDS_KEY}', got {type(records)}")
        if not records:
            break
        yield from records
        total += len(records)
        log.info("page %s: %s rows (%s total)", page, len(records), total)
        if len(records) < PAGE_SIZE:
            break
        page += 1
    log.info("fetch complete: %s rows", total)


# --- Transform (PHASE 2) ----------------------------------------------------
def transform(row: dict) -> dict:
    """Map one API entity to the report's flat columns.

    PHASE 2: fill this in once we see a real API response. Target columns + formats:
        Customer, Site, Area, ID, Job_Description, Job_Status, Order_Number,
        Task_Type_ID, Task_Type, Date_Logged(dd/mm/yyyy),
        Target_Completion_Date(dd/mm/yyyy), Date_Complete(dd/mm/yyyy), Engineer,
        Engineer_Active('Yes'/'No'), VisitDateTime(dd/mm/yyyy HH:MM),
        VisitEndDateTime(dd/mm/yyyy HH:MM), Visit_Status, Revisit_Reason, Site_id
    For now (staging + autodetect) we pass rows through untouched.
    """
    if LOADER_TARGET == "prod" and AUTODETECT:
        raise SystemExit("Refusing to write prod with autodetect - build transform() first (Phase 2).")
    return row


# --- Load -------------------------------------------------------------------
def load_to_bq(rows: list[dict]) -> None:
    if not rows:
        log.warning("0 rows fetched - skipping load (table left unchanged).")
        return
    client = bigquery.Client(project=BQ_PROJECT)
    table_id = f"{BQ_PROJECT}.{BQ_DATASET}.{BQ_TABLE}"
    cfg = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=WRITE_MODE,
        autodetect=AUTODETECT,
    )
    payload = "\n".join(json.dumps(r, default=str) for r in rows).encode("utf-8")
    job = client.load_table_from_file(BytesIO(payload), table_id, job_config=cfg)
    job.result()
    log.info("loaded %s rows into %s (target=%s)", len(rows), table_id, LOADER_TARGET)


def main() -> None:
    token = get_token()
    rows = [transform(r) for r in fetch_all(token)]
    load_to_bq(rows)
    log.info("done.")


if __name__ == "__main__":
    main()
</content>
