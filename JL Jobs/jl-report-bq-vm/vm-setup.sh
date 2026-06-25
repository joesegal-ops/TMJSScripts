#!/usr/bin/env bash
#
# Runs ON the VM (sudo bash vm-setup.sh). Installs the loader + hourly cron.
# Copy loader.py into the same dir as this script before running, e.g.:
#   gcloud compute scp loader.py vm-setup.sh jl-report-loader:~ --zone=us-central1-a
#   gcloud compute ssh jl-report-loader --zone=us-central1-a
#   sudo bash vm-setup.sh
set -euo pipefail

APP_DIR="/opt/jl-loader"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> packages"
apt-get update -y
apt-get install -y python3 python3-venv python3-pip

echo "==> app dir + venv"
mkdir -p "$APP_DIR"
cp "$SRC_DIR/loader.py" "$APP_DIR/loader.py"
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --quiet --upgrade pip requests google-cloud-bigquery

echo "==> secrets file (you fill this in next)"
if [ ! -f "$APP_DIR/secrets.env" ]; then
  cat > "$APP_DIR/secrets.env" <<'EOF'
# Joblogic API credentials + config. chmod 600. NEVER commit this.
JL_CLIENT_ID=PUT_CLIENT_ID_HERE
JL_CLIENT_SECRET=PUT_CLIENT_SECRET_HERE
# Confirm these against apidocs.joblogic.com / your API onboarding:
JL_TOKEN_URL=https://identityserver.joblogic.com/connect/token
JL_API_BASE=https://api.joblogic.com
JL_SCOPE=JL.Api
JL_API_PATH=/job
JL_RECORDS_KEY=
# BigQuery
BQ_PROJECT=importdata-494110
BQ_DATASET=JobLogic
# Stay on staging until the Phase 2 transform is validated, then flip to prod:
LOADER_TARGET=staging
BQ_AUTODETECT=true
EOF
fi
chmod 600 "$APP_DIR/secrets.env"

echo "==> runner wrapper"
cat > "$APP_DIR/run.sh" <<EOF
#!/usr/bin/env bash
set -a; source "$APP_DIR/secrets.env"; set +a
exec "$APP_DIR/venv/bin/python" "$APP_DIR/loader.py"
EOF
chmod 700 "$APP_DIR/run.sh"

echo "==> hourly cron (logs to $APP_DIR/loader.log)"
cat > /etc/cron.d/jl-report-loader <<EOF
# m h dom mon dow user command
0 * * * * root $APP_DIR/run.sh >> $APP_DIR/loader.log 2>&1
EOF
chmod 644 /etc/cron.d/jl-report-loader

cat <<EOF

==> Done. Next:
   1) Edit $APP_DIR/secrets.env  -> real JL_CLIENT_ID / JL_CLIENT_SECRET, confirm URLs/endpoint.
   2) Manual test (after Joblogic has whitelisted this VM's IP):
        sudo $APP_DIR/run.sh
      Expect rows loaded into JobLogic.Job_and_Visit_Details_api_staging.
   3) Cron runs hourly. Watch:  tail -f $APP_DIR/loader.log
EOF
</content>
