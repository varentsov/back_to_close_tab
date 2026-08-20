#!/usr/bin/env bash
# End-to-end test of the extension in a real browser, driven over CDP.
# Uses a throwaway profile; your own browser profile is never touched.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
EXT="$(dirname "$HERE")"
WORK="$(mktemp -d)"
BROWSER="${BROWSER_BIN:-/Applications/Vivaldi.app/Contents/MacOS/Vivaldi}"

cleanup() {
  if [[ -n "${SRV:-}" ]]; then kill "$SRV" 2>/dev/null || true; wait "$SRV" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

(cd "$HERE/site" && python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1) &
SRV=$!
sleep 1

BROWSER_BIN="$BROWSER" \
PROFILE_DIR="$WORK/profile" \
EXT_DIR="$EXT" \
CDP_PORT="${CDP_PORT:-9333}" \
HARNESS="$HERE/scenarios.mjs" \
HEADLESS="${HEADLESS:-0}" \
node "$HERE/run.mjs" 2>&1 | grep -vE '^\[browser\]|ERROR:CONSOLE|bundle\.js|ws closed'
