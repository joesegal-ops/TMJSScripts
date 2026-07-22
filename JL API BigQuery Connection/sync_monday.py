"""
Quote -> Monday sync (step 1 of the JobLogic->Monday integration; see MONDAY_SYNC_SPEC.md).

Writes the JobLogic quote number(s) onto the matching item in the Monday board
"Minor Projects - WW Active", keyed by the item's `Original Job Ref.` == quote.ParentJobStringId.

Reads raw.quotes from BigQuery (ADC / VM service account). Reads+writes Monday via GraphQL using
MONDAY_TOKEN (from Secret Manager `monday-token`, injected by run_sync_monday.sh).

Policy (decided): FILL BLANKS ONLY. Writes the quote number(s) only where the Quote cell is
empty. For non-empty cells whose quote SET differs from JobLogic's (formatting ignored), it writes
NOTHING and instead records a row in a mismatch report (MONDAY_REPORT_PATH, default
/tmp/monday_quote_report.csv) for a human to review. Never touches the anchor column. Multiple
quotes on one job -> comma-separated, ordered by quote number.

SAFETY: dry-run by default. It only writes to Monday when MONDAY_SYNC_APPLY=1.
  Dry run (default):   ./venv/bin/python sync_monday.py
  Apply:               MONDAY_SYNC_APPLY=1 ./venv/bin/python sync_monday.py
  Single item test:    MONDAY_SYNC_ONLY=PROJ0000625 MONDAY_SYNC_APPLY=1 ./venv/bin/python sync_monday.py
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
log = logging.getLogger("monday-sync")


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
COL_ANCHOR     = env("MONDAY_COL_ANCHOR", "text_mkyrcb16")   # Original Job Ref.
COL_UPGRADED   = env("MONDAY_COL_UPGRADED", "text_mm5gxah5")  # Upgraded Job Ref
COL_QUOTE      = env("MONDAY_COL_QUOTE", "text__1")          # Quote
APPLY          = env("MONDAY_SYNC_APPLY", "0") == "1"
ONLY           = env("MONDAY_SYNC_ONLY")                     # optional: limit to one original job ref
PAGE_LIMIT     = int(env("MONDAY_PAGE_LIMIT", "500"))
REPORT_PATH    = env("MONDAY_REPORT_PATH", "/tmp/monday_quote_report.csv")

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


def canon(q):
    """Canonical quote key, tolerant of zero-padding (UP1024 == UP01024)."""
    m = re.match(r"UP0*(\d+)$", q.upper())
    return "UP" + m.group(1) if m else q.upper()


def extract_quotes(text):
    """Set of canonical UP-numbers embedded in a free-text Monday cell (handles /, newlines, notes)."""
    compact = re.sub(r"\s+", "", (text or "").upper())
    return {canon(t) for t in re.findall(r"UP\d+", compact)}


def desired_quotes():
    """{original_job_ref -> 'UP01820, UP01831'} from every quote that has a parent job."""
    bq = bigquery.Client(project=BQ_PROJECT)
    sql = f"""
      SELECT ParentJobStringId AS ref,
             STRING_AGG(DISTINCT QuoteNumber, ', ' ORDER BY QuoteNumber) AS quotes
      FROM `{BQ_PROJECT}.{BQ_DATASET}.quotes`
      WHERE ParentJobStringId IS NOT NULL AND ParentJobStringId != ''
        AND QuoteNumber IS NOT NULL AND QuoteNumber != ''
      GROUP BY ParentJobStringId
    """
    out = {norm(r["ref"]): norm(r["quotes"]) for r in bq.query(sql).result()}
    log.info("BigQuery: %d original jobs carry quote(s)", len(out))
    return out


def board_index():
    """Index items by BOTH job-ref columns: {job_ref -> (item_id, name, current_quote_text)}.

    Historically the anchor column held whatever ref the user typed (often the upgraded job number),
    so a quote's ParentJobStringId may sit in Original Job Ref OR Upgraded Job Ref. Register both.
    """
    idx, conflicts, cursor, items_seen = {}, 0, None, 0
    cols = '"%s","%s","%s"' % (COL_ANCHOR, COL_UPGRADED, COL_QUOTE)
    first = ("query ($board: [ID!], $limit: Int!) { boards(ids: $board) { "
             "items_page(limit: $limit) { cursor items { id name "
             "column_values(ids: [%s]) { id text } } } } }") % cols
    nxt = ("query ($cursor: String!, $limit: Int!) { "
           "next_items_page(cursor: $cursor, limit: $limit) { cursor items { id name "
           "column_values(ids: [%s]) { id text } } } }") % cols

    while True:
        if cursor is None:
            pageobj = monday(first, {"board": [BOARD_ID], "limit": PAGE_LIMIT})["boards"][0]["items_page"]
        else:
            pageobj = monday(nxt, {"cursor": cursor, "limit": PAGE_LIMIT})["next_items_page"]
        for it in pageobj["items"]:
            items_seen += 1
            cv = {c["id"]: norm(c["text"]) for c in it["column_values"]}
            rec = (it["id"], it["name"], cv.get(COL_QUOTE, ""))
            for ref in {cv.get(COL_ANCHOR, ""), cv.get(COL_UPGRADED, "")}:
                if not ref:
                    continue
                if ref in idx and idx[ref][0] != rec[0]:
                    conflicts += 1  # same ref on two items; keep first, note it
                    log.warning("job ref %s on multiple items (%s, %s); keeping %s",
                                ref, idx[ref][0], rec[0], idx[ref][0])
                else:
                    idx[ref] = rec
        cursor = pageobj["cursor"]
        if not cursor:
            break
    log.info("Monday: scanned %d items on board %s; %d distinct job refs indexed%s",
             items_seen, BOARD_ID, len(idx),
             f" ({conflicts} ref conflicts)" if conflicts else "")
    return idx


def write_quote(item_id, value):
    m = """
      mutation ($board: ID!, $item: ID!, $vals: JSON!) {
        change_multiple_column_values(board_id: $board, item_id: $item, column_values: $vals) { id }
      }"""
    monday(m, {"board": BOARD_ID, "item": item_id, "vals": json.dumps({COL_QUOTE: value})})


def main():
    log.info("mode = %s%s | policy = fill-blanks-only + mismatch report",
             "APPLY (writes)" if APPLY else "DRY-RUN (no writes)", f", ONLY={ONLY}" if ONLY else "")
    want = desired_quotes()
    idx = board_index()

    to_fill, mismatches, ok, missing = [], [], 0, 0
    for ref, quotes in want.items():
        if ONLY and ref != ONLY:
            continue
        hit = idx.get(ref)
        if not hit:
            missing += 1; continue
        item_id, name, current = hit
        jl_set = {canon(q) for q in quotes.split(", ") if q}
        if not current:                              # blank -> safe to fill
            to_fill.append((ref, item_id, name, quotes)); continue
        mon_set = extract_quotes(current)
        if mon_set == jl_set:                        # same quotes (any formatting) -> leave it
            ok += 1; continue
        disp = {canon(q): q for q in quotes.split(", ") if q}
        missing_in_monday = ", ".join(disp[c] for c in sorted(jl_set - mon_set))
        extra_in_monday   = ", ".join(sorted(mon_set - jl_set))
        mismatches.append({"job_ref": ref, "item_id": item_id, "item_name": name,
                           "monday_current": current, "joblogic_quotes": quotes,
                           "missing_in_monday": missing_in_monday, "extra_in_monday": extra_in_monday})

    log.info("blanks to fill=%d, mismatches=%d, already-correct=%d, quotes-with-no-matching-item=%d",
             len(to_fill), len(mismatches), ok, missing)

    # --- mismatch report (always written) ---
    with open(REPORT_PATH, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["job_ref", "item_id", "item_name", "monday_current",
                                          "joblogic_quotes", "missing_in_monday", "extra_in_monday"])
        w.writeheader()
        for row in sorted(mismatches, key=lambda r: r["job_ref"]):
            w.writerow(row)
    log.info("mismatch report -> %s (%d rows)", REPORT_PATH, len(mismatches))
    for m in mismatches[:25]:
        log.info("  MISMATCH %s '%s': monday=%r JL=%r (missing=%s extra=%s)",
                 m["job_ref"], m["item_name"][:35], m["monday_current"][:50],
                 m["joblogic_quotes"], m["missing_in_monday"] or "-", m["extra_in_monday"] or "-")
    if len(mismatches) > 25:
        log.info("  ... and %d more in the CSV", len(mismatches) - 25)

    # --- fill blanks ---
    for ref, item_id, name, quotes in to_fill[:50]:
        log.info("  FILL %s (item %s '%s') -> %r", ref, item_id, name[:40], quotes)
    if len(to_fill) > 50:
        log.info("  ... and %d more blanks", len(to_fill) - 50)

    if not APPLY:
        log.info("DRY-RUN: no writes made. Set MONDAY_SYNC_APPLY=1 to fill the %d blank(s).", len(to_fill))
        return
    written = 0
    for ref, item_id, name, quotes in to_fill:
        write_quote(item_id, quotes)
        written += 1
        if written % 25 == 0:
            log.info("  wrote %d/%d", written, len(to_fill))
        time.sleep(0.25)
    log.info("APPLIED %d blank-fill updates. Mismatches (%d) were NOT changed — see %s.",
             written, len(mismatches), REPORT_PATH)


if __name__ == "__main__":
    main()
