#!/usr/bin/env bash
#
# Runs ON the VM (jl-loader). Installs the loader + hourly cron. Credentials are pulled
# from Secret Manager at runtime using the VM's service account - nothing secret on disk.
#
# Get onto the VM (SSH is IAP-only - no public port):
#   gcloud compute scp loader.py vm-setup.sh jl-loader:~ --zone=europe-west2-a --tunnel-through-iap --project=vmimporteddata
#   gcloud compute ssh jl-loader --zone=europe-west2-a --tunnel-through-iap --project=vmimporteddata
#   sudo bash vm-setup.sh
set -euo pipefail

APP_DIR="/opt/jl-loader"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="vmimporteddata"

echo "==> packages (GCE Debian already ships gcloud)"
apt-get update -y
apt-get install -y python3 python3-venv python3-pip

echo "==> app dir + venv"
mkdir -p "$APP_DIR"
cp "$SRC_DIR/loader.py" "$APP_DIR/loader.py"
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --quiet --upgrade pip requests google-cloud-bigquery

echo "==> non-secret config (edit endpoint/target here; secrets come from Secret Manager)"
if [ ! -f "$APP_DIR/config.env" ]; then
  cat > "$APP_DIR/config.env" <<EOF
# Confirm the PRODUCTION hosts with Joblogic (docs show UAT hosts):
JL_TOKEN_URL=https://identityserver.joblogic.com/connect/token
JL_API_BASE=https://api.joblogic.com
JL_SCOPE=JL.Api
# The entity to pull for this cron entry (Phase 2 will run several, one per raw table):
JL_API_PATH=/job
JL_RECORDS_KEY=
# BigQuery target
BQ_PROJECT=vmimporteddata
BQ_DATASET=raw
BQ_TABLE=jobs
BQ_WRITE_MODE=WRITE_TRUNCATE
# Keep autodetect for raw landing; models layer does the typing.
BQ_AUTODETECT=true
LOADER_TARGET=prod
EOF
fi
chmod 644 "$APP_DIR/config.env"

echo "==> runner: fetch secrets from Secret Manager, then run loader"
cat > "$APP_DIR/run.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
set -a
source "$APP_DIR/config.env"
JL_CLIENT_ID="\$(gcloud secrets versions access latest --secret=jl-client-id     --project=$PROJECT)"
JL_CLIENT_SECRET="\$(gcloud secrets versions access latest --secret=jl-client-secret --project=$PROJECT)"
JL_TENANT_ID="\$(gcloud secrets versions access latest --secret=jl-tenant-id      --project=$PROJECT)"
set +a
exec "$APP_DIR/venv/bin/python" "$APP_DIR/loader.py"
EOF
chmod 700 "$APP_DIR/run.sh"

echo "==> hourly cron (Phase 2 switches to tiered schedules per entity)"
cat > /etc/cron.d/jl-report-loader <<EOF
0 * * * * root $APP_DIR/run.sh >> $APP_DIR/loader.log 2>&1
EOF
chmod 644 /etc/cron.d/jl-report-loader

cat <<EOF

==> Done. Before it can pull, Joblogic must whitelist this VM's IP (8.228.52.239)
    and you must add the secret values (from your machine, not the VM):
      printf %s 'YOUR_CLIENT_ID'     | gcloud secrets versions add jl-client-id     --data-file=- --project=$PROJECT
      printf %s 'YOUR_CLIENT_SECRET' | gcloud secrets versions add jl-client-secret --data-file=- --project=$PROJECT
      printf %s 'YOUR_TENANT_ID'     | gcloud secrets versions add jl-tenant-id      --data-file=- --project=$PROJECT
    Then manual test:  sudo $APP_DIR/run.sh   (expect rows in raw.jobs)
    Watch:             tail -f $APP_DIR/loader.log
EOF
</content>
