"""
JL job status -> Monday status columns (phase 1 of the bidirectional status sync; see
MONDAY_SYNC_SPEC.md). Reads each upgraded job's current status from raw.jobs and sets the Monday
item's PM Stat. / Finance Stat. per the agreed mapping. Keyed by the job number in the item's
Upgraded Job Ref (preferred) or Original Job Ref (historical, where the upgraded # was typed).

Idempotent: writes a status column only when its current label differs. SAFE: dry-run by default;
writes only when MONDAY_SYNC_APPLY=1.

Mapping source of truth: mapping_jl_to_monday.csv (kept in sync with MAP below).
Never sets 'Approved' — that stays JL-only and is handled by the Monday->JL guard phase.

  Dry run:  ./venv/bin/python sync_status.py
  Apply:    MONDAY_SYNC_APPLY=1 ./venv/bin/python sync_status.py
"""
import json, logging, os, sys, time
import requests
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("status-sync")

def env(n, d=None, required=False):
    v = os.environ.get(n, d)
    if required and not v: log.error("Missing env %s", n); sys.exit(2)
    return v

MONDAY_TOKEN = env("MONDAY_TOKEN", required=True)
MONDAY_API   = env("MONDAY_API", "https://api.monday.com/v2")
MONDAY_APIVER= env("MONDAY_API_VERSION", "2024-10")
BQ_PROJECT   = env("BQ_PROJECT", "vmimporteddata")
BQ_DATASET   = env("BQ_DATASET", "raw")
BOARD_ID     = int(env("MONDAY_BOARD_ID", "5084790211"))
COL_ANCHOR   = env("MONDAY_COL_ANCHOR", "text_mkyrcb16")    # Original Job Ref.
COL_UPGRADED = env("MONDAY_COL_UPGRADED", "text_mm5gxah5")  # Upgraded Job Ref
COL_PMSTAT   = env("MONDAY_COL_PMSTAT", "status")           # PM Stat.
COL_FINANCE  = env("MONDAY_COL_FINANCE", "color_mkvy3avs")  # Finance Stat.
APPLY        = env("MONDAY_SYNC_APPLY", "0") == "1"
ONLY         = env("MONDAY_SYNC_ONLY")                       # optional: limit to one job ref
PAGE_LIMIT   = int(env("MONDAY_PAGE_LIMIT", "500"))

# JL JobStatusId -> list of (monday_column_id, target label). Empty list = leave unchanged.
MAP = {
    5:  [],                                      # New Job         -> (no change)
    7:  [(COL_PMSTAT, "Project In Progress")],   # Allocated
    1:  [(COL_PMSTAT, "Project In Progress")],   # Attended
    6:  [(COL_PMSTAT, "Project In Progress")],   # Parts To Fit
    9:  [(COL_PMSTAT, "Project In Progress")],   # Awaiting Parts
    2:  [],                                      # Costed          -> (no change)
    8:  [(COL_FINANCE, "To Invoice")],           # Reqs. Invoice
    4:  [(COL_PMSTAT, "Complete"), (COL_FINANCE, "Invoiced")],  # Invoiced
    11: [(COL_PMSTAT, "Complete")],              # Completed
    10: [(COL_PMSTAT, "Lost/Not Progressed")],   # Cancelled
}

HDRS = {"Authorization": MONDAY_TOKEN, "Content-Type": "application/json", "API-Version": MONDAY_APIVER}

def monday(query, variables=None, tries=5):
    for attempt in range(1, tries + 1):
        r = requests.post(MONDAY_API, headers=HDRS, json={"query": query, "variables": variables or {}}, timeout=60)
        if r.status_code == 429:
            time.sleep(min(2 ** attempt, 60)); continue
        body = r.json()
        if "errors" in body:
            msg = json.dumps(body["errors"])[:300]
            if "omplexity" in msg or "budget" in msg.lower():
                time.sleep(min(2 ** attempt, 60)); continue
            raise RuntimeError("Monday error: " + msg)
        return body["data"]
    raise RuntimeError("Monday API: exhausted retries")

