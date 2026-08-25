#!/usr/bin/env bash
# Runs the invoice-lines probe on the VM with the loader's own creds. Read-only.
set -a
source /opt/jl-loader/config.env
JL_CLIENT_ID="$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata)"
JL_CLIENT_SECRET="$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata)"
JL_TENANT_ID="$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata)"
set +a
/opt/jl-loader/venv/bin/python "$HOME/probe_invoice_lines.py"
