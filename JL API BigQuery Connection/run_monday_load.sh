#!/usr/bin/env bash
# Monday.com -> BigQuery raw loader. Fetches the Monday token from Secret Manager, then runs
# load_monday.py. Full snapshot of the configured boards; safe to re-run at any time.
#   run_monday_load.sh                      # all default boards
#   MONDAY_BOARDS=5084790211 run_monday_load.sh   # one board
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
MONDAY_TOKEN="$(gcloud secrets versions access latest --secret=monday-token --project=vmimporteddata)"
set +a
exec "$APP/venv/bin/python" "$APP/load_monday.py"
