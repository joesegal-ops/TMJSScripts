#!/bin/bash
# Copies every *.user.js (and SHARED-DOCK.md) from the private workspace into this
# public repo, keeping the same folder paths so TamperMonkey update URLs don't change.
# Review with `git status`, then commit and push as usual.
set -euo pipefail
SRC="$HOME/Documents/Claude Code"
DST="$(cd "$(dirname "$0")" && pwd)"
cd "$SRC"
find . -name '*.user.js' -not -path './.git/*' -print0 | while IFS= read -r -d '' f; do
  mkdir -p "$DST/$(dirname "$f")"
  cp -p "$f" "$DST/$f"
done
cp -p SHARED-DOCK.md "$DST/" 2>/dev/null || true
cd "$DST" && git status --short
