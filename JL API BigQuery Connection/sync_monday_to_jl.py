"""
Monday -> JL job status + the 'Approved' guard (phase 2 of the bidirectional status sync).

Runs on the VM (JL API is IP-whitelisted, so the JL writeback must originate here). CHANGE-TRIGGERED
/ last-write-wins via a BigQuery snapshot (raw.monday_pm_stat_state). Acts only when an item's
PM Stat. actually changes.

On a change:
  * new status in the push map (Complete->11 Completed, Lost/Not Progressed->10 Cancelled): PUTs it
    to the JobLogic job (value-equality vs raw.jobs, echo-safe).
  * new status == 'Approved': legitimate only if a linked quote is Approved(4)/Upgraded(10) in JL.
    If NOT, it UNDOES the whole Approved cascade (the board's automations fire on any status change
    and can't be suppressed): restores PM Stat., Finance Stat., the Approved date, and the item's
    group to their pre-Approved snapshot values, then posts an explanatory update. (The auto-created
    update from the board automation is left in place.)

First run SEEDS the snapshot (no actions). SAFE: dry-run by default; writes only when MONDAY_SYNC_APPLY=1.
Needs BOTH JL creds and MONDAY_TOKEN (run_sync_monday_to_jl.sh injects them).
"""
import datetime as dt
import json, logging, os, re, sys, time
import requests
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("monday->jl")

def env(n, d=None, required=False):
    v = os.environ.get(n, d)
    if required and not v: log.error("Missing env %s", n); sys.exit(2)
    return v

JL_TOKEN_URL = env("JL_TOKEN_URL", "https://identityservice.joblogic.com/connect/token")
JL_API_BASE  = env("JL_API_BASE", "https://api.joblogic.com")
JL_SCOPE     = env("JL_SCOPE", "JL.Api")
CLIENT_ID    = env("JL_CLIENT_ID", required=True)
CLIENT_SECRET= env("JL_CLIENT_SECRET", required=True)
TENANT_ID    = env("JL_TENANT_ID", required=True)
MONDAY_TOKEN = env("MONDAY_TOKEN", required=True)
MONDAY_API   = env("MONDAY_API", "https://api.monday.com/v2")
MONDAY_APIVER= env("MONDAY_API_VERSION", "2024-10")
BQ_PROJECT   = env("BQ_PROJECT", "vmimporteddata")
BQ_DATASET   = env("BQ_DATASET", "raw")
BOARD_ID     = int(env("MONDAY_BOARD_ID", "5084790211"))
COL_ANCHOR   = env("MONDAY_COL_ANCHOR", "text_mkyrcb16")
COL_UPGRADED = env("MONDAY_COL_UPGRADED", "text_mm5gxah5")
COL_PMSTAT   = env("MONDAY_COL_PMSTAT", "status")
COL_QUOTE    = env("MONDAY_COL_QUOTE", "text__1")
COL_FINANCE  = env("MONDAY_COL_FINANCE", "color_mkvy3avs")
COL_APPRDATE = env("MONDAY_COL_APPROVED_DATE", "date_mkx89wm0")
APPLY        = env("MONDAY_SYNC_APPLY", "0") == "1"
PAGE_LIMIT   = int(env("MONDAY_PAGE_LIMIT", "500"))

MONDAY_TO_JL = {"Complete": 11, "Lost/Not Progressed": 10}
APPROVED_OK  = {4, 10}
STATE_TBL    = f"{BQ_PROJECT}.{BQ_DATASET}.monday_pm_stat_state"

