#!/usr/bin/env bash
# Append quote status transitions to raw.quote_status_events (BigQuery-only; auth via VM service account).
set -euo pipefail
exec bq query --project_id=vmimporteddata --use_legacy_sql=false --format=none \
  < /opt/jl-loader/quote_status_cdc.sql
