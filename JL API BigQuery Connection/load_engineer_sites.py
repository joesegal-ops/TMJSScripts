#!/usr/bin/env python3
"""
Engineer daily AM/PM sites -> raw.engineer_daily_sites.

The allocator sets each engineer's site on the Planner as Non-Productive Time whose TYPE is the site
name (e.g. "33 Queen Street"): first one of the day = AM site, second = PM site, only one = whole day.
Other NPT types (AL - Holiday, Sick Leave, Placeholder, Early Starter...) go to other_npt.

Source: POST /api/v1/Visit/SearchPlanner with IncludeNonProductiveTime=true (visits off).
  - Window is capped at one month per call -> chunked.
  - StartDate/EndDate come back in UTC -> converted to Europe/London before bucketing by day.
  - GAP: future RECURRING NPT instances are not returned (only one-offs); recurring entries are
    present once the day arrives. So the default window ends today (JL_SITES_AHEAD_DAYS=0) --
    fine for same-day allocation, incomplete for later days.

Each run replaces its window [today-BACK .. today+AHEAD] in one BigQuery transaction, so a site the
allocator changes or removes during the day is reflected on the next run.

Creds/config from env (wrapper run_engineer_sites.sh pulls them from Secret Manager), same as loader.py.
BigQuery auth = VM service account (ADC).
"""
import datetime as dt
import json
import logging
import os
import re
import sys
import time
from zoneinfo import ZoneInfo

import requests
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger("engineer_sites")


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
TABLE = f"{BQ_PROJECT}.{BQ_DATASET}.engineer_daily_sites"

BACK_DAYS = int(env("JL_SITES_BACK_DAYS", "7"))
AHEAD_DAYS = int(env("JL_SITES_AHEAD_DAYS", "0"))
CHUNK_DAYS = 28                                   # API rejects ranges over one month
RATE_MIN_INTERVAL = float(env("JL_MIN_INTERVAL", "0.65"))
HTTP_TIMEOUT = int(env("JL_HTTP_TIMEOUT", "60"))
MAX_RETRIES = int(env("JL_MAX_RETRIES", "5"))

UK = ZoneInfo("Europe/London")
UTC = dt.timezone.utc

# Non-site NPT types. Anything not matched here or by REGION_RE is treated as a site.
NON_SITE_RE = re.compile(r"^(AL - Holiday|Holiday|Sick Leave|NOT AVAILABLE|Placeholder|Early Starter.*|Scoping/Snagging)$", re.I)
UNAVAILABLE_RE = re.compile(r"^(AL - Holiday|Holiday|Sick Leave|NOT AVAILABLE)$", re.I)
REGION_RE = re.compile(r"^(East|West|North|South)( - Region \d+)?$", re.I)

_last_call = 0.0


