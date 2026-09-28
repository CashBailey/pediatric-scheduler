#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

./script/build_and_run.sh --verify
npm test
npm run test:offline
backend_py/.venv/bin/python -m pytest backend_py/tests
npm run e2e:audit -- --results-dir verification/results
