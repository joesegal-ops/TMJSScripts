"""
Monday.com activity log -> BigQuery (`raw.monday_activity`).

The item/column snapshot (load_monday.py) tells you where a project IS. This tells you how it GOT
there: every `move_pulse_from_group` carries source_group and dest_group, which is what makes
time-in-stage computable (models.monday_stage_history / _summary).

APPEND + MERGE on event_id, NOT a truncate-snapshot like load_monday.py -- history must accumulate,
because Monday only retains ~10 months of activity (measured 2026-09-22: nothing before
~2025-11-27 on a board carrying items back to 2024-11-20). Everything older is gone from the API
for good, so whatever this table has captured is the only copy.

Two modes:
  backfill    walk MONDAY_ACTIVITY_START..now in monthly windows -- the one-off history grab
  incremental (default) just the last MONDAY_ACTIVITY_HOURS hours; what cron runs

  ./venv/bin/python load_monday_activity.py                 # incremental, last 12h
  MONDAY_ACTIVITY_MODE=backfill ./venv/bin/python load_monday_activity.py
  MONDAY_BOARDS=5084790211 MONDAY_ACTIVITY_MODE=backfill ... # one board

All event types are stored, not just moves: we have to page through them anyway (the API has no
event-type filter), and `update_column_value` rows answer "when did PM Stat change / when was the
Quoted date actually filled in" for free.
"""
import datetime as dt
import json
import logging
import os
import sys
import time
import uuid
from io import BytesIO

import requests
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("monday-activity")


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and not v:
        log.error("Missing required env var: %s", name); sys.exit(2)
    return v


MONDAY_TOKEN  = env("MONDAY_TOKEN", required=True)
MONDAY_API    = env("MONDAY_API", "https://api.monday.com/v2")
MONDAY_APIVER = env("MONDAY_API_VERSION", "2024-10")
BQ_PROJECT    = env("BQ_PROJECT", "vmimporteddata")
BQ_DATASET    = env("BQ_DATASET", "raw")
HTTP_TIMEOUT  = int(env("MONDAY_HTTP_TIMEOUT", "90"))

MODE       = env("MONDAY_ACTIVITY_MODE", "incremental").lower()
# Incremental window. Generous overlap vs the 3-hourly cron: re-fetching an event is free
# (MERGE dedupes on event_id), missing one loses a stage transition permanently.
HOURS      = int(env("MONDAY_ACTIVITY_HOURS", "12"))
# Retention starts ~2025-11-27; a month of slack costs one empty window per board.
START      = env("MONDAY_ACTIVITY_START", "2025-11-01T00:00:00Z")
PAGE_LIMIT = int(env("MONDAY_ACTIVITY_PAGE_LIMIT", "500"))
MAX_PAGES  = int(env("MONDAY_ACTIVITY_MAX_PAGES", "400"))   # per window; guards runaway paging

DEFAULT_BOARDS = [
    "5084790211",  # Minor Projects - WW Active
    "5084790218",  # Subitems of Minor Projects - WW Active
    "5089125557",  # Minor Projects - WW TRIAGE
    "5089125562",  # Subitems of Minor Projects - WW TRIAGE
    "1728757109",  # Minor Projects - Other Clients
    "1728757122",  # Subitems of Minor Projects - Other Clients
    "5084791104",  # Minor Projects - NEKO
    "5084791111",  # Subitems of Minor Projects - NEKO
    "5085864777",  # Members' logos Wework
    "5095573699",  # Subitems of Members' logos Wework
    "5097354530",  # Pending WW Jobs
    "5097354532",  # Subitems of Pending WW Jobs
    "5084827760",  # LOGOs - WW
    "5084827763",  # Subitems of LOGOs - WW
]
BOARDS = [b.strip() for b in env("MONDAY_BOARDS", ",".join(DEFAULT_BOARDS)).split(",") if b.strip()]

HDRS = {"Authorization": MONDAY_TOKEN, "Content-Type": "application/json",
        "API-Version": MONDAY_APIVER}

TARGET = f"{BQ_PROJECT}.{BQ_DATASET}.monday_activity"
STAGE  = f"{BQ_PROJECT}.{BQ_DATASET}._monday_activity_stage"


