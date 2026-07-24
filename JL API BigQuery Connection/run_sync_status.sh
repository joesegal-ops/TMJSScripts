#!/usr/bin/env bash
# JL job status -> Monday PM Stat./Finance Stat. Dry-run by default; pass "apply" to write.
#   run_sync_status.sh            # dry-run (prints planned changes)
#   run_sync_status.sh apply      # writes to Monday
#   MONDAY_STATUS_ONLY=PROJ0000885 run_sync_status.sh apply  # force-push ONE job's current status (test/manual)
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
MONDAY_TOKEN="$(gcloud secrets versions access latest --secret=monday-token --project=vmimporteddata)"
[ "${1:-}" = "apply" ] && MONDAY_SYNC_APPLY=1
set +a
exec "$APP/venv/bin/python" "$APP/sync_status.py"
