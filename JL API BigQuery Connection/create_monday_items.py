"""
JobLogic -> Monday ITEM CREATOR (replaces the manual Google-Sheet -> Monday import).

For every WeWork Ltd **Project** job (raw.jobs.TypeDescription='Project',
CustomerName='WeWork Ltd') logged on/after a cutover date, create one item on the board
"Minor Projects - WW Active" (5084790211, group "To Do / Pending") if the job does not already
have an item.

Decisions (settled 2026-07-22, see MONDAY_SYNC_SPEC.md / memory jl-monday-quote-job-link):
  * SCOPE       : Project jobs only (reactive/RE items keep coming from the Form/manual entry).
  * BACKFILL    : NEW-ONLY from a cutover date (MONDAY_CREATE_CUTOVER). History is left alone.
  * DEDUP KEY   : Original Job Ref (text_mkyrcb16). A job whose JobNumber already appears in the
                  Original OR Upgraded job-ref column of any item is NEVER recreated.
  * TARGET GROUP: "To Assign" (group_mm5h3yrn) -- dedicated intake group for auto-created items.
  * ITEM NAME   : first line of the JL Description (verbatim). Full multi-line description is
                  posted as the item's first Update so no context is lost.
  * FIELDS SET  : Original Job Ref <- JobNumber; Site <- SiteName (only when it exactly matches an
                  active Site dropdown label; never invents labels); Client Ref <- CustomReference
                  or OrderNumber (numeric Customer Order / Salesforce no. only).
  * LEAD PM     : NOT set here -- a board automation ("when an item is created, assign creator as
                  Lead PM") owns it, so every auto-created item's Lead PM = the API token's user.
                  Owner->user matching stays in the code, gated behind MONDAY_SET_LEAD_PM=1 (off).
  * LEFT BLANK  : Project Type, Client status, PO Number, Quote, dates, priority (PM-filled).

NOT in this module: writing the Lead PM back onto the JL job owner (the requested two-way sync).
That needs JL write access + a confirmed job-update endpoint -- tracked as a follow-up spike.

SAFETY: dry-run by default. Creates only when MONDAY_CREATE_APPLY=1. MAX_CREATE caps a single run.
  Dry run (default):   ./venv/bin/python create_monday_items.py
  Apply:               MONDAY_CREATE_APPLY=1 ./venv/bin/python create_monday_items.py
  Single-job test:     MONDAY_CREATE_ONLY=PROJ0002300 MONDAY_CREATE_APPLY=1 ./venv/bin/python create_monday_items.py
"""
import json
import csv
import logging
import os
import re
import sys
import time

import requests
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("monday-create")


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and not v:
        log.error("Missing required env var: %s", name); sys.exit(2)
    return v


MONDAY_TOKEN   = env("MONDAY_TOKEN", required=True)
MONDAY_API     = env("MONDAY_API", "https://api.monday.com/v2")
MONDAY_APIVER  = env("MONDAY_API_VERSION", "2024-10")
BQ_PROJECT     = env("BQ_PROJECT", "vmimporteddata")
BQ_DATASET     = env("BQ_DATASET", "raw")
BOARD_ID       = int(env("MONDAY_BOARD_ID", "5084790211"))
GROUP_ID       = env("MONDAY_GROUP_ID", "group_mm5h3yrn")     # "To Assign"
COL_ANCHOR     = env("MONDAY_COL_ANCHOR", "text_mkyrcb16")   # Original Job Ref. (set + dedup)
COL_UPGRADED   = env("MONDAY_COL_UPGRADED", "text_mm5gxah5")  # Upgraded Job Ref (dedup only)
COL_SITE       = env("MONDAY_COL_SITE", "dropdown_Mjj5Knmc")  # Site (dropdown)
COL_CLIENTREF  = env("MONDAY_COL_CLIENTREF", "text_mkxc7pxe")  # Client Ref. (Salesforce no.)
COL_PERSON     = env("MONDAY_COL_PERSON", "person")           # Lead PM (people)
CUTOVER        = env("MONDAY_CREATE_CUTOVER", required=True)  # ISO date, e.g. 2026-07-23 (go-live)
CUSTOMER_NAME  = env("MONDAY_CREATE_CUSTOMER", "WeWork Ltd")
JOB_TYPE       = env("MONDAY_CREATE_JOBTYPE", "Project")
EXCLUDE_STATUS = [s.strip() for s in env("MONDAY_CREATE_EXCLUDE_STATUS", "Cancelled").split(",") if s.strip()]
SET_LEAD_PM    = env("MONDAY_SET_LEAD_PM", "0") == "1"       # OFF: a board automation assigns
                                                            # creator as Lead PM on create (owns it)
