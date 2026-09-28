#!/usr/bin/env bash
set -Eeuo pipefail

# The Python/FastAPI backend serves both the static React build (via
# StaticFiles, PEDI_SCHEDULER_STATIC_DIR points at the dist) and the /api/*
# routes on a single port (PORT, default 6173). Supersedes the Node backend
# (<= 0.21.0) and the even-older Python http.server.
#
# Binds to 0.0.0.0:6173 INSIDE the container's isolated network namespace
# (PEDI_SCHEDULER_BIND_HOST + TRUST_BIND env in the Dockerfile). compose maps
# that to the host's 127.0.0.1:6173 — the host side enforces loopback-only,
# the container side allows the bridge interface so Docker's port forwarding
# can reach the listener.
#
# cd into the backend root AND pin PYTHONPATH so `python -m backend_py.run`
# resolves the package regardless of how a future image refactor sets WORKDIR.
cd /srv/pedi-scheduler-backend
export PYTHONPATH=/srv/pedi-scheduler-backend
exec /opt/pedi-venv/bin/python -m backend_py.run
