#!/usr/bin/env bash
# Engineer daily AM/PM sites (Planner NPT via Visit/SearchPlanner) -> raw.engineer_daily_sites.
# Usage: run_engineer_sites.sh
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
JL_CLIENT_ID="$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata)"
JL_CLIENT_SECRET="$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata)"
JL_TENANT_ID="$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata)"
set +a
exec "$APP/venv/bin/python" "$APP/load_engineer_sites.py"
