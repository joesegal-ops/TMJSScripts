#!/usr/bin/env bash
# JobLogic -> Monday ITEM CREATOR (replaces the Google-Sheet import). Fetches the Monday token
# from Secret Manager, then runs create_monday_items.py.
# Dry-run by default; pass "apply" to actually create items.
#   run_create_monday_items.sh            # dry-run (prints planned creates + writes report CSV)
#   run_create_monday_items.sh apply      # creates items on the board
#   MONDAY_CREATE_ONLY=PROJ0002300 run_create_monday_items.sh apply   # single-job test
#
# CUTOVER: set MONDAY_CREATE_CUTOVER in config.env to the go-live date (ISO, e.g. 2026-07-23).
# Only WeWork Project jobs logged on/after that date are considered (new-only; no history backfill).
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
MONDAY_TOKEN="$(gcloud secrets versions access latest --secret=monday-token --project=vmimporteddata)"
[ "${1:-}" = "apply" ] && MONDAY_CREATE_APPLY=1
set +a
exec "$APP/venv/bin/python" "$APP/create_monday_items.py"
