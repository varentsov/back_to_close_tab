#!/usr/bin/env bash
# Produce the Chrome Web Store upload zip: runtime files only, no tests or docs.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

VERSION="$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')"
OUT="dist/back-to-close-tab-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

zip -q -r "$OUT" \
  manifest.json \
  background.js \
  content.js \
  options.html \
  options.js \
  icons \
  LICENSE \
  -x '*.DS_Store'

echo "built $OUT"
unzip -Z1 "$OUT" | sed 's/^/  /'
echo
echo "size: $(du -h "$OUT" | cut -f1)"
