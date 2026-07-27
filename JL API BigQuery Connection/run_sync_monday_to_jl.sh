#!/usr/bin/env bash
# Monday -> JL job status + Approved guard. Runs from the VM (whitelisted IP for the JL writeback).
# Dry-run by default; pass "apply" to write to JL / revert on Monday / save the snapshot.
#   run_sync_monday_to_jl.sh          # dry-run
#   run_sync_monday_to_jl.sh apply    # apply
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
JL_CLIENT_ID="$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata)"
JL_CLIENT_SECRET="$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata)"
JL_TENANT_ID="$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata)"
MONDAY_TOKEN="$(gcloud secrets versions access latest --secret=monday-token --project=vmimporteddata)"
[ "${1:-}" = "apply" ] && MONDAY_SYNC_APPLY=1
set +a
exec "$APP/venv/bin/python" "$APP/sync_monday_to_jl.py"
