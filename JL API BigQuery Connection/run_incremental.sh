#!/usr/bin/env bash
# Incremental / chunked load for one entity. Usage: run_incremental.sh <entity> [mode]
#   run_incremental.sh jobs            # incremental upsert (default mode)
#   run_incremental.sh invoices backfill  # monthly-windowed full replace (also dodges 403)
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
JL_CLIENT_ID="$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata)"
JL_CLIENT_SECRET="$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata)"
JL_TENANT_ID="$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata)"
JL_INCR="$1"
JL_MODE="${2:-incr}"
set +a
exec "$APP/venv/bin/python" "$APP/load_incremental.py"
