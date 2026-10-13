#!/usr/bin/env bash
# Launch set_job_ref1.py detached on the jl-loader VM (survives SSH logout; rerun to resume).
#   ~/jobref1/run_set_job_ref1.sh ~/jobref1/LIST.tsv [--dry-run|--limit N|--only-empty|--notify addr]
# Live log:  tail -f ~/jobref1/LIST_run/run.log      Stop:  sudo systemctl stop jl-jobref1
set -euo pipefail
LIST="$(readlink -f "$1")"; shift
OUT="${LIST%.*}_run"; mkdir -p "$OUT"
export JL_CLIENT_ID=$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata)
export JL_CLIENT_SECRET=$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata)
export JL_TENANT_ID=$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata)
sudo systemd-run --unit=jl-jobref1 --uid="$(id -u)" --gid="$(id -g)" --collect \
  --setenv=JL_CLIENT_ID="$JL_CLIENT_ID" --setenv=JL_CLIENT_SECRET="$JL_CLIENT_SECRET" --setenv=JL_TENANT_ID="$JL_TENANT_ID" \
  --setenv=HOME="$HOME" --working-directory="$(dirname "$LIST")" \
  /bin/bash -c "exec /opt/jl-loader/venv/bin/python $HOME/jobref1/set_job_ref1.py '$LIST' --outdir '$OUT' $* >> '$OUT/run.log' 2>&1"
echo "started jl-jobref1 — log: $OUT/run.log"
