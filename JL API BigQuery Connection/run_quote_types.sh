#!/usr/bin/env bash
# Fetch quote Job Type/Category (Quote/GetById) into raw.quote_types.
# Usage: run_quote_types.sh [full|incr]   (default incr)
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
JL_CLIENT_ID="$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata)"
JL_CLIENT_SECRET="$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata)"
JL_TENANT_ID="$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata)"
JL_QT_MODE="${1:-incr}"
set +a
exec "$APP/venv/bin/python" "$APP/load_quote_types.py"
