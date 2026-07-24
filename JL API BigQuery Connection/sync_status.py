"""
JL job status -> Monday (phase 1 of the bidirectional status sync; see MONDAY_SYNC_SPEC.md).

CHANGE-TRIGGERED ("last write wins"): it does NOT keep the two sides equal. It maintains a change
log (raw.job_status_events) and pushes a Monday update only when a job's JL status ACTUALLY
CHANGES — once. So if JL goes Complete (pushed to Monday), and a PM later moves Monday to Snagging,
nothing re-forces it: JL stays Complete, Monday stays Snagging.

On first run it SEEDS a baseline marked already-synced, so switching this on does NOT mass-overwrite
the board — only genuine future changes propagate.

Keyed by the job number in the item's Upgraded Job Ref or Original Job Ref. Writes only when the
target column's label differs. Never sets 'Approved' (JL-only; handled by the Monday->JL guard).
SAFE: dry-run by default; marks events synced + writes to Monday only when MONDAY_SYNC_APPLY=1.

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
COL_ANCHOR   = env("MONDAY_COL_ANCHOR", "text_mkyrcb16")
COL_UPGRADED = env("MONDAY_COL_UPGRADED", "text_mm5gxah5")
COL_PMSTAT   = env("MONDAY_COL_PMSTAT", "status")
COL_FINANCE  = env("MONDAY_COL_FINANCE", "color_mkvy3avs")
APPLY        = env("MONDAY_SYNC_APPLY", "0") == "1"
ONLY         = env("MONDAY_STATUS_ONLY")   # test/manual: force-push ONE job's CURRENT status, bypass the change log
PAGE_LIMIT   = int(env("MONDAY_PAGE_LIMIT", "500"))

# JL JobStatusId -> [(monday_column_id, target label)]. Empty = leave unchanged. (never 'Approved')
MAP = {
    5:  [],
    7:  [(COL_PMSTAT, "Project In Progress")],   # Allocated
    1:  [(COL_PMSTAT, "Project In Progress")],   # Attended
    6:  [(COL_PMSTAT, "Project In Progress")],   # Parts To Fit
    9:  [(COL_PMSTAT, "Project In Progress")],   # Awaiting Parts
    2:  [],                                      # Costed
    8:  [(COL_FINANCE, "To Invoice")],           # Reqs. Invoice
    4:  [(COL_PMSTAT, "Complete"), (COL_FINANCE, "Invoiced")],  # Invoiced
    11: [(COL_PMSTAT, "Complete")],              # Completed
    10: [(COL_PMSTAT, "Lost/Not Progressed")],   # Cancelled
}

TBL = f"{BQ_PROJECT}.{BQ_DATASET}.job_status_events"

# CDC: append a row whenever a job's JobStatusId differs from the last observation. First sighting of
# a job is SEEDED as already-synced (synced_at set) so switch-on doesn't push the whole board.
CDC_SQL = f"""
CREATE TABLE IF NOT EXISTS `{TBL}` (
  job_id INT64, job_number STRING, old_status_id INT64, new_status_id INT64,
  observed_at TIMESTAMP, synced_at TIMESTAMP
);
INSERT INTO `{TBL}` (job_id, job_number, old_status_id, new_status_id, observed_at, synced_at)
WITH cur AS (
  SELECT Id AS job_id, ANY_VALUE(JobNumber) job_number, ANY_VALUE(JobStatusId) sid
  FROM `{BQ_PROJECT}.{BQ_DATASET}.jobs` WHERE Id IS NOT NULL GROUP BY Id
),
last_seen AS (
  SELECT job_id, new_status_id AS sid FROM `{TBL}`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY observed_at DESC) = 1
)
SELECT c.job_id, c.job_number, l.sid, c.sid, CURRENT_TIMESTAMP(),
       CASE WHEN l.job_id IS NULL THEN CURRENT_TIMESTAMP() ELSE NULL END
