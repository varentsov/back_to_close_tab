#!/usr/bin/env bash
# Optional deeper test: drives the extension with REAL macOS input events
# (CGEvent), the same layer a mouse driver like Logi Options+ operates at. The
# main suite injects through CDP, which sits below the browser's own shortcut
# handling and cannot see this.
#
# Requires Accessibility permission for your terminal:
#   System Settings > Privacy & Security > Accessibility
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
EXT="$(dirname "$(dirname "$HERE")")"
WORK="$(mktemp -d)"
BROWSER="${BROWSER_BIN:-/Applications/Vivaldi.app/Contents/MacOS/Vivaldi}"

cleanup() {
  if [[ -n "${SRV:-}" ]]; then kill "$SRV" 2>/dev/null || true; wait "$SRV" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

swiftc -O "$HERE/postkey.swift" -o "$WORK/postkey"
(cd "$HERE/../site" && python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1) &
SRV=$!
sleep 1

BROWSER_BIN="$BROWSER" PROFILE_DIR="$WORK/profile" EXT_DIR="$EXT" \
CDP_PORT="${CDP_PORT:-9333}" HARNESS="$HERE/os-test.mjs" HEADLESS=0 \
POSTER="$WORK/postkey" \
node "$HERE/../run.mjs" 2>&1 | grep -vE '^\[browser\]|ERROR:CONSOLE|bundle\.js'
