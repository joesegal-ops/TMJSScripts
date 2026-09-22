#!/usr/bin/env bash
# Cron wrapper: log everything, but MAIL only on failure.
#
# Why this exists: every jl-loader cron line used to end in `>> loader.log 2>&1`, which swallows
# stderr. In Jul 2026 load_quote_types.py crashed on a /tmp collision every night for a week and
# nothing surfaced it -- raw.quote_types silently stopped updating for two months. Cron mails the
# owner when a job writes to stderr, so the fix is to keep the full transcript in loader.log AND
# re-emit a tail on stderr when the job exits non-zero.
#
# Usage in cron:  <schedule> root /opt/jl-loader/jl-run.sh <label> <command> [args...]
set -uo pipefail
APP=/opt/jl-loader
LOG="$APP/loader.log"
LABEL="$1"; shift

start=$(date -u +%FT%TZ)
"$@" >> "$LOG" 2>&1
rc=$?
if [ "$rc" -ne 0 ]; then
  # Loud, greppable marker in the log FIRST. Mail may not be deliverable (the Workspace SMTP relay
  # allowlist is not set up), so the log has to stand on its own: `grep "jl-loader FAILED" loader.log`.
  echo "$(date -u +%FT%TZ) jl-loader FAILED: $LABEL (exit $rc) -- cmd: $*" >> "$LOG"
  {
    echo "jl-loader FAILED: $LABEL (exit $rc)"
    echo "  started : $start"
    echo "  command : $*"
    echo "  host    : $(hostname)"
    echo
    echo "--- last 40 lines of $LOG ---"
    tail -40 "$LOG"
  } >&2
fi
exit "$rc"
