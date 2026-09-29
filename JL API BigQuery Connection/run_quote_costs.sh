#!/usr/bin/env bash
# Quote cost/sell lines -> raw.quote_costs. Fetches JL creds from Secret Manager.
#   run_quote_costs.sh          # incr (new quotes only)
#   run_quote_costs.sh full     # every quote; also picks up edited lines
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
JL_CLIENT_ID="$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata)"
JL_CLIENT_SECRET="$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata)"
JL_TENANT_ID="$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata)"
JL_QC_MODE="${1:-incr}"
set +a
exec "$APP/venv/bin/python" "$APP/load_quote_costs.py"