# ---------- JobLogic ----------
_tok = {"v": None, "t": 0.0}
def jl_token():
    if _tok["v"] is None or time.time() - _tok["t"] > 2700:
        r = requests.post(JL_TOKEN_URL, data={"grant_type": "client_credentials", "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET, "scope": JL_SCOPE}, timeout=60)
        r.raise_for_status(); _tok["v"] = r.json()["access_token"]; _tok["t"] = time.time()
    return _tok["v"]

def jl_update_status(job_id, status_id):
    url = f"{JL_API_BASE}/api/v1/Job/updatestatus?id={job_id}&tenantId={TENANT_ID}"
    r = requests.put(url, json={"StatusId": status_id},
                     headers={"Authorization": f"Bearer {jl_token()}", "Content-Type": "application/json"}, timeout=60)
    if not r.ok: raise RuntimeError(f"JL updatestatus {job_id}->{status_id}: {r.status_code} {r.text[:120]}")

# ---------- Monday ----------
HDRS = {"Authorization": MONDAY_TOKEN, "Content-Type": "application/json", "API-Version": MONDAY_APIVER}
def monday(query, variables=None, tries=5):
    for attempt in range(1, tries + 1):
        r = requests.post(MONDAY_API, headers=HDRS, json={"query": query, "variables": variables or {}}, timeout=60)
        if r.status_code == 429: time.sleep(min(2 ** attempt, 60)); continue
        body = r.json()
        if "errors" in body:
            msg = json.dumps(body["errors"])[:300]
            if "omplexity" in msg or "budget" in msg.lower(): time.sleep(min(2 ** attempt, 60)); continue
            raise RuntimeError("Monday error: " + msg)
        return body["data"]
    raise RuntimeError("Monday API: exhausted retries")

SIMPLE = "mutation($b:ID!,$i:ID!,$c:String!,$v:String!){change_simple_column_value(board_id:$b,item_id:$i,column_id:$c,value:$v){id}}"
def monday_simple(item_id, col, value):  # value "" clears; for status cols pass the label text
    monday(SIMPLE, {"b": BOARD_ID, "i": str(item_id), "c": col, "v": value or ""})
def monday_move_group(item_id, group_id):
    monday("mutation($i:ID!,$g:String!){move_item_to_group(item_id:$i,group_id:$g){id}}", {"i": str(item_id), "g": group_id})
def monday_post(item_id, body):
    monday("mutation($i:ID!,$b:String!){create_update(item_id:$i,body:$b){id}}", {"i": str(item_id), "b": body})

def norm(s): return (s or "").strip()
def quote_tokens(text): return re.findall(r"UP\d+", re.sub(r"\s+", "", (text or "").upper()))

# ---------- BigQuery ----------
def bq_maps(bq):
    jobs = {norm(r["JobNumber"]): (r["id"], r["sid"]) for r in bq.query(
        f"SELECT JobNumber, ANY_VALUE(Id) id, ANY_VALUE(JobStatusId) sid "
        f"FROM `{BQ_PROJECT}.{BQ_DATASET}.jobs` WHERE JobNumber IS NOT NULL GROUP BY JobNumber").result()}
    quotes = {norm(r["QuoteNumber"]).upper(): r["sid"] for r in bq.query(
        f"SELECT QuoteNumber, ANY_VALUE(QuoteStatusId) sid "
        f"FROM `{BQ_PROJECT}.{BQ_DATASET}.quotes` WHERE QuoteNumber IS NOT NULL GROUP BY QuoteNumber").result()}
    return jobs, quotes

def load_snapshot(bq):
    try:
        out = {}
        for r in bq.query(f"SELECT item_id, pm_stat, finance, appr_date, group_id FROM `{STATE_TBL}`").result():
            out[r["item_id"]] = {"pm_stat": norm(r["pm_stat"]), "finance": norm(r["finance"]),
                                 "appr_date": norm(r["appr_date"]), "group_id": norm(r["group_id"])}
        return out
    except Exception as e:  # missing table or old (3-col) schema -> recreate fresh and re-seed
        log.warning("snapshot missing/old schema (%s) -> recreating; this run re-seeds", str(e)[:80])
        bq.query(f"DROP TABLE IF EXISTS `{STATE_TBL}`").result()
        bq.query(f"CREATE TABLE `{STATE_TBL}` (item_id STRING, pm_stat STRING, finance STRING, "
                 f"appr_date STRING, group_id STRING, updated_at TIMESTAMP)").result()
        return {}

def save_snapshot(bq, rows):
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    payload = [dict(item_id=i, updated_at=now, **s) for i, s in rows.items()]
    from io import BytesIO
    data = "\n".join(json.dumps(p) for p in payload).encode()
    bq.load_table_from_file(BytesIO(data), STATE_TBL, job_config=bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON, write_disposition="WRITE_TRUNCATE",
        schema=[bigquery.SchemaField("item_id","STRING"), bigquery.SchemaField("pm_stat","STRING"),
                bigquery.SchemaField("finance","STRING"), bigquery.SchemaField("appr_date","STRING"),
                bigquery.SchemaField("group_id","STRING"), bigquery.SchemaField("updated_at","TIMESTAMP")])).result()

# ---------- board ----------
def board_items():
    cols = '"%s","%s","%s","%s","%s","%s"' % (COL_PMSTAT, COL_QUOTE, COL_ANCHOR, COL_UPGRADED, COL_FINANCE, COL_APPRDATE)
    body = "items{id name group{id} column_values(ids:[%s]){id text}}" % cols
    first = ("query($b:[ID!],$l:Int!){boards(ids:$b){items_page(limit:$l){cursor %s}}}") % body
    nxt = ("query($c:String!,$l:Int!){next_items_page(cursor:$c,limit:$l){cursor %s}}") % body
    cursor, out = None, []
    while True:
        page = (monday(first, {"b": [BOARD_ID], "l": PAGE_LIMIT})["boards"][0]["items_page"]
                if cursor is None else monday(nxt, {"c": cursor, "l": PAGE_LIMIT})["next_items_page"])
        for it in page["items"]:
            cv = {c["id"]: norm(c["text"]) for c in it["column_values"]}
            out.append((it["id"], it["name"], it["group"]["id"], cv))
        cursor = page["cursor"]
        if not cursor: break
    return out

def snap_of(cv, group_id):
    return {"pm_stat": cv.get(COL_PMSTAT, ""), "finance": cv.get(COL_FINANCE, ""),
            "appr_date": cv.get(COL_APPRDATE, ""), "group_id": group_id}

def quote_approved(cv, quotes):
    return any(quotes.get(tok) in APPROVED_OK for tok in quote_tokens(cv.get(COL_QUOTE, "")))

def main():
    log.info("mode = %s | Monday->JL + Approved guard (restores full cascade)", "APPLY" if APPLY else "DRY-RUN")
    bq = bigquery.Client(project=BQ_PROJECT)
    jobs, quotes = bq_maps(bq)
    snap = load_snapshot(bq)
    seeding = len(snap) == 0
    if seeding: log.info("no snapshot yet -> SEED run (records baseline, takes no action)")

    items = board_items()
    log.info("scanned %d items; snapshot has %d", len(items), len(snap))

    jl_pushes, reverts, allowed, new_state = [], [], 0, {}
    for item_id, name, group_id, cv in items:
        cur = cv.get(COL_PMSTAT, "")
        new_state[item_id] = snap_of(cv, group_id)
        prev = snap.get(item_id)
        if seeding or prev is None or cur == prev["pm_stat"]:
            continue
        if cur == "Approved":
            if quote_approved(cv, quotes):
                allowed += 1
            else:
                reverts.append((item_id, name, prev, cv.get(COL_QUOTE, "")))
                new_state[item_id] = prev  # board will sit at the restored pre-Approved snapshot
        elif cur in MONDAY_TO_JL:
            target = MONDAY_TO_JL[cur]; jobno = cv.get(COL_UPGRADED) or cv.get(COL_ANCHOR); job = jobs.get(jobno)
            if job and job[0] and job[1] != target:
                jl_pushes.append((item_id, name, jobno, job[0], job[1], target, cur))

    log.info("changes -> JL pushes=%d, Approved reverts=%d, Approved allowed=%d", len(jl_pushes), len(reverts), allowed)
    for _, name, jobno, jid, cursid, tgt, lbl in jl_pushes[:40]:
        log.info("  PUSH '%s' job %s (id %s) %s -> %s (Monday '%s')", name[:28], jobno, jid, cursid, tgt, lbl)
    for _, name, prev, q in reverts[:40]:
        log.info("  REVERT '%s' -> PM '%s', Fin '%s', date '%s', group %s (quote '%s')",
                 name[:26], prev["pm_stat"], prev["finance"], prev["appr_date"], prev["group_id"], q[:20])

    if not APPLY:
        log.info("DRY-RUN: no writes, snapshot not saved. Set MONDAY_SYNC_APPLY=1 to apply."); return

    for item_id, name, jobno, jid, cursid, tgt, lbl in jl_pushes:
        jl_update_status(jid, tgt); time.sleep(0.4)
    for item_id, name, prev, q in reverts:
        monday_simple(item_id, COL_PMSTAT, prev["pm_stat"])   # revert status first
        time.sleep(0.4)
        monday_simple(item_id, COL_FINANCE, prev["finance"])  # undo Finance Stat -> PO/Waiver
        monday_simple(item_id, COL_APPRDATE, prev["appr_date"])  # undo Approved date
        if prev["group_id"]: monday_move_group(item_id, prev["group_id"])  # undo group move
        monday_post(item_id, "⚠️ PM Stat. 'Approved' was reverted: no approved/upgraded JobLogic quote is "
                             "linked to this item. Approval must come from JobLogic. Restored to '%s'." % prev["pm_stat"])
        time.sleep(0.4)
    save_snapshot(bq, new_state)
    log.info("APPLIED: %d JL pushes, %d Approved reverts; snapshot saved (%d items).",
             len(jl_pushes), len(reverts), len(new_state))

if __name__ == "__main__":
    main()
