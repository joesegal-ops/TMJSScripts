"""
Monday -> JL job status + the 'Approved' guard (phase 2 of the bidirectional status sync).

Runs on the VM (JL API is IP-whitelisted, so the JL writeback must originate here — not the Apps
Script relay). CHANGE-TRIGGERED / last-write-wins: it keeps a snapshot of each item's PM Stat. in
BigQuery (raw.monday_pm_stat_state) and only acts when an item's PM Stat. actually CHANGES.

On a change:
  * If the new status is in the Monday->JL push map (Complete->11 Completed, Lost/Not Progressed->10
    Cancelled), it PUTs that status to the JobLogic job (value-equality: only if JL differs).
  * If the new status is 'Approved', the guard checks the item's linked quote(s) in JL. Legitimate
    only if a linked quote is Approved(4) or Upgraded(10). Otherwise it REVERTS PM Stat. to the
    previous value and posts an update on the item explaining why.

First run SEEDS the snapshot (no actions) so switch-on doesn't act on the whole board.
SAFE: dry-run by default; JL writes / Monday reverts / snapshot save happen only when MONDAY_SYNC_APPLY=1.

Needs BOTH JL creds and MONDAY_TOKEN in env (run_sync_monday_to_jl.sh injects them).
  Dry run:  ./venv/bin/python sync_monday_to_jl.py
  Apply:    MONDAY_SYNC_APPLY=1 ./venv/bin/python sync_monday_to_jl.py
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

# JobLogic
JL_TOKEN_URL = env("JL_TOKEN_URL", "https://identityservice.joblogic.com/connect/token")
JL_API_BASE  = env("JL_API_BASE", "https://api.joblogic.com")
JL_SCOPE     = env("JL_SCOPE", "JL.Api")
CLIENT_ID    = env("JL_CLIENT_ID", required=True)
CLIENT_SECRET= env("JL_CLIENT_SECRET", required=True)
TENANT_ID    = env("JL_TENANT_ID", required=True)
# Monday
MONDAY_TOKEN = env("MONDAY_TOKEN", required=True)
MONDAY_API   = env("MONDAY_API", "https://api.monday.com/v2")
MONDAY_APIVER= env("MONDAY_API_VERSION", "2024-10")
# BigQuery / board
BQ_PROJECT   = env("BQ_PROJECT", "vmimporteddata")
BQ_DATASET   = env("BQ_DATASET", "raw")
BOARD_ID     = int(env("MONDAY_BOARD_ID", "5084790211"))
COL_ANCHOR   = env("MONDAY_COL_ANCHOR", "text_mkyrcb16")
COL_UPGRADED = env("MONDAY_COL_UPGRADED", "text_mm5gxah5")
COL_PMSTAT   = env("MONDAY_COL_PMSTAT", "status")
COL_QUOTE    = env("MONDAY_COL_QUOTE", "text__1")
APPLY        = env("MONDAY_SYNC_APPLY", "0") == "1"
PAGE_LIMIT   = int(env("MONDAY_PAGE_LIMIT", "500"))

MONDAY_TO_JL = {"Complete": 11, "Lost/Not Progressed": 10}   # from mapping_monday_to_jl.csv (Push=Y)
APPROVED_OK  = {4, 10}                                        # quote Approved / Upgraded
STATE_TBL    = f"{BQ_PROJECT}.{BQ_DATASET}.monday_pm_stat_state"

# ---- JobLogic ----
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
    if not r.ok:
        raise RuntimeError(f"JL updatestatus {job_id}->{status_id}: {r.status_code} {r.text[:120]}")

# ---- Monday ----
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

def monday_set_status(item_id, label):
    m = "mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}"
    monday(m, {"b": BOARD_ID, "i": str(item_id), "v": json.dumps({COL_PMSTAT: {"label": label}})})

def monday_post(item_id, body):
    monday("mutation($i:ID!,$b:String!){create_update(item_id:$i,body:$b){id}}", {"i": str(item_id), "b": body})

def norm(s): return (s or "").strip()
def quote_tokens(text): return re.findall(r"UP\d+", re.sub(r"\s+", "", (text or "").upper()))

# ---- BigQuery lookups ----
def bq_maps(bq):
    jobs = {}
    for r in bq.query(f"SELECT JobNumber, ANY_VALUE(Id) id, ANY_VALUE(JobStatusId) sid "
                      f"FROM `{BQ_PROJECT}.{BQ_DATASET}.jobs` WHERE JobNumber IS NOT NULL GROUP BY JobNumber").result():
        jobs[norm(r["JobNumber"])] = (r["id"], r["sid"])
    quotes = {}
    for r in bq.query(f"SELECT QuoteNumber, ANY_VALUE(QuoteStatusId) sid "
                      f"FROM `{BQ_PROJECT}.{BQ_DATASET}.quotes` WHERE QuoteNumber IS NOT NULL GROUP BY QuoteNumber").result():
        quotes[norm(r["QuoteNumber"]).upper()] = r["sid"]
    return jobs, quotes

def load_snapshot(bq):
    bq.query(f"CREATE TABLE IF NOT EXISTS `{STATE_TBL}` "
             f"(item_id STRING, pm_stat STRING, updated_at TIMESTAMP)").result()
    return {r["item_id"]: norm(r["pm_stat"]) for r in bq.query(f"SELECT item_id, pm_stat FROM `{STATE_TBL}`").result()}

def save_snapshot(bq, rows):
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    payload = [{"item_id": i, "pm_stat": s, "updated_at": now} for i, s in rows.items()]
    from io import BytesIO
    data = "\n".join(json.dumps(p) for p in payload).encode()
    bq.load_table_from_file(BytesIO(data), STATE_TBL, job_config=bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON, write_disposition="WRITE_TRUNCATE",
        schema=[bigquery.SchemaField("item_id","STRING"), bigquery.SchemaField("pm_stat","STRING"),
                bigquery.SchemaField("updated_at","TIMESTAMP")])).result()

# ---- board ----
def board_items():
    cols = '"%s","%s","%s","%s"' % (COL_PMSTAT, COL_QUOTE, COL_ANCHOR, COL_UPGRADED)
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
    return out

def quote_approved(cv, quotes):
    for tok in quote_tokens(cv.get(COL_QUOTE, "")):
        if quotes.get(tok) in APPROVED_OK:
            return True
    return False

def main():
    log.info("mode = %s | Monday->JL + Approved guard (change-triggered)", "APPLY" if APPLY else "DRY-RUN")
    bq = bigquery.Client(project=BQ_PROJECT)
    jobs, quotes = bq_maps(bq)
    snap = load_snapshot(bq)
    seeding = len(snap) == 0
    if seeding: log.info("no snapshot yet -> SEED run (records baseline, takes no action)")

    items = board_items()
    log.info("scanned %d items; snapshot has %d", len(items), len(snap))

    jl_pushes, reverts, allowed, new_state = [], [], 0, {}
    for item_id, name, cv in items:
        cur = cv.get(COL_PMSTAT, "")
        new_state[item_id] = cur
        prev = snap.get(item_id)
        if seeding or prev is None or cur == prev:
            continue  # unchanged / first sighting
        # --- a change happened: prev -> cur ---
        if cur == "Approved":
            if quote_approved(cv, quotes):
                allowed += 1
            else:
                reverts.append((item_id, name, prev, cv.get(COL_QUOTE, "")))
                new_state[item_id] = prev  # after revert the board sits at prev
        elif cur in MONDAY_TO_JL:
            target = MONDAY_TO_JL[cur]
            jobno = cv.get(COL_UPGRADED) or cv.get(COL_ANCHOR)
            job = jobs.get(jobno)
            if job and job[0] and job[1] != target:
                jl_pushes.append((item_id, name, jobno, job[0], job[1], target, cur))

    log.info("changes -> JL pushes=%d, Approved reverts=%d, Approved allowed=%d",
             len(jl_pushes), len(reverts), allowed)
    for _, name, jobno, jid, cursid, tgt, lbl in jl_pushes[:40]:
        log.info("  PUSH '%s' job %s (id %s) status %s -> %s  (Monday '%s')", name[:30], jobno, jid, cursid, tgt, lbl)
    for _, name, prev, q in reverts[:40]:
        log.info("  REVERT '%s' Approved -> '%s' (no approved JL quote in '%s')", name[:30], prev, q[:30])

    if not APPLY:
        log.info("DRY-RUN: no writes, snapshot not saved. Set MONDAY_SYNC_APPLY=1 to apply."); return

    for item_id, name, jobno, jid, cursid, tgt, lbl in jl_pushes:
        jl_update_status(jid, tgt); time.sleep(0.4)
    for item_id, name, prev, q in reverts:
        monday_set_status(item_id, prev)
        monday_post(item_id, "⚠️ PM Stat. was set to 'Approved' but no approved/upgraded JobLogic quote is "
                             "linked, so it was reverted to '%s'. Approval must come from JobLogic." % prev)
        time.sleep(0.3)
    save_snapshot(bq, new_state)
    log.info("APPLIED: %d JL status pushes, %d reverts; snapshot saved (%d items).",
             len(jl_pushes), len(reverts), len(new_state))

if __name__ == "__main__":
    main()
