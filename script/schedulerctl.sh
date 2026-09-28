#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$HOME/Library/Application Support/PediatricScheduler"
API_URL="http://127.0.0.1:6174"

if [ ! -d "$ROOT_DIR/node_modules" ]; then
  npm ci --prefix "$ROOT_DIR"
fi

if curl -fsS "$API_URL/api/health" >/dev/null 2>&1; then
  npm --prefix "$ROOT_DIR" run ctl -- --api "$API_URL" "$@"
else
  npm --prefix "$ROOT_DIR" run ctl -- --data-dir "$DATA_DIR" "$@"
fi
