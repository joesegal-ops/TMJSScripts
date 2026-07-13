#!/usr/bin/env bash
# Self-contained reproduction Joblogic Support can run themselves.
# Set the three creds below (or export them), then: bash reproduce.sh
# Requests must originate from the whitelisted IP (ours: 8.228.52.239).
set -u

CLIENT_ID="${JL_CLIENT_ID:-PUT_CLIENT_ID}"
CLIENT_SECRET="${JL_CLIENT_SECRET:-PUT_CLIENT_SECRET}"
TENANT_ID="${JL_TENANT_ID:-PUT_TENANT_ID}"
TOKEN_URL="https://identityservice.joblogic.com/connect/token"
BASE="https://api.joblogic.com/api/v1"

echo "== 1. Get token =="
TOKEN=$(curl -s -X POST "$TOKEN_URL" -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "client_id=$CLIENT_ID" --data-urlencode "client_secret=$CLIENT_SECRET" \
  --data-urlencode "grant_type=client_credentials" --data-urlencode "scope=JL.Api" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
echo "token length: ${#TOKEN}"

hit () {  # $1 label  $2 METHOD  $3 url  $4 body(optional)
  echo; echo "== $1 =="
  if [ "$2" = "GET" ]; then
    curl -s -H "Authorization: Bearer $TOKEN" "$3" | head -c 500; echo
  else
    echo "body: $4"
    curl -s -X POST "$3" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$4" | head -c 500; echo
  fi
}

P='{"TenantId":"'"$TENANT_ID"'","PageIndex":1,"PageSize":5}'
hit "CONTROL Customer/GetAll (expect data)" POST "$BASE/Customer/GetAll" "$P"
hit "CONTROL Quote/GetAll (expect data)"    POST "$BASE/Quote/GetAll"    "$P"
hit "ISSUE Job/getall no filter (returns 0)" POST "$BASE/Job/getall"     "$P"
hit "ISSUE Job/getall date window (returns 0)" POST "$BASE/Job/getall" \
  '{"TenantId":"'"$TENANT_ID"'","PageIndex":1,"PageSize":5,"StartDate":"2024-07-31T00:00:00Z","EndDate":"2026-07-04T23:59:59Z"}'
hit "ISSUE Job/getall SearchTerm=PROJ0001624 (returns 0)" POST "$BASE/Job/getall" \
  '{"TenantId":"'"$TENANT_ID"'","PageIndex":1,"PageSize":5,"SearchTerm":"PROJ0001624"}'
hit "PROOF Job/GetById id=31855808 (returns the job)" GET \
  "$BASE/Job/GetById?id=31855808&tenantId=$TENANT_ID"
hit "PROOF Visit/GetAll WITH JobId (returns visits)" POST "$BASE/Visit/GetAll" \
  '{"TenantId":"'"$TENANT_ID"'","PageIndex":1,"PageSize":5,"JobId":"31855808"}'
hit "ISSUE Visit/GetAll no JobId (returns 0)" POST "$BASE/Visit/GetAll" "$P"
hit "ISSUE Invoice/getall date window (returns 0)" POST "$BASE/Invoice/getall" \
  '{"TenantId":"'"$TENANT_ID"'","PageIndex":1,"PageSize":5,"StartDate":"2024-07-31T00:00:00Z","EndDate":"2026-07-04T23:59:59Z"}'
</content>