FROM cur c LEFT JOIN last_seen l ON l.job_id = c.job_id
WHERE l.job_id IS NULL OR IFNULL(l.sid, -1) != IFNULL(c.sid, -1);
"""

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

FIND_Q = ('query($b:ID!,$c:String!,$v:[String!]!){items_page_by_column_values(board_id:$b,'
          'columns:[{column_id:$c,column_values:$v}],limit:25){items{id name '
          'column_values(ids:["' + COL_PMSTAT + '","' + COL_FINANCE + '"]){id text}}}}')

def find_items(job_number):
    seen, out = {}, []
    for col in (COL_ANCHOR, COL_UPGRADED):
        items = monday(FIND_Q, {"b": BOARD_ID, "c": col, "v": [job_number]})["items_page_by_column_values"]["items"]
        for it in items:
            if it["id"] not in seen:
                seen[it["id"]] = 1
                cv = {c["id"]: norm(c["text"]) for c in it["column_values"]}
                out.append((it["id"], it["name"], cv))
    return out

def write_cols(item_id, vals):
    cvjson = {c: {"label": v} for c, v in vals.items()}
    m = "mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}"
    monday(m, {"b": BOARD_ID, "i": str(item_id), "v": json.dumps(cvjson)})

def main():
    log.info("mode = %s | change-triggered (last-write-wins)%s",
             "APPLY" if APPLY else "DRY-RUN", f" | ONLY={ONLY}" if ONLY else "")
    bq = bigquery.Client(project=BQ_PROJECT)

    if ONLY:   # manual/test path: push this job's CURRENT status now, ignore the change log
        row = list(bq.query(f"SELECT ANY_VALUE(JobStatusId) sid FROM `{BQ_PROJECT}.{BQ_DATASET}.jobs` "
                            f"WHERE JobNumber=@n", job_config=bigquery.QueryJobConfig(
                                query_parameters=[bigquery.ScalarQueryParameter("n", "STRING", ONLY)])).result())
        sid = row[0]["sid"] if row else None
        log.info("ONLY %s -> JobStatusId %s", ONLY, sid)
        for item_id, name, cv in find_items(ONLY):
            diffs = {c: v for c, v in MAP.get(sid, []) if cv.get(c, "") != v}
            log.info("  item %s '%s': %s", item_id, name[:32], diffs or "(no change)")
            if APPLY and diffs: write_cols(item_id, diffs)
        log.info("done (ONLY mode makes no change-log updates)."); return

    log.info("running job-status CDC…")
    bq.query(CDC_SQL).result()

    rows = list(bq.query(
        f"SELECT job_id, job_number, new_status_id, observed_at FROM `{TBL}` "
        f"WHERE synced_at IS NULL ORDER BY observed_at").result())
    log.info("unsynced status changes: %d", len(rows))
    if not rows:
        log.info("nothing to push."); return
    cutoff = max(r["observed_at"] for r in rows)

    planned = []
    for r in rows:
        jobno = norm(r["job_number"]); sid = r["new_status_id"]
        targets = MAP.get(sid, [])
        if not jobno or not targets:
            continue
        for item_id, name, cv in find_items(jobno):
            diffs = {c: v for c, v in targets if cv.get(c, "") != v}
            if diffs:
                planned.append((jobno, sid, item_id, name, cv, diffs))

    log.info("planned Monday writes: %d (from %d changes)", len(planned), len(rows))
    for jobno, sid, item_id, name, cv, diffs in planned[:60]:
        pretty = ", ".join(("PM" if c == COL_PMSTAT else "Fin") + ": '" + cv.get(c, "") + "'->'" + v + "'"
                            for c, v in diffs.items())
        log.info("  %s (sid %s) item %s '%s': %s", jobno, sid, item_id, name[:32], pretty)
    if len(planned) > 60:
        log.info("  ... and %d more", len(planned) - 60)

    if not APPLY:
        log.info("DRY-RUN: no writes, events NOT marked synced. Set MONDAY_SYNC_APPLY=1 to apply."); return

    for i, (jobno, sid, item_id, name, cv, diffs) in enumerate(planned, 1):
        write_cols(item_id, diffs)
        if i % 25 == 0: log.info("  wrote %d/%d", i, len(planned))
        time.sleep(0.25)
    # mark every change up to the cutoff as handled (matched or not) so it never re-pushes
    bq.query(f"UPDATE `{TBL}` SET synced_at = CURRENT_TIMESTAMP() "
             f"WHERE synced_at IS NULL AND observed_at <= @c",
             job_config=bigquery.QueryJobConfig(query_parameters=[
                 bigquery.ScalarQueryParameter("c", "TIMESTAMP", cutoff)])).result()
    log.info("APPLIED %d Monday writes; marked changes up to %s synced.", len(planned), cutoff)

if __name__ == "__main__":
    main()