APPLY          = env("MONDAY_CREATE_APPLY", "0") == "1"
ONLY           = env("MONDAY_CREATE_ONLY")                    # optional: limit to one JobNumber
MAX_CREATE     = int(env("MONDAY_CREATE_MAX", "50"))          # per-run backstop
PAGE_LIMIT     = int(env("MONDAY_PAGE_LIMIT", "500"))
REPORT_PATH    = env("MONDAY_CREATE_REPORT", "/tmp/monday_create_report.csv")

# Optional: enrich each to-create job with LIVE fields from JL Job/GetById right before writing,
# so a stale warehouse row (e.g. a Customer Order Number back-edited onto an old job after the
# nightly full, which the incremental won't re-pull) can't yield a blank cell. Runs ONLY on the
# whitelisted VM (needs JL creds + whitelisted IP); silently skipped elsewhere / on any per-job error.
ENRICH         = env("MONDAY_CREATE_ENRICH", "1") == "1"
JL_CID         = env("JL_CLIENT_ID"); JL_CSEC = env("JL_CLIENT_SECRET"); JL_TID = env("JL_TENANT_ID")
JL_API         = env("JL_API", "https://api.joblogic.com/api/v1")
JL_TOKEN_URL   = env("JL_TOKEN_URL", "https://identityservice.joblogic.com/connect/token")

HDRS = {"Authorization": MONDAY_TOKEN, "Content-Type": "application/json",
        "API-Version": MONDAY_APIVER}


def monday(query, variables=None, tries=5):
    """POST a GraphQL op; retry on 429 / complexity-budget errors."""
    for attempt in range(1, tries + 1):
        r = requests.post(MONDAY_API, headers=HDRS,
                          json={"query": query, "variables": variables or {}}, timeout=60)
        if r.status_code == 429:
            wait = min(2 ** attempt, 60); log.warning("429; sleeping %ss", wait); time.sleep(wait); continue
        try:
            body = r.json()
        except Exception:
            r.raise_for_status(); raise
        if "errors" in body:
            msg = json.dumps(body["errors"])[:300]
            if "omplexity" in msg or "budget" in msg.lower():
                wait = min(2 ** attempt, 60); log.warning("complexity limit; sleeping %ss", wait); time.sleep(wait); continue
            raise RuntimeError(f"Monday GraphQL error: {msg}")
        return body["data"]
    raise RuntimeError("Monday API: exhausted retries")


def norm(s):
    return (s or "").strip()


