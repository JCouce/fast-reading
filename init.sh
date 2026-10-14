#!/usr/bin/env bash
# Smoke test: dependencias instaladas y el proyecto compila.
set -euo pipefail
cd "$(dirname "$0")"
[[ -d node_modules ]] || npm install --no-audit --no-fund
npx tsc --noEmit
echo "init ok"