def norm(s): return (s or "").strip()

def job_status_by_number():
    bq = bigquery.Client(project=BQ_PROJECT)
    sql = f"SELECT JobNumber, ANY_VALUE(JobStatusId) sid FROM `{BQ_PROJECT}.{BQ_DATASET}.jobs` " \
          f"WHERE JobNumber IS NOT NULL GROUP BY JobNumber"
    out = {norm(r["JobNumber"]): r["sid"] for r in bq.query(sql).result()}
    log.info("BigQuery: %d jobs", len(out))
    return out

def board_items():
    cols = '"%s","%s","%s","%s"' % (COL_ANCHOR, COL_UPGRADED, COL_PMSTAT, COL_FINANCE)
    first = ("query($b:[ID!],$l:Int!){boards(ids:$b){items_page(limit:$l){cursor items{id name "
             "column_values(ids:[%s]){id text}}}}}") % cols
    nxt = ("query($c:String!,$l:Int!){next_items_page(cursor:$c,limit:$l){cursor items{id name "
           "column_values(ids:[%s]){id text}}}}") % cols
    cursor, out = None, []
    while True:
        page = (monday(first, {"b": [BOARD_ID], "l": PAGE_LIMIT})["boards"][0]["items_page"]
                if cursor is None else monday(nxt, {"c": cursor, "l": PAGE_LIMIT})["next_items_page"])
        for it in page["items"]:
            cv = {c["id"]: norm(c["text"]) for c in it["column_values"]}
            out.append((it["id"], it["name"], cv))
        cursor = page["cursor"]
        if not cursor: break
    log.info("Monday: scanned %d items", len(out))
    return out

def write_cols(item_id, vals):
    # vals: {col_id: label}
    cvjson = {c: {"label": v} for c, v in vals.items()}
    m = "mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}"
    monday(m, {"b": BOARD_ID, "i": str(item_id), "v": json.dumps(cvjson)})

def main():
    log.info("mode = %s%s", "APPLY" if APPLY else "DRY-RUN", f", ONLY={ONLY}" if ONLY else "")
    jobs = job_status_by_number()
    planned, no_job, no_change = [], 0, 0
    for item_id, name, cv in board_items():
        jobno = cv.get(COL_UPGRADED) or cv.get(COL_ANCHOR)   # prefer the upgraded job number
        if not jobno or (ONLY and jobno != ONLY):
            continue
        sid = jobs.get(jobno)
        if sid is None: no_job += 1; continue
        targets = MAP.get(sid, [])
        diffs = {}
        for col, label in targets:
            if cv.get(col, "") != label:
                diffs[col] = label
        if not diffs: no_change += 1; continue
        planned.append((jobno, sid, item_id, name, cv, diffs))

    log.info("planned changes=%d, up-to-date=%d, items-with-no-JL-job=%d", len(planned), no_change, no_job)
    for jobno, sid, item_id, name, cv, diffs in planned[:60]:
        pretty = ", ".join(f"{'PM' if c==COL_PMSTAT else 'Fin'}: {cv.get(c,'')!r}->{v!r}" for c, v in diffs.items())
        log.info("  %s (sid %s) item %s '%s': %s", jobno, sid, item_id, name[:35], pretty)
    if len(planned) > 60: log.info("  ... and %d more", len(planned) - 60)

    if not APPLY:
        log.info("DRY-RUN: no writes. Set MONDAY_SYNC_APPLY=1 to apply."); return
    for i, (jobno, sid, item_id, name, cv, diffs) in enumerate(planned, 1):
        write_cols(item_id, diffs)
        if i % 25 == 0: log.info("  wrote %d/%d", i, len(planned))
        time.sleep(0.25)
    log.info("APPLIED %d status updates.", len(planned))

if __name__ == "__main__":
    main()