def first_line(desc):
    """Item name = first non-empty line of the description, trimmed; Monday name cap = 255.
    Strips a leading 'Title:' label some JL descriptions carry."""
    for line in (desc or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        t = re.sub(r"^\s*title\s*:\s*", "", line.strip(), flags=re.I)
        if t:
            return t[:255]
    return ""


def base_job(jn):
    """Collapse a sub-job number to its base project: 'PROJ0002183/001' -> 'PROJ0002183'."""
    return re.sub(r"/\d+$", "", jn or "").strip()


def name_keys(s):
    """Set of normalised keys for a person name, tolerant of ordering and joined first names.
    Email-style names ('yande.pereira@up-fm.com') are reduced to their local part.
      'Molly Kate Latham-James' and 'mollykate latham james'  -> share the in-order concat key
      'Latham-James, Molly'      and 'Molly Latham-James'      -> share the sorted-token key
    """
    n = (s or "").lower()
    if "@" in n:
        n = n.split("@", 1)[0]
    toks = re.findall(r"[a-z0-9]+", n)
    if not toks:
        return set()
    return {" ".join(sorted(toks)), "".join(toks)}


# ---------------------------------------------------------------------------

def desired_jobs():
    """WeWork Project jobs logged on/after the cutover: {JobNumber -> {...fields}}."""
    bq = bigquery.Client(project=BQ_PROJECT)
    sql = f"""
      SELECT Id, JobNumber, Description, SiteName, JobOwner, CustomReference, OrderNumber, DateLogged
      FROM `{BQ_PROJECT}.{BQ_DATASET}.jobs`
      WHERE TypeDescription=@jobtype AND CustomerName=@customer
        AND JobNumber IS NOT NULL AND JobNumber != ''
        AND DateLogged >= TIMESTAMP(@cutover)
        AND (@nexcl = 0 OR JobStatusDescription IS NULL
             OR JobStatusDescription NOT IN UNNEST(@exclude))
      ORDER BY DateLogged
    """
    cfg = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("jobtype", "STRING", JOB_TYPE),
        bigquery.ScalarQueryParameter("customer", "STRING", CUSTOMER_NAME),
        bigquery.ScalarQueryParameter("cutover", "STRING", CUTOVER),
        bigquery.ScalarQueryParameter("nexcl", "INT64", len(EXCLUDE_STATUS)),
        bigquery.ArrayQueryParameter("exclude", "STRING", EXCLUDE_STATUS),
    ])
    out = {}
    for r in bq.query(sql, job_config=cfg).result():
        base = base_job(r["JobNumber"])
        if base in out:                       # sub-job (/000,/001,...): keep the first, one item per project
            continue
        out[base] = {
            "id": "" if r["Id"] is None else str(r["Id"]),
            "desc": r["Description"] or "",
            "site": norm(r["SiteName"]),
            "owner": norm(r["JobOwner"]),
            "clientref": norm(r["CustomReference"]) or norm(r["OrderNumber"]),
        }
    log.info("BigQuery: %d %s projects for %s logged on/after %s (excluding status: %s)",
             len(out), JOB_TYPE, CUSTOMER_NAME, CUTOVER, ", ".join(EXCLUDE_STATUS) or "none")
    return out


def existing_refs():
    """Set of every job ref already on the board (Original OR Upgraded col) -> dedup key."""
    refs, cursor, seen = set(), None, 0
    cols = '"%s","%s"' % (COL_ANCHOR, COL_UPGRADED)
    first = ("query ($board: [ID!], $limit: Int!) { boards(ids: $board) { "
             "items_page(limit: $limit) { cursor items { id "
             "column_values(ids: [%s]) { id text } } } } }") % cols
    nxt = ("query ($cursor: String!, $limit: Int!) { "
           "next_items_page(cursor: $cursor, limit: $limit) { cursor items { id "
           "column_values(ids: [%s]) { id text } } } }") % cols
    while True:
        if cursor is None:
            page = monday(first, {"board": [BOARD_ID], "limit": PAGE_LIMIT})["boards"][0]["items_page"]
        else:
            page = monday(nxt, {"cursor": cursor, "limit": PAGE_LIMIT})["next_items_page"]
        for it in page["items"]:
            seen += 1
            for c in it["column_values"]:
                v = base_job(norm(c["text"]))
                if v:
                    refs.add(v.upper())
        cursor = page["cursor"]
        if not cursor:
            break
    log.info("Monday: scanned %d items; %d distinct existing job refs (dedup set)", seen, len(refs))
    return refs


def site_label_map():
    """{lowercased active Site label -> exact label} from the live dropdown settings."""
    q = ('query ($board: [ID!]) { boards(ids: $board) { columns(ids: ["%s"]) { settings_str } } }') % COL_SITE
    cols = monday(q, {"board": [BOARD_ID]})["boards"][0]["columns"]
    if not cols:
        log.warning("Site column %s not found; sites will be left blank", COL_SITE); return {}
    settings = json.loads(cols[0]["settings_str"] or "{}")
    labels = settings.get("labels", [])
    out = {}
    if isinstance(labels, dict):                       # legacy shape {"1":"P&D",...}
        for lbl in labels.values():
            if lbl:
                out[lbl.strip().lower()] = lbl.strip()
    else:                                              # [{id,label/name,is_deactivated}]
        for lb in labels:
            if lb.get("is_deactivated"):
                continue
            lbl = (lb.get("label") or lb.get("name") or "").strip()
            if lbl:
                out[lbl.lower()] = lbl
    log.info("Monday: %d active Site labels", len(out))
    return out


