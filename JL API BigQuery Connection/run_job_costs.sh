#!/usr/bin/env bash
# Fetch per-job cost/sell (GET /api/v1/JobCost) into raw.job_costs (UK company).
# Usage: run_job_costs.sh [full|incr]   (default incr)
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
JL_CLIENT_ID="$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata)"
JL_CLIENT_SECRET="$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata)"
JL_TENANT_ID="$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata)"
JL_JC_MODE="${1:-incr}"
set +a
exec "$APP/venv/bin/python" "$APP/load_job_costs.py"
