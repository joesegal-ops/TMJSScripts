#!/usr/bin/env bash
# Incremental job + engineer notes -> raw.notes (load_notes_incremental.py).
# Usage: run_notes.sh [days]   (default 3; window of job updates / visit starts to re-fetch)
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
JL_CLIENT_ID="$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata)"
JL_CLIENT_SECRET="$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata)"
JL_TENANT_ID="$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata)"
JL_NOTES_DAYS="${1:-3}"
set +a
exec "$APP/venv/bin/python" "$APP/load_notes_incremental.py"
