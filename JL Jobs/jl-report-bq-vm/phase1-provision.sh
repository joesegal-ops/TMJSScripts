#!/usr/bin/env bash
#
# Phase 1: provision a fixed-IP VM that will run the Joblogic API -> BigQuery loader.
# Idempotent-ish (creates use "|| true"). Run it, then send the printed IP to Joblogic.
#
# Prereqs: gcloud authenticated as a user with Owner/Editor on the project
#          (you are already: joe.segal@up-fm.com on importdata-494110).
set -euo pipefail

# ---- EDIT THESE ------------------------------------------------------------
PROJECT="importdata-494110"
REGION="us-central1"          # keep within the US (dataset is US multi-region)
ZONE="us-central1-a"
VM_NAME="jl-report-loader"
IP_NAME="jl-report-egress-ip"
SA_NAME="jl-report-loader"
MACHINE="e2-micro"
# ----------------------------------------------------------------------------

SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
gcloud config set project "$PROJECT"

echo "==> 1. Enable APIs (compute, secret manager, bigquery)"
gcloud services enable \
  compute.googleapis.com secretmanager.googleapis.com bigquery.googleapis.com

echo "==> 2. Reserve the STATIC external IP (this is what Joblogic whitelists)"
gcloud compute addresses create "$IP_NAME" --region="$REGION" || true
STATIC_IP=$(gcloud compute addresses describe "$IP_NAME" --region="$REGION" --format='value(address)')

echo "==> 3. Service account with least-privilege BigQuery write"
gcloud iam service-accounts create "$SA_NAME" --display-name="JL report -> BQ loader" || true
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/bigquery.dataEditor" >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/bigquery.jobUser" >/dev/null

echo "==> 4. Create the VM, attach the static IP, run as the service account"
gcloud compute instances create "$VM_NAME" \
  --zone="$ZONE" \
  --machine-type="$MACHINE" \
  --image-family="debian-12" --image-project="debian-cloud" \
  --address="$STATIC_IP" \
  --service-account="$SA_EMAIL" \
  --scopes="https://www.googleapis.com/auth/cloud-platform" \
  --no-shielded-secure-boot \
  || true

cat <<EOF

============================================================
  STATIC EGRESS IP to whitelist with Joblogic:

      ${STATIC_IP}

  Next:
    1) Send joblogic-whitelist-request.md (with this IP) to Joblogic Support.
    2) SSH in and run vm-setup.sh:
         gcloud compute ssh ${VM_NAME} --zone=${ZONE}
       then copy vm-setup.sh + loader.py up (or git clone) and:
         sudo bash vm-setup.sh
    3) Put your API creds in /opt/jl-loader/secrets.env (root-only).
  The loader will fail until the IP above is whitelisted - that's expected.
============================================================
EOF
</content>
