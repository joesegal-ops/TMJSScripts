#!/usr/bin/env bash
# Quote -> Monday sync. Fetches the Monday token from Secret Manager, then runs sync_monday.py.
# Dry-run by default; pass "apply" to actually write to Monday.
#   run_sync_monday.sh            # dry-run (prints planned changes)
#   run_sync_monday.sh apply      # writes to Monday
#   MONDAY_SYNC_ONLY=PROJ0000625 run_sync_monday.sh apply   # single-item test
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
MONDAY_TOKEN="$(gcloud secrets versions access latest --secret=monday-token --project=vmimporteddata)"
[ "${1:-}" = "apply" ] && MONDAY_SYNC_APPLY=1
set +a
exec "$APP/venv/bin/python" "$APP/sync_monday.py"