def monday(query, variables=None, tries=6):
    for attempt in range(1, tries + 1):
        try:
            r = requests.post(MONDAY_API, headers=HDRS,
                              json={"query": query, "variables": variables or {}},
                              timeout=HTTP_TIMEOUT)
        except requests.RequestException as e:
            wait = min(2 ** attempt, 60)
            log.warning("%s; retrying in %ss", type(e).__name__, wait); time.sleep(wait); continue
        if r.status_code == 429 or r.status_code >= 500:
            wait = min(2 ** attempt, 60)
            log.warning("HTTP %s; sleeping %ss", r.status_code, wait); time.sleep(wait); continue
        try:
            body = r.json()
        except ValueError:
            r.raise_for_status(); raise
        if "errors" in body:
            msg = json.dumps(body["errors"])[:300]
            if "omplexity" in msg or "budget" in msg.lower() or "throttl" in msg.lower():
                wait = min(2 ** attempt, 60)
                log.warning("complexity/throttle; sleeping %ss", wait); time.sleep(wait); continue
            raise RuntimeError(f"Monday GraphQL error: {msg}")
        return body["data"]
    raise RuntimeError("Monday API: exhausted retries")


ACT_Q = """
query ($board: [ID!], $limit: Int!, $page: Int!, $from: ISO8601DateTime!, $to: ISO8601DateTime!) {
  boards(ids: $board) {
    id name
    activity_logs(limit: $limit, page: $page, from: $from, to: $to) {
      id event data entity user_id created_at
    }
  }
}"""


def decode_ts(raw):
    """Monday stamps activity with a 17-digit value: epoch seconds x 10^7."""
    try:
        return dt.datetime.fromtimestamp(int(raw) / 1e7, dt.timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def parse_event(board_id, board_name, l):
    try:
        d = json.loads(l.get("data") or "{}")
    except ValueError:
        d = {}
    src = d.get("source_group") or {}
    dst = d.get("dest_group") or {}
    pulse = d.get("pulse") or {}
    return {
        "event_id": l["id"],
        "board_id": board_id, "board_name": board_name,
        "item_id": str(d["pulse_id"]) if d.get("pulse_id") is not None else None,
        "item_name": pulse.get("name"),
        "event": l.get("event"), "entity": l.get("entity"),
        "user_id": str(l["user_id"]) if l.get("user_id") is not None else None,
        "created_at": decode_ts(l.get("created_at")),
        "from_group_id": src.get("id"), "from_group_title": src.get("title"),
        "to_group_id": dst.get("id"), "to_group_title": dst.get("title"),
        "column_id": d.get("column_id"),
        "is_undo": bool(d.get("is_undo_action")) if d.get("is_undo_action") is not None else None,
        "is_batch": bool(d.get("is_batch_action")) if d.get("is_batch_action") is not None else None,
        "data": l.get("data"),
    }


def fetch_window(board_id, frm, to):
    """All activity for one board in one time window. Paging is newest-first; a boundary event can
    repeat across pages, which the MERGE on event_id absorbs."""
    rows, page = [], 1
    board_name = None
    while page <= MAX_PAGES:
        data = monday(ACT_Q, {"board": [board_id], "limit": PAGE_LIMIT, "page": page,
                              "from": frm, "to": to})
        boards = data.get("boards") or []
        if not boards:
            break
        board_name = boards[0].get("name")
        logs = boards[0].get("activity_logs") or []
        rows.extend(parse_event(board_id, board_name, l) for l in logs)
        if len(logs) < PAGE_LIMIT:
            break
        page += 1
    else:
        log.warning("  board %s window %s hit the %s-page cap — window may be truncated",
                    board_id, frm[:10], MAX_PAGES)
    return rows, board_name


def month_windows(start, end):
    cur = start
    while cur < end:
        if cur.month == 12:
            nxt = cur.replace(year=cur.year + 1, month=1, day=1)
        else:
            nxt = cur.replace(month=cur.month + 1, day=1)
        yield cur, min(nxt, end)
        cur = nxt


SCHEMA = [
    bigquery.SchemaField("event_id", "STRING"),
    bigquery.SchemaField("board_id", "STRING"),
    bigquery.SchemaField("board_name", "STRING"),
    bigquery.SchemaField("item_id", "STRING"),
    bigquery.SchemaField("item_name", "STRING"),
    bigquery.SchemaField("event", "STRING"),
    bigquery.SchemaField("entity", "STRING"),
    bigquery.SchemaField("user_id", "STRING"),
    bigquery.SchemaField("created_at", "TIMESTAMP"),
    bigquery.SchemaField("from_group_id", "STRING"),
    bigquery.SchemaField("from_group_title", "STRING"),
    bigquery.SchemaField("to_group_id", "STRING"),
    bigquery.SchemaField("to_group_title", "STRING"),
    bigquery.SchemaField("column_id", "STRING"),
    bigquery.SchemaField("is_undo", "BOOL"),
    bigquery.SchemaField("is_batch", "BOOL"),
    bigquery.SchemaField("data", "STRING"),
    bigquery.SchemaField("_ingested_at", "TIMESTAMP"),
]


def ensure_target(client):
    try:
        client.get_table(TARGET)
    except Exception:
        t = bigquery.Table(TARGET, schema=SCHEMA)
        t.time_partitioning = bigquery.TimePartitioning(field="created_at")
        t.clustering_fields = ["board_id", "event", "item_id"]
        client.create_table(t)
        log.info("created %s (partitioned on created_at, clustered board/event/item)", TARGET)


def merge_rows(client, rows, ingested_at):
    """Stage then MERGE on event_id. Append-only: an event never changes after the fact."""
    if not rows:
        log.info("no events to merge"); return 0
    for r in rows:
        r["_ingested_at"] = ingested_at
    payload = "\n".join(json.dumps(r, default=str) for r in rows).encode("utf-8")
    stage_id = f"{STAGE}_{uuid.uuid4().hex[:8]}"
    cfg = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition="WRITE_TRUNCATE", schema=SCHEMA)
    client.load_table_from_file(BytesIO(payload), stage_id, job_config=cfg).result()
    cols = ", ".join(f.name for f in SCHEMA)
    vals = ", ".join(f"S.{f.name}" for f in SCHEMA)
    sql = f"""
      MERGE `{TARGET}` T
      USING (SELECT * EXCEPT(rn) FROM (
               SELECT *, ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY _ingested_at) rn
               FROM `{stage_id}`) WHERE rn = 1) S
      ON T.event_id = S.event_id
      WHEN NOT MATCHED THEN INSERT ({cols}) VALUES ({vals})"""
    job = client.query(sql); job.result()
    client.delete_table(stage_id, not_found_ok=True)
    inserted = job.num_dml_affected_rows
    log.info("staged %s events -> %s new rows in %s", len(rows), inserted, TARGET)
    return inserted


