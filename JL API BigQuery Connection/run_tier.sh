#!/usr/bin/env bash
# Runs one schedule tier: fetches creds from Secret Manager, then loads the given entities.
# Usage (from cron): run_tier.sh "Job/getall:jobs"
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
JL_CLIENT_ID="$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata)"
JL_CLIENT_SECRET="$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata)"
JL_TENANT_ID="$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata)"
JL_ENTITIES="$1"
set +a
exec "$APP/venv/bin/python" "$APP/loader.py"
