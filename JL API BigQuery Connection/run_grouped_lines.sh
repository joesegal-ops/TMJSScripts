#!/usr/bin/env bash
# Load Customer Grouped invoice job-lines. Usage: run_grouped_lines.sh [full|incr]
#   run_grouped_lines.sh full   # fetch all Type-2 invoices (one-time / weekly)
#   run_grouped_lines.sh        # incr (default): only new/recent grouped invoices
set -euo pipefail
APP=/opt/jl-loader
set -a
source "$APP/config.env"
JL_CLIENT_ID="$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata)"
JL_CLIENT_SECRET="$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata)"
JL_TENANT_ID="$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata)"
JL_MODE="${1:-incr}"
set +a
exec "$APP/venv/bin/python" "$APP/load_grouped_invoice_lines.py"
