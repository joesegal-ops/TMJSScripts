#!/usr/bin/env bash
#
# Phase 1 provisioning for the Joblogic API -> BigQuery warehouse.
# THIS RECORDS WHAT WAS ACTUALLY RUN on 2026-07-03 against project `vmimporteddata`
# (already executed). Kept for reproducibility + teardown. Safe to re-run (idempotent-ish).
#
# Result: static egress IP 8.228.52.239 (London/europe-west2), hardened e2-micro VM `jl-loader`,
# raw+models datasets, least-priv SA, Secret Manager secrets, IAP-only SSH, £30/mo budget alert.
set -euo pipefail

PROJECT=vmimporteddata
REGION=europe-west2          # London (moved from us-central1 for UK egress)
ZONE=europe-west2-a
VM=jl-loader
IP_NAME=jl-loader-egress-ip
SA=jl-loader
SA_EMAIL="${SA}@${PROJECT}.iam.gserviceaccount.com"
PROJECT_NUM=363674789324
USER_EMAIL=joe.segal@up-fm.com
BILLING_ACCT=016DB6-D58C3F-FD1488

echo "==> 1. APIs"
gcloud services enable compute.googleapis.com secretmanager.googleapis.com \
  bigquery.googleapis.com iap.googleapis.com billingbudgets.googleapis.com --project="$PROJECT"

echo "==> 2. BigQuery datasets (US, to match importdata-494110 for cross-project comparison)"
bq --location=US --project_id="$PROJECT" mk --dataset "${PROJECT}:raw"    || true
bq --location=US --project_id="$PROJECT" mk --dataset "${PROJECT}:models" || true

echo "==> 3. Static egress IP (whitelist this with Joblogic)"
gcloud compute addresses create "$IP_NAME" --region="$REGION" --project="$PROJECT" || true
STATIC_IP=$(gcloud compute addresses describe "$IP_NAME" --region="$REGION" --project="$PROJECT" --format='value(address)')

echo "==> 4. Least-privilege service account (BigQuery write)"
gcloud iam service-accounts create "$SA" --display-name="Joblogic API -> BigQuery loader" --project="$PROJECT" || true
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${SA_EMAIL}" --role="roles/bigquery.dataEditor" --condition=None
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${SA_EMAIL}" --role="roles/bigquery.jobUser"   --condition=None

echo "==> 5. VM: attach static IP, run as SA, OS Login + Shielded VM"
gcloud compute instances create "$VM" --project="$PROJECT" --zone="$ZONE" \
  --machine-type=e2-micro --image-family=debian-12 --image-project=debian-cloud \
  --address="$STATIC_IP" --service-account="$SA_EMAIL" \
  --scopes="https://www.googleapis.com/auth/cloud-platform" \
  --metadata=enable-oslogin=TRUE \
  --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring || true

echo "==> 6. HARDEN firewall: no public SSH/RDP, SSH only via IAP tunnel"
gcloud compute firewall-rules delete default-allow-ssh --project="$PROJECT" -q || true
gcloud compute firewall-rules delete default-allow-rdp --project="$PROJECT" -q || true
gcloud compute firewall-rules create allow-iap-ssh --project="$PROJECT" \
  --direction=INGRESS --action=ALLOW --rules=tcp:22 --source-ranges=35.235.240.0/20 \
  --description="SSH via IAP tunnel only" || true
gcloud projects add-iam-policy-binding "$PROJECT" --member="user:${USER_EMAIL}" --role="roles/iap.tunnelResourceAccessor" --condition=None
gcloud projects add-iam-policy-binding "$PROJECT" --member="user:${USER_EMAIL}" --role="roles/compute.osAdminLogin"      --condition=None

echo "==> 7. Secret Manager (empty containers; add real values with 'gcloud secrets versions add')"
for S in jl-client-id jl-client-secret jl-tenant-id; do
  gcloud secrets create "$S" --project="$PROJECT" --replication-policy=automatic || true
  gcloud secrets add-iam-policy-binding "$S" --project="$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" --role="roles/secretmanager.secretAccessor" || true
done

echo "==> 8. Budget alert (£30/mo, 50/90/100%)"
gcloud billing budgets create --billing-account="$BILLING_ACCT" \
  --display-name="vmimporteddata monthly guard" --budget-amount=30GBP \
  --filter-projects="projects/${PROJECT_NUM}" \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
  --billing-project="$PROJECT" || true

echo ">>> STATIC EGRESS IP to whitelist with Joblogic: ${STATIC_IP}"

# ---- TEARDOWN (delete everything this created) ------------------------------
# gcloud compute instances delete jl-loader --zone=europe-west2-a --project=vmimporteddata -q
# gcloud compute addresses delete jl-loader-egress-ip --region=europe-west2 --project=vmimporteddata -q
# gcloud compute firewall-rules delete allow-iap-ssh --project=vmimporteddata -q
# for S in jl-client-id jl-client-secret jl-tenant-id; do gcloud secrets delete $S --project=vmimporteddata -q; done
# gcloud iam service-accounts delete jl-loader@vmimporteddata.iam.gserviceaccount.com --project=vmimporteddata -q
# bq rm -r -d vmimporteddata:raw ; bq rm -r -d vmimporteddata:models
</content>
