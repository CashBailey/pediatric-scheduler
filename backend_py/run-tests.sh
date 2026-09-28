#!/usr/bin/env bash
# Run the Python backend test suite hermetically.
#
# Why this wrapper instead of bare `pytest`:
#   - PYTHONPATH= clears any ambient site-packages leaking in from the
#     host (e.g. a sourced ROS workspace), so we only see backend_py/.venv.
#   - PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 stops pytest from auto-loading
#     unrelated third-party plugins found on the system. This backend
#     needs no pytest plugins, so disabling autoload keeps runs hermetic
#     and fast.
#
# Usage: backend_py/run-tests.sh [pytest args...]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"
venv_python="$here/.venv/bin/python"

if [[ ! -x "$venv_python" ]]; then
  echo "error: $venv_python not found. Create it with:" >&2
  echo "  python3 -m venv backend_py/.venv" >&2
  echo "  backend_py/.venv/bin/pip install -r backend_py/requirements-dev.txt" >&2
  exit 1
fi

cd "$repo_root"
# With no args, run the whole suite. With args (paths/flags), pass them
# through verbatim so you can target a single file or use -k expressions.
if [[ $# -eq 0 ]]; then
  set -- backend_py/tests
fi
PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 \
  "$venv_python" -m pytest "$@"
