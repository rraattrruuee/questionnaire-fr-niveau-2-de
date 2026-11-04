#!/bin/bash
# generate-sw.sh - Auto-generate service worker assets list + version
# Usage: bash scripts/generate-sw.sh

set -e

cd "$(dirname "$0")/.."

# 0. Garde-fou anti-régression : refuser de régénérer le SW si un questionnaire
#    est mal formé (ex. "correct" écrit en chaîne au lieu d'un index entier).
#    Contournement exceptionnel : SKIP_VALIDATE=1 bash scripts/generate-sw.sh
if [ "${SKIP_VALIDATE:-0}" != "1" ]; then
    node scripts/fix-quiz-format.js --check
    node scripts/validate-quizzes.js
fi

# 1. Find all relevant files, exclude scripts/capture/.git, URL-encode filenames
FILES=$(find . -maxdepth 4 -type f \( -name "*.html" -o -name "*.css" -o -name "*.js" -o -name "*.svg" -o -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.webp" -o -name "*.gif" -o -name "*.ico" -o -name "*.woff" -o -name "*.woff2" -o -name "*.json" \) \
    ! -path "./.*" \
    ! -path "./scripts/*" \
    ! -path "./capture/*" \
    ! -path "./cloudflare-worker-posthog/*" \
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

# 2b. Defensive: remove any leftover git conflict markers and duplicate
# CACHE_NAME declarations (a rebase conflict can leave them outside the
# BEGIN_ASSETS/END_ASSETS block, producing invalid JavaScript).
sed -i -E '/^(<<<<<<<|=======|>>>>>>>)/d' service-worker.js
awk '/^const CACHE_NAME = / { if (seen++) next } { print }' service-worker.js > service-worker.js.tmp \
  && mv service-worker.js.tmp service-worker.js

# 3. Update cache version (timestamp-based for unique deploys)
VERSION=$(date +%s)
sed -i "s/^const CACHE_NAME = .*$/const CACHE_NAME = \"quiz-cache-${VERSION}\";/" service-worker.js

echo "✅ Cache version set to $VERSION."
echo "🚀 Done. service-worker.js is ready."