def user_index():
    """({name_key -> {user_ids}}, preferred_ids). Preferred = this board's owners+subscribers,
    used to break ties when a name maps to more than one Monday account (e.g. duplicate profiles)."""
    key_ids = {}
    q = "query ($page: Int!) { users(limit: 400, page: $page, kind: all) { id name enabled } }"
    page = 1
    while True:
        batch = monday(q, {"page": page})["users"]
        if not batch:
            break
        for u in batch:
            if u.get("enabled") is False:
                continue
            uid = int(u["id"])
            for k in name_keys(u["name"]):
                key_ids.setdefault(k, set()).add(uid)
        page += 1
    pq = "query ($board: [ID!]) { boards(ids: $board) { owners { id } subscribers { id } } }"
    b = monday(pq, {"board": [BOARD_ID]})["boards"][0]
    preferred = {int(o["id"]) for o in b.get("owners", [])} | {int(s["id"]) for s in b.get("subscribers", [])}
    log.info("Monday: user index over %d name keys; %d preferred (board owners/subscribers)",
             len(key_ids), len(preferred))
    return key_ids, preferred


def match_user(owner, key_ids, preferred):
    """Resolve a JL owner name to a single Monday user id, or (None, reason)."""
    cands = set()
    for k in name_keys(owner):
        cands |= key_ids.get(k, set())
    if not cands:
        return None, "no Monday user"
    if len(cands) == 1:
        return next(iter(cands)), None
    narrowed = cands & preferred            # tie-break duplicate accounts toward board members
    if len(narrowed) == 1:
        return next(iter(narrowed)), None
    return None, f"{len(cands)} matching accounts (ambiguous)"


# ---------------------------------------------------------------------------

def jl_token():
    """OAuth client-credentials token for the official JL API (VM-only; needs whitelisted IP)."""
    r = requests.post(JL_TOKEN_URL, timeout=60, data={
        "grant_type": "client_credentials", "client_id": JL_CID,
        "client_secret": JL_CSEC, "scope": "JL.Api"})
    r.raise_for_status()
    return r.json()["access_token"]


def enrich_job(job, token):
    """Override job fields with LIVE values from Job/GetById (Description, Customer Order Number,
    Site, Owner). No-op on any error -> falls back to the warehouse values already in `job`."""
    jid = job.get("id")
    if not jid:
        return
    try:
        r = requests.get(f"{JL_API}/Job/GetById", params={"id": jid, "tenantId": JL_TID},
                         headers={"Authorization": f"Bearer {token}"}, timeout=40)
        if r.status_code != 200:
            log.warning("  enrich %s: GetById HTTP %s -- using warehouse fields", jid, r.status_code)
            return
        o = r.json()
        o = o.get("Data", o) if isinstance(o, dict) else {}
        if o.get("Description"):
            job["desc"] = o["Description"]
        if norm(o.get("OrderNumber")):
            job["clientref"] = norm(o["OrderNumber"])
        site = (o.get("Site") or {}).get("Name") if isinstance(o.get("Site"), dict) else None
        if norm(site):
            job["site"] = norm(site)
        if norm(o.get("Owner")):
            job["owner"] = norm(o["Owner"])
    except Exception as e:
        log.warning("  enrich %s failed (%s) -- using warehouse fields", jid, e)


def build_values(job, sites, key_ids, preferred):
    """column_values dict + a list of human notes about anything left blank."""
    vals = {COL_ANCHOR: job["_jobnumber"]}
    notes = []

    site = job["site"]
    if site and site.lower() in sites:
        vals[COL_SITE] = {"labels": [sites[site.lower()]]}
    elif site:
        notes.append(f"site '{site}' has no matching dropdown label")

    ref = job["clientref"]
    if ref and re.fullmatch(r"\d+", ref):
        vals[COL_CLIENTREF] = ref
    elif ref:
        notes.append(f"client ref '{ref}' not numeric")

    owner = job["owner"]
    if SET_LEAD_PM and owner:                 # off by default: board automation assigns Lead PM
        uid, reason = match_user(owner, key_ids, preferred)
        if uid:
            vals[COL_PERSON] = {"personsAndTeams": [{"id": uid, "kind": "person"}]}
        else:
            notes.append(f"owner '{owner}' -> {reason}")
    return vals, notes


