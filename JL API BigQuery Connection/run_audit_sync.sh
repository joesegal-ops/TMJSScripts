#!/usr/bin/env bash
# Daily sync of Job_Status_Audit (US, old project, email-fed - no API) -> EU models.job_status_audit,
# so sla_analysis pause-hours stay fresh without a cross-region query.
set -euo pipefail
OUT=/tmp/audit_sync.csv
bq query --project_id=importdata-494110 --use_legacy_sql=false --format=csv --max_rows=1000000 \
  'SELECT Job_ID,Previous_Job_Status,New_Job_Status,Users,Engineer,Timestamp FROM `importdata-494110.JobLogic.Job_Status_Audit_clean`' > "$OUT"
bq load --project_id=vmimporteddata --source_format=CSV --skip_leading_rows=1 --replace \
  --schema='Job_ID:STRING,Previous_Job_Status:STRING,New_Job_Status:STRING,Users:STRING,Engineer:STRING,Timestamp:DATETIME' \
  vmimporteddata:models.job_status_audit "$OUT"
echo "audit sync done: $(wc -l < "$OUT") lines"
