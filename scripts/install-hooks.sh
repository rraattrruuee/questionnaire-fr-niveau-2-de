#!/bin/bash
# Installe les hooks git du projet (pre-commit = validation des questionnaires).
# Usage : bash scripts/install-hooks.sh
set -e

cd "$(dirname "$0")/.."

chmod +x .githooks/pre-commit scripts/fix-quiz-format.js scripts/quiz_lib.py 2>/dev/null || true
git config core.hooksPath .githooks

echo "✅ Hook pre-commit installé (core.hooksPath = .githooks)."
echo "   À chaque commit touchant data/**.json :"
echo "     - node scripts/fix-quiz-format.js --check"
echo "     - node scripts/validate-quizzes.js"