def create_item(name, vals):
    m = """
      mutation ($board: ID!, $group: String!, $name: String!, $vals: JSON!) {
        create_item(board_id: $board, group_id: $group, item_name: $name,
                    column_values: $vals, create_labels_if_missing: false) { id }
      }"""
    data = monday(m, {"board": BOARD_ID, "group": GROUP_ID, "name": name, "vals": json.dumps(vals)})
    return data["create_item"]["id"]


def post_update(item_id, body):
    m = "mutation ($item: ID!, $body: String!) { create_update(item_id: $item, body: $body) { id } }"
    monday(m, {"item": item_id, "body": body})


def main():
    log.info("mode = %s%s | scope=%s/%s | cutover>=%s | group=%s | max=%d",
             "APPLY (creates items)" if APPLY else "DRY-RUN (no writes)",
             f", ONLY={ONLY}" if ONLY else "", CUSTOMER_NAME, JOB_TYPE, CUTOVER, GROUP_ID, MAX_CREATE)

    jobs = desired_jobs()
    have = existing_refs()
    sites = site_label_map()
    key_ids, preferred = user_index()

    token = None
    if ENRICH and JL_CID and JL_CSEC and JL_TID:
        try:
            token = jl_token(); log.info("enrichment ON: live Job/GetById per new job")
        except Exception as e:
            log.warning("enrichment OFF: JL token failed (%s) -- using warehouse fields", e)
    elif ENRICH:
        log.info("enrichment OFF: no JL creds in env -- using warehouse fields")

    plan, skipped_existing = [], 0
    for jn, job in sorted(jobs.items()):
        if ONLY and jn != ONLY:
            continue
        if jn.upper() in have:
            skipped_existing += 1
            continue
        if token:
            enrich_job(job, token)
        job["_jobnumber"] = jn
        vals, notes = build_values(job, sites, key_ids, preferred)
        name = first_line(job["desc"]) or jn
        plan.append({"job": jn, "name": name, "vals": vals, "desc": job["desc"], "notes": notes})

    log.info("to create=%d, already-on-board=%d (skipped)", len(plan), skipped_existing)

    # --- plan report (always written) ---
    with open(REPORT_PATH, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["job", "name", "site", "client_ref", "lead_pm_set", "notes"])
        w.writeheader()
        for p in plan:
            w.writerow({
                "job": p["job"], "name": p["name"][:80],
                "site": p["vals"].get(COL_SITE, {}).get("labels", [""])[0] if COL_SITE in p["vals"] else "",
                "client_ref": p["vals"].get(COL_CLIENTREF, ""),
                "lead_pm_set": "yes" if COL_PERSON in p["vals"] else "no",
                "notes": "; ".join(p["notes"]),
            })
    log.info("plan report -> %s (%d rows)", REPORT_PATH, len(plan))
    for p in plan[:40]:
        log.info("  CREATE %s '%s'%s", p["job"], p["name"][:55],
                 (" [" + "; ".join(p["notes"]) + "]") if p["notes"] else "")
    if len(plan) > 40:
        log.info("  ... and %d more in the CSV", len(plan) - 40)

    if not APPLY:
        log.info("DRY-RUN: no items created. Set MONDAY_CREATE_APPLY=1 to create the %d item(s).", len(plan))
        return

    if len(plan) > MAX_CREATE:
        log.warning("plan (%d) exceeds MAX_CREATE (%d); creating only the first %d this run. "
                    "Raise MONDAY_CREATE_MAX to do more.", len(plan), MAX_CREATE, MAX_CREATE)
        plan = plan[:MAX_CREATE]

    created = 0
    for p in plan:
        item_id = create_item(p["name"], p["vals"])
        if norm(p["desc"]) and first_line(p["desc"]) != p["desc"].strip():
            post_update(item_id, p["desc"].strip())   # full multi-line description into the body
        created += 1
        log.info("  created item %s for %s", item_id, p["job"])
        time.sleep(0.35)
    log.info("APPLIED: created %d item(s). Plan -> %s", created, REPORT_PATH)


if __name__ == "__main__":
    main()
