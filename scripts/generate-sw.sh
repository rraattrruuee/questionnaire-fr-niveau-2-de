#!/bin/bash
# generate-sw.sh - Auto-generate service worker assets list + version
# Usage: bash scripts/generate-sw.sh

set -e

cd "$(dirname "$0")/.."

# 1. Find all relevant files, exclude scripts/capture/.git, URL-encode filenames
FILES=$(find . -maxdepth 4 -type f \( -name "*.html" -o -name "*.css" -o -name "*.js" -o -name "*.svg" -o -name "*.png" -o -name "*.json" \) \
    ! -path "./.*" \
    ! -path "./scripts/*" \
    ! -path "./capture/*" \
    | sed 's|^\.||' | sort \
    | python3 -c "
import sys, urllib.parse
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    parts = line.split('/')
    encoded = '/'.join(urllib.parse.quote(p, safe='.') for p in parts)
    print('  \".' + encoded + '\",')
")

# 2. Replace content between marker comments in service-worker.js
awk -v files="$FILES" '
  /\/\/ BEGIN_ASSETS/ { print "// BEGIN_ASSETS"; print "const STATIC_ASSETS = ["; print files; print "];"; skip=1; next }
  /\/\/ END_ASSETS/ { print "// END_ASSETS"; skip=0; next }
  !skip { print }
' service-worker.js > service-worker.js.tmp && mv service-worker.js.tmp service-worker.js

echo "✅ service-worker.js assets list updated."

# 3. Update cache version (git short hash or timestamp)
VERSION=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
sed -i "s/^const CACHE_NAME = .*$/const CACHE_NAME = \"quiz-cache-${VERSION}\";/" service-worker.js

echo "✅ Cache version set to $VERSION."
echo "🚀 Done. service-worker.js is ready."
