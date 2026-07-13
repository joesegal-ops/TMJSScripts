#!/usr/bin/env bash
# Durable install of the scheduled loader on the VM. Run as root (sudo), detached.
set -x
rm -f /opt/jl-loader/.install_done
pkill -9 -f load_visits.py 2>/dev/null || true
mkdir -p /opt/jl-loader
cp /tmp/loader.py       /opt/jl-loader/loader.py
cp /tmp/run_tier.sh     /opt/jl-loader/run_tier.sh
cp /tmp/config.env      /opt/jl-loader/config.env
chmod 755 /opt/jl-loader/run_tier.sh
chmod 644 /opt/jl-loader/config.env
# fresh, durable venv (pip is the slow step; that's why we run detached)
rm -rf /opt/jl-loader/venv
python3 -m venv /opt/jl-loader/venv
/opt/jl-loader/venv/bin/pip install -q --upgrade pip requests google-cloud-bigquery
/opt/jl-loader/venv/bin/python -c "import requests, google.cloud.bigquery"
# install cron
cp /tmp/jl-loader.cron /etc/cron.d/jl-loader
chmod 644 /etc/cron.d/jl-loader
touch /opt/jl-loader/loader.log
touch /opt/jl-loader/.install_done
echo "INSTALL COMPLETE"
