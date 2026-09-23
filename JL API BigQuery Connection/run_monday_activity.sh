#!/usr/bin/env bash
# Monday activity log -> BigQuery (raw.monday_activity). Append + MERGE on event_id, so this is
# safe to re-run and safe to overlap. History only: Monday retains ~10 months, and whatever this
# table has captured is the only copy of anything older.
#   run_monday_activity.sh                # incremental (last 12h) -- what cron runs
#   run_monday_activity.sh backfill       # walk MONDAY_ACTIVITY_START..now, monthly windows
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
MONDAY_TOKEN="$(gcloud secrets versions access latest --secret=monday-token --project=vmimporteddata)"
[ "${1:-}" = "backfill" ] && MONDAY_ACTIVITY_MODE=backfill
set +a
exec "$APP/venv/bin/python" "$APP/load_monday_activity.py"
