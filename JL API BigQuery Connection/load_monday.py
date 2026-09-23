"""
Monday.com -> BigQuery raw-layer loader (VM edition).

Mirrors loader.py's contract for the JobLogic API: full snapshot per run, WRITE_TRUNCATE, one
`_ingested_at` stamp per run. Reads Monday via GraphQL with MONDAY_TOKEN (Secret Manager
`monday-token`, injected by run_monday_load.sh); writes BigQuery via ADC.

Three tables, all generic — no per-board schema, so adding a column in Monday never breaks a load:
  raw.monday_boards   1 row/board   (name, workspace, kind, state, item count, groups[])
  raw.monday_columns  1 row/column  (id, title, type, settings_str, position)
  raw.monday_items    1 row/item    (name, group, state, timestamps, parent, column_values[])

`monday_items.column_values` is a REPEATED STRUCT<column_id, title, type, text, value>, where
`text` is Monday's own display rendering and `value` is the raw JSON as a string. The friendly,
per-board flattening lives in SQL (create_monday_views.sql -> models.monday_*), not here.

Only non-archived, non-deleted items are returned (Monday's items_page default).

  All default boards:   ./venv/bin/python load_monday.py
  One board:            MONDAY_BOARDS=5084790211 ./venv/bin/python load_monday.py
  Metadata only:        MONDAY_SKIP_ITEMS=1 ./venv/bin/python load_monday.py
"""
import datetime as dt
import json
import logging
import os
import sys
import time
from io import BytesIO

import requests
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("monday-raw")


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
SKIP_ITEMS    = env("MONDAY_SKIP_ITEMS", "0") == "1"

# Items-per-page. Monday bills by query COMPLEXITY, not request count: a page of N items costs
# ~N x (columns on the board). Boards here carry up to 26 columns, so 100 is the safe ceiling —
# 500 (what sync_monday.py uses for its 3-column read) trips the complexity budget.
PAGE_LIMIT = int(env("MONDAY_PAGE_LIMIT", "100"))

# Projects Team boards + their subitem boards. Subitem boards are ordinary boards to the API;
# their rows carry parent_item_id, which is what links a subitem back to its parent item.
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


def monday(query, variables=None, tries=6):
    """POST a GraphQL op; retry on 429 and on complexity-budget exhaustion."""
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
                log.warning("complexity/throttle limit; sleeping %ss", wait); time.sleep(wait); continue
            raise RuntimeError(f"Monday GraphQL error: {msg}")
        return body["data"]
    raise RuntimeError("Monday API: exhausted retries")


# ---------------------------------------------------------------- metadata

META_Q = """
query ($ids: [ID!]) {
  boards(ids: $ids, limit: 100) {
    id name state board_kind description items_count updated_at
    workspace { id name }
    groups { id title position }
    columns { id title type settings_str }
  }
}"""


def fetch_metadata():
    data = monday(META_Q, {"ids": BOARDS})
    boards = data.get("boards") or []
    found = {b["id"] for b in boards}
    for missing in [b for b in BOARDS if b not in found]:
        log.warning("board %s not returned by the API (deleted, or token lacks access)", missing)
    brows, crows = [], []
    for b in boards:
        ws = b.get("workspace") or {}
        brows.append({
            "board_id": b["id"], "board_name": b.get("name"), "state": b.get("state"),
            "board_kind": b.get("board_kind"), "description": b.get("description"),
            "items_count": b.get("items_count"),
            "workspace_id": ws.get("id"), "workspace_name": ws.get("name"),
            "board_updated_at": b.get("updated_at"),
            "groups": [{"group_id": g["id"], "title": g.get("title"),
                        "position": g.get("position")} for g in b.get("groups") or []],
        })
        for pos, c in enumerate(b.get("columns") or []):
            crows.append({
                "board_id": b["id"], "board_name": b.get("name"), "column_id": c["id"],
                "title": c.get("title"), "type": c.get("type"),
                "settings_str": c.get("settings_str"), "position": pos,
            })
    return boards, brows, crows


# ---------------------------------------------------------------- items

ITEM_FIELDS = """id name state created_at updated_at creator_id
    group { id title } parent_item { id }
    column_values { id type text value column { title } }"""

FIRST_Q = """
query ($board: [ID!], $limit: Int!) {
  boards(ids: $board) { items_page(limit: $limit) { cursor items { %s } } }
}""" % ITEM_FIELDS

NEXT_Q = """
query ($cursor: String!, $limit: Int!) {
  next_items_page(cursor: $cursor, limit: $limit) { cursor items { %s } }
}""" % ITEM_FIELDS


def fetch_items(board_id, board_name):
    rows, cursor, pages = [], None, 0
    while True:
        if cursor is None:
            page = monday(FIRST_Q, {"board": [board_id], "limit": PAGE_LIMIT})["boards"][0]["items_page"]
        else:
            page = monday(NEXT_Q, {"cursor": cursor, "limit": PAGE_LIMIT})["next_items_page"]
        pages += 1
        for it in page["items"]:
            grp = it.get("group") or {}
            parent = it.get("parent_item") or {}
            rows.append({
                "board_id": board_id, "board_name": board_name,
                "item_id": it["id"], "item_name": it.get("name"),
                "state": it.get("state"),
                "group_id": grp.get("id"), "group_title": grp.get("title"),
                "parent_item_id": parent.get("id"), "creator_id": it.get("creator_id"),
                "created_at": it.get("created_at"), "updated_at": it.get("updated_at"),
                "column_values": [{
                    "column_id": cv["id"],
                    "title": (cv.get("column") or {}).get("title"),
                    "type": cv.get("type"),
                    "text": cv.get("text"),
                    "value": cv.get("value"),
                } for cv in it.get("column_values") or []],
            })
        cursor = page.get("cursor")
        if not cursor:
            break
    log.info("  %s rows over %s page(s)", len(rows), pages)
    return rows