def get_token():
    r = requests.post(TOKEN_URL, data={"grant_type": "client_credentials", "client_id": CLIENT_ID,
                                       "client_secret": CLIENT_SECRET, "scope": SCOPE},
                      timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    return r.json()["access_token"]


def api_post(session, path, body):
    global _last_call
    for attempt in range(1, MAX_RETRIES + 1):
        wait = RATE_MIN_INTERVAL - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
        r = session.post(f"{API_BASE}/api/v1/{path}", json=body, timeout=HTTP_TIMEOUT)
        if r.status_code == 429 or r.status_code >= 500 or r.status_code == 403:
            # 403 HTML here is the Azure gateway rate limit, not auth (see jl-azure-waf-rate-limit).
            log.warning("%s -> HTTP %s (attempt %d), backing off", path, r.status_code, attempt)
            time.sleep(min(60, 5 * attempt))
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError(f"{path}: gave up after {MAX_RETRIES} attempts")


def engineers(session):
    out, page = [], 1
    while True:
        j = api_post(session, "Engineer/GetAll", {"TenantId": TENANT_ID, "PageIndex": page, "PageSize": 50})
        items = j.get("Items") or []
        out += items
        if not items or len(out) >= (j.get("TotalCount") or 0):
            return out
        page += 1


def uk_time(s):
    return dt.datetime.fromisoformat(s.rstrip("Z")).replace(tzinfo=UTC).astimezone(UK)


def npt_items(session, ids, start, end_inclusive):
    items, d = [], start
    while d <= end_inclusive:
        chunk_end = min(end_inclusive, d + dt.timedelta(days=CHUNK_DAYS - 1))
        # API dates are UTC; pad a day either side and filter on UK date below.
        j = api_post(session, "Visit/SearchPlanner", {
            "TenantId": TENANT_ID, "EngineerIds": ids,
            "StartDate": (d - dt.timedelta(days=1)).isoformat(),
            "EndDate": (chunk_end + dt.timedelta(days=1)).isoformat(),
            "IncludeNonProductiveTime": True, "IncludeReactiveVisits": False, "IncludePPMVisits": False,
            "IncludeCancelledVisits": False, "IncludeCompletedVisits": False, "IncludeRejectedVisits": False})
        items += [x for x in (j.get("Items") or []) if x.get("IsNonProductiveType")]
        d = chunk_end + dt.timedelta(days=1)
    # Chunk padding overlaps; de-dupe on engineer + type + start.
    seen, out = set(), []
    for x in items:
        k = (x.get("EngineerId"), x.get("TypeId"), x.get("StartDate"))
        if k not in seen:
            seen.add(k)
            out.append(x)
    return out


def build_rows(items, emails, start, end_inclusive):
    by_key = {}
    for x in sorted(items, key=lambda x: x["StartDate"]):
        s, e = uk_time(x["StartDate"]), uk_time(x["EndDate"])
        day = s.date()
        if not (start <= day <= end_inclusive):
            continue
        k = (day, x["EngineerId"])
        o = by_key.setdefault(k, {"sites": [], "region": [], "other": [], "unavail": False,
                                  "name": (x.get("EngineerName") or "").strip()})
        t = (x.get("TypeDescription") or x.get("Title") or "").strip()
        if NON_SITE_RE.match(t):
            o["unavail"] |= bool(UNAVAILABLE_RE.match(t))
            reason = (x.get("Reason") or "").strip()
            o["other"].append(f"{t} {s:%H:%M}-{e:%H:%M}" + (f" ({reason})" if reason else ""))
        elif REGION_RE.match(t):
            o["region"].append(t)
        elif t:
            o["sites"].append(t)

    now = dt.datetime.now(UTC).isoformat()
    rows = []
    for (day, eid), o in sorted(by_key.items(), key=lambda kv: (kv[0][0], kv[1]["name"])):
        sites = o["sites"]
        rows.append({
            "date": day.isoformat(), "engineer_id": eid, "engineer": o["name"],
            "engineer_email": emails.get(eid),
            "am_site": sites[0] if sites else None,
            "pm_site": sites[1] if len(sites) > 1 else (sites[0] if sites else None),
            "extra_sites": " / ".join(sites[2:]) or None,
            "region": " / ".join(o["region"]) or None,
            "other_npt": "; ".join(o["other"]) or None,
            "is_unavailable": o["unavail"],
            "_ingested_at": now,
        })
    return rows


def replace_window(bq, start, end_inclusive, rows):
    sql = f"""
BEGIN TRANSACTION;
DELETE FROM `{TABLE}` WHERE date BETWEEN @start AND @end;
INSERT INTO `{TABLE}` (date, engineer_id, engineer, engineer_email, am_site, pm_site, extra_sites,
                       region, other_npt, is_unavailable, _ingested_at)
SELECT DATE(JSON_VALUE(r, '$.date')), CAST(JSON_VALUE(r, '$.engineer_id') AS INT64),
       JSON_VALUE(r, '$.engineer'), JSON_VALUE(r, '$.engineer_email'),
       JSON_VALUE(r, '$.am_site'), JSON_VALUE(r, '$.pm_site'), JSON_VALUE(r, '$.extra_sites'),
       JSON_VALUE(r, '$.region'), JSON_VALUE(r, '$.other_npt'),
       CAST(JSON_VALUE(r, '$.is_unavailable') AS BOOL), TIMESTAMP(JSON_VALUE(r, '$._ingested_at'))
FROM UNNEST(JSON_QUERY_ARRAY(@payload)) AS r;
COMMIT TRANSACTION;"""
    cfg = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("start", "DATE", start),
        bigquery.ScalarQueryParameter("end", "DATE", end_inclusive),
        bigquery.ScalarQueryParameter("payload", "STRING", json.dumps(rows)),
    ])
    bq.query(sql, job_config=cfg, location="EU").result()


def main():
    today = dt.datetime.now(UK).date()
    start, end = today - dt.timedelta(days=BACK_DAYS), today + dt.timedelta(days=AHEAD_DAYS)

    session = requests.Session()
    session.headers["Authorization"] = f"Bearer {get_token()}"
    engs = engineers(session)
    ids = [e["Id"] for e in engs if isinstance(e.get("Id"), int)]
    emails = {e["Id"]: (e.get("Email") or e.get("EmailAddress")) for e in engs if isinstance(e.get("Id"), int)}
    log.info("engineers: %d (with email: %d)", len(ids), sum(1 for v in emails.values() if v))

    items = npt_items(session, ids, start, end)
    rows = build_rows(items, emails, start, end)
    log.info("window %s..%s: %d NPT items -> %d engineer-day rows (%d with a site)",
             start, end, len(items), len(rows), sum(1 for r in rows if r["am_site"]))
    if not rows:
        # An empty result would wipe the window; treat it as a failure rather than trust it.
        log.error("no NPT rows returned for the window; leaving the table untouched")
        sys.exit(1)

    replace_window(bigquery.Client(project=BQ_PROJECT), start, end, rows)
    log.info("replaced %s window in %s", f"{start}..{end}", TABLE)


if __name__ == "__main__":
    main()
