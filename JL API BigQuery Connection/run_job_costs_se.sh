#!/usr/bin/env bash
# Per-job cost/sell (GET /api/v1/JobCost) for the SWEDISH company (tenant c61c1df0) -> sweden_raw.job_costs.
# Mirror of run_job_costs.sh with the SE tenant + BQ_DATASET override. First incr run auto-falls back to FULL
# (job_costs table missing). Scratch files live in /opt/jl-loader, NOT the UK run's fixed /tmp paths.
# Usage: run_job_costs_se.sh [full|incr]   (default incr)
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
BQ_DATASET=sweden_raw
JL_CLIENT_ID="$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata)"
JL_CLIENT_SECRET="$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata)"
JL_TENANT_ID="$(gcloud secrets versions access latest --secret=jl-se-tenant-id --project=vmimporteddata)"
JL_JC_OUT="$APP/job_costs_se.jsonl"
JL_JC_DONE="$APP/job_costs_se_done.txt"
JL_JC_MODE="${1:-incr}"
set +a
exec "$APP/venv/bin/python" "$APP/load_job_costs.py"
