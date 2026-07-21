#!/usr/bin/env bash
# Incremental / chunked load for one entity, SWEDISH company (tenant c61c1df0) -> sweden_raw.
# Mirror of run_incremental.sh with SE secrets + BQ_DATASET override.
#   run_incremental_se.sh jobs               # incremental upsert (default mode)
#   run_incremental_se.sh invoices backfill  # monthly-windowed full replace (also dodges 403)
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
BQ_DATASET=sweden_raw
JL_CLIENT_ID="$(gcloud secrets versions access latest --secret=jl-se-client-id --project=vmimporteddata)"
JL_CLIENT_SECRET="$(gcloud secrets versions access latest --secret=jl-se-client-secret --project=vmimporteddata)"
JL_TENANT_ID="$(gcloud secrets versions access latest --secret=jl-se-tenant-id --project=vmimporteddata)"
JL_INCR="$1"
JL_MODE="${2:-incr}"
set +a
exec "$APP/venv/bin/python" "$APP/load_incremental.py"