def main():
    now = dt.datetime.now(dt.timezone.utc)
    if MODE == "backfill":
        start = dt.datetime.fromisoformat(START.replace("Z", "+00:00"))
        windows = list(month_windows(start.replace(day=1), now))
    else:
        windows = [(now - dt.timedelta(hours=HOURS), now)]
    log.info("mode=%s | %s board(s) | %s window(s) %s..%s",
             MODE, len(BOARDS), len(windows),
             windows[0][0].strftime("%Y-%m-%d"), windows[-1][1].strftime("%Y-%m-%d"))

    client = bigquery.Client(project=BQ_PROJECT)
    ensure_target(client)
    ingested_at = now.isoformat()

    all_rows, summary, failed = [], [], []
    for b in BOARDS:
        got, name = 0, b
        for frm, to in windows:
            try:
                rows, bname = fetch_window(b, frm.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                           to.strftime("%Y-%m-%dT%H:%M:%SZ"))
            except Exception as e:
                log.error("  board %s window %s FAILED: %s: %s", b, frm.date(), type(e).__name__, e)
                failed.append((b, str(frm.date())))
                continue
            name = bname or name
            all_rows.extend(rows); got += len(rows)
        moves = sum(1 for r in all_rows if r["board_id"] == b and r["event"] == "move_pulse_from_group")
        summary.append((name, got, moves))
        log.info("== %-46s %6d events (%d group moves)", (name or b)[:46], got, moves)

    # Append-only + MERGE, so a partial run is safe to load: it can only ever add rows, and the
    # next run re-covers the same window. (Unlike load_monday.py, which truncates.)
    merge_rows(client, all_rows, ingested_at)

    log.info("=== SUMMARY ===")
    for name, n, m in summary:
        log.info("  %-46s %6d events  %5d moves", (name or "?")[:46], n, m)
    log.info("  %-46s %6d events", "TOTAL", len(all_rows))
    if failed:
        log.error("%s window(s) failed: %s", len(failed), failed[:10])
        sys.exit(1)


if __name__ == "__main__":
    main()
