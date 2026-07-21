#!/usr/bin/env bash
# Runs one schedule tier for the SWEDISH Joblogic company (tenant c61c1df0) into dataset sweden_raw.
# Mirror of run_tier.sh but with the SE secrets + BQ_DATASET override. Same loader.py, no code changes.
# Usage (from cron):  run_tier_se.sh "Job/getall:jobs"
# BLOCKED until Joblogic issues SE API creds and whitelists 8.228.52.239 for that client
#   -> populate secrets jl-se-client-id / jl-se-client-secret first.
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
BQ_DATASET=sweden_raw                                   # override raw -> sweden_raw
JL_CLIENT_ID="$(gcloud secrets versions access latest --secret=jl-se-client-id --project=vmimporteddata)"
JL_CLIENT_SECRET="$(gcloud secrets versions access latest --secret=jl-se-client-secret --project=vmimporteddata)"
JL_TENANT_ID="$(gcloud secrets versions access latest --secret=jl-se-tenant-id --project=vmimporteddata)"
JL_ENTITIES="$1"
set +a
exec "$APP/venv/bin/python" "$APP/loader.py"
