#!/usr/bin/env bash
#
# One-time GCP setup for the Joblogic -> BigQuery pipeline.
# Provisions: static egress IP (via Cloud NAT), VPC connector, Secret Manager
# secrets, BigQuery dataset, a Cloud Run Job, and a Cloud Scheduler trigger.
#
# Run section by section the first time so you can copy the static IP out and
# send it to Joblogic Support to whitelist. Re-running is mostly idempotent.
#
# Prereqs: gcloud CLI authenticated (`gcloud auth login`) and a billing-enabled project.
set -euo pipefail

# ---- EDIT THESE ------------------------------------------------------------
PROJECT="your-gcp-project-id"
REGION="europe-west2"          # London; pick the region nearest you
DATASET="joblogic"
TABLE="report_snapshot"
SCHEDULE="*/15 * * * *"        # every 15 min; cron syntax
TZ="Europe/London"

# Joblogic API config (becomes env vars on the Cloud Run job)
JL_API_PATH="/job"             # <-- the endpoint that holds your report data
JL_RECORDS_KEY=""              # JSON key holding the array, e.g. "data" or "" if body is the array
JL_PAGE_PARAM="pageNumber"
JL_SIZE_PARAM="pageSize"
JL_PAGE_SIZE="200"
# ----------------------------------------------------------------------------

NETWORK="jl-vpc"
SUBNET="jl-subnet"
CONNECTOR="jl-connector"
ROUTER="jl-router"
NAT="jl-nat"
STATIC_IP_NAME="jl-api-egress-ip"
JOB="jl-bq-loader"
SA="jl-bq-loader"
SA_EMAIL="${SA}@${PROJECT}.iam.gserviceaccount.com"
REPO="jl-bq"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/loader:latest"

gcloud config set project "$PROJECT"

echo "==> 1. Enable APIs"
gcloud services enable \
  run.googleapis.com cloudscheduler.googleapis.com compute.googleapis.com \
  vpcaccess.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com bigquery.googleapis.com cloudbuild.googleapis.com

echo "==> 2. Network + subnet"
gcloud compute networks create "$NETWORK" --subnet-mode=custom || true
gcloud compute networks subnets create "$SUBNET" \
  --network="$NETWORK" --region="$REGION" --range="10.8.0.0/28" || true

echo "==> 3. Reserve the STATIC egress IP (whitelist this with Joblogic)"
gcloud compute addresses create "$STATIC_IP_NAME" --region="$REGION" || true
STATIC_IP=$(gcloud compute addresses describe "$STATIC_IP_NAME" --region="$REGION" --format='value(address)')
echo "    >>> STATIC EGRESS IP = ${STATIC_IP}  <<<  (send to Joblogic Support to whitelist)"

echo "==> 4. Cloud Router + Cloud NAT bound to the static IP"
gcloud compute routers create "$ROUTER" --network="$NETWORK" --region="$REGION" || true
gcloud compute routers nats create "$NAT" \
  --router="$ROUTER" --region="$REGION" \
  --nat-custom-subnet-ip-ranges="$SUBNET" \
  --nat-external-ip-pool="$STATIC_IP_NAME" || true

echo "==> 5. Serverless VPC connector (routes Cloud Run egress into the subnet)"
gcloud compute networks vpc-access connectors create "$CONNECTOR" \
  --region="$REGION" --subnet="$SUBNET" \
  --min-instances=2 --max-instances=3 --machine-type=e2-micro || true

echo "==> 6. Service account + IAM (BigQuery write)"
gcloud iam service-accounts create "$SA" --display-name="JL BigQuery loader" || true
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/bigquery.dataEditor"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/bigquery.jobUser"

echo "==> 7. Secrets (run interactively the first time)"
# printf %s "$YOUR_CLIENT_ID"     | gcloud secrets create jl-client-id     --data-file=-
# printf %s "$YOUR_CLIENT_SECRET" | gcloud secrets create jl-client-secret --data-file=-
gcloud secrets add-iam-policy-binding jl-client-id \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/secretmanager.secretAccessor" || true
gcloud secrets add-iam-policy-binding jl-client-secret \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/secretmanager.secretAccessor" || true

echo "==> 8. BigQuery dataset"
bq --location="$REGION" mk --dataset "${PROJECT}:${DATASET}" || true

echo "==> 9. Build & push image"
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker --location="$REGION" || true
gcloud builds submit --tag "$IMAGE" .

echo "==> 10. Deploy Cloud Run Job (egress forced through the VPC/NAT)"
gcloud run jobs deploy "$JOB" \
  --image="$IMAGE" --region="$REGION" \
  --service-account="$SA_EMAIL" \
  --vpc-connector="$CONNECTOR" \
  --vpc-egress=all-traffic \
  --max-retries=1 --task-timeout=900 \
  --set-env-vars="BQ_PROJECT=${PROJECT},BQ_DATASET=${DATASET},BQ_TABLE=${TABLE},JL_API_PATH=${JL_API_PATH},JL_RECORDS_KEY=${JL_RECORDS_KEY},JL_PAGE_PARAM=${JL_PAGE_PARAM},JL_SIZE_PARAM=${JL_SIZE_PARAM},JL_PAGE_SIZE=${JL_PAGE_SIZE}" \
  --set-secrets="JL_CLIENT_ID=jl-client-id:latest,JL_CLIENT_SECRET=jl-client-secret:latest"

echo "==> 11. Cloud Scheduler trigger"
SCHED_SA="scheduler-invoker@${PROJECT}.iam.gserviceaccount.com"
gcloud iam service-accounts create scheduler-invoker --display-name="Scheduler invoker" || true
gcloud run jobs add-iam-policy-binding "$JOB" --region="$REGION" \
  --member="serviceAccount:${SCHED_SA}" --role="roles/run.invoker" || true
gcloud scheduler jobs create http "${JOB}-trigger" \
  --location="$REGION" --schedule="$SCHEDULE" --time-zone="$TZ" \
  --uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run" \
  --http-method=POST \
  --oauth-service-account-email="$SCHED_SA" || true

echo "==> Done. Static egress IP to whitelist with Joblogic: ${STATIC_IP}"
echo "    Test now with:  gcloud run jobs execute ${JOB} --region=${REGION}"