# ---------------------------------------------------------------- BigQuery

COLUMN_VALUE_FIELDS = [
    bigquery.SchemaField("column_id", "STRING"),
    bigquery.SchemaField("title", "STRING"),
    bigquery.SchemaField("type", "STRING"),
    bigquery.SchemaField("text", "STRING"),
    bigquery.SchemaField("value", "STRING"),   # raw JSON, kept verbatim as a string
]

SCHEMAS = {
    "monday_boards": [
        bigquery.SchemaField("board_id", "STRING"),
        bigquery.SchemaField("board_name", "STRING"),
        bigquery.SchemaField("state", "STRING"),
        bigquery.SchemaField("board_kind", "STRING"),
        bigquery.SchemaField("description", "STRING"),
        bigquery.SchemaField("items_count", "INT64"),
        bigquery.SchemaField("workspace_id", "STRING"),
        bigquery.SchemaField("workspace_name", "STRING"),
        bigquery.SchemaField("board_updated_at", "TIMESTAMP"),
        bigquery.SchemaField("groups", "RECORD", mode="REPEATED", fields=[
            bigquery.SchemaField("group_id", "STRING"),
            bigquery.SchemaField("title", "STRING"),
            bigquery.SchemaField("position", "STRING"),
        ]),
        bigquery.SchemaField("_ingested_at", "TIMESTAMP"),
    ],
    "monday_columns": [
        bigquery.SchemaField("board_id", "STRING"),
        bigquery.SchemaField("board_name", "STRING"),
        bigquery.SchemaField("column_id", "STRING"),
        bigquery.SchemaField("title", "STRING"),
        bigquery.SchemaField("type", "STRING"),
        bigquery.SchemaField("settings_str", "STRING"),
        bigquery.SchemaField("position", "INT64"),
        bigquery.SchemaField("_ingested_at", "TIMESTAMP"),
    ],
    "monday_items": [
        bigquery.SchemaField("board_id", "STRING"),
        bigquery.SchemaField("board_name", "STRING"),
        bigquery.SchemaField("item_id", "STRING"),
        bigquery.SchemaField("item_name", "STRING"),
        bigquery.SchemaField("state", "STRING"),
        bigquery.SchemaField("group_id", "STRING"),
        bigquery.SchemaField("group_title", "STRING"),
        bigquery.SchemaField("parent_item_id", "STRING"),
        bigquery.SchemaField("creator_id", "STRING"),
        bigquery.SchemaField("created_at", "TIMESTAMP"),
        bigquery.SchemaField("updated_at", "TIMESTAMP"),
        bigquery.SchemaField("column_values", "RECORD", mode="REPEATED",
                             fields=COLUMN_VALUE_FIELDS),
        bigquery.SchemaField("_ingested_at", "TIMESTAMP"),
    ],
}


def load_to_bq(client, table, rows, ingested_at):
    """WRITE_TRUNCATE snapshot. Refuses to truncate a table to nothing (an empty result is far
    more likely to be a token/permission problem than a genuinely empty board set)."""
    table_id = f"{BQ_PROJECT}.{BQ_DATASET}.{table}"
    if not rows:
        log.warning("  %s: 0 rows — skipping load (table left unchanged)", table_id)
        return
    for r in rows:
        r["_ingested_at"] = ingested_at
    cfg = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition="WRITE_TRUNCATE", schema=SCHEMAS[table],
    )
    payload = "\n".join(json.dumps(r, default=str) for r in rows).encode("utf-8")
    job = client.load_table_from_file(BytesIO(payload), table_id, job_config=cfg)
    job.result()
    log.info("  loaded %s rows -> %s", len(rows), table_id)


def main():
    ingested_at = dt.datetime.now(dt.timezone.utc).isoformat()
    client = bigquery.Client(project=BQ_PROJECT)

    log.info("== board metadata (%s boards) ==", len(BOARDS))
    boards, brows, crows = fetch_metadata()
    load_to_bq(client, "monday_boards", brows, ingested_at)
    load_to_bq(client, "monday_columns", crows, ingested_at)

    if SKIP_ITEMS:
        log.info("MONDAY_SKIP_ITEMS=1 — metadata only, stopping."); return

    items, summary = [], []
    for b in boards:
        log.info("== items: %s (%s) ==", b.get("name"), b["id"])
        try:
            rows = fetch_items(b["id"], b.get("name"))
        except Exception as e:
            log.error("  FAILED: %s: %s", type(e).__name__, e)
            summary.append((b.get("name"), 0, f"{type(e).__name__}: {e}"))
            continue
        items.extend(rows)
        summary.append((b.get("name"), len(rows), "ok"))

    failures = [s for s in summary if s[2] != "ok"]
    if failures:
        # A partial snapshot would silently delete a whole board's rows on WRITE_TRUNCATE.
        log.error("%s board(s) failed — NOT truncating raw.monday_items", len(failures))
    else:
        load_to_bq(client, "monday_items", items, ingested_at)

    log.info("=== SUMMARY ===")
    for name, n, s in summary:
        log.info("  %-48s %6d  %s", (name or "?")[:48], n, s)
    log.info("  %-48s %6d", "TOTAL", len(items))
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
