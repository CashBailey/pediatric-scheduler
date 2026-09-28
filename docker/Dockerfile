# Local-only Pediatric Neurology Scheduler — Python backend image.
#
# The React frontend is built on the host (`npm run build` -> dist/) and
# copied in; this image only runs the Python/FastAPI backend, which serves
# both the static bundle and the /api/* routes on a single port (6173).
# (Supersedes the Node/Fastify runtime from <= 0.21.0.)
#
# The base image (Coordinator's desktop environment) ships Python 3.12 + curl
# but no pip, so we apt-install python3.12-venv to bootstrap a venv and
# install the backend's pinned deps into it.

FROM pedi-scheduler-desktop:0.2.0a1

USER root

# Bootstrap pip via python3.12-venv (base has Python 3.12 but no pip/ensurepip),
# then build an isolated venv for the backend. Clean apt lists to keep size down.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3.12-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/pedi-venv \
    && /opt/pedi-venv/bin/pip install --no-cache-dir --upgrade pip

# Install backend deps first (own layer) so app-code changes don't re-resolve pip.
COPY backend_py/requirements.txt /srv/pedi-scheduler-backend/backend_py/requirements.txt
RUN /opt/pedi-venv/bin/pip install --no-cache-dir \
    -r /srv/pedi-scheduler-backend/backend_py/requirements.txt

# React static frontend (Vite build output), served by FastAPI StaticFiles.
COPY dist/ /srv/pedi-scheduler-react/

# Python backend + the assets it reads at runtime:
#   backend_py/  — the FastAPI app and entrypoint
#   contracts/   — frozen v1 JSON Schemas (contracts.py loads contracts/v1)
#   package.json — name/version for /api/health (main.py reads it)
# main.py's REPO_ROOT is backend_py/.. , so package.json + contracts/ must
# sit beside backend_py/ under /srv/pedi-scheduler-backend.
COPY backend_py/ /srv/pedi-scheduler-backend/backend_py/
COPY contracts/ /srv/pedi-scheduler-backend/contracts/
COPY package.json /srv/pedi-scheduler-backend/package.json

COPY docker/entrypoint.sh /usr/local/bin/pedi-scheduler-react

RUN chmod +x /usr/local/bin/pedi-scheduler-react \
    && chown -R app:app /srv/pedi-scheduler-react /srv/pedi-scheduler-backend

USER app

ENV HOME=/home/app
ENV PORT=6173
ENV PEDI_SCHEDULER_DATA_DIR=/home/app/.local/share/pedi_scheduler
ENV PEDI_SCHEDULER_STATIC_DIR=/srv/pedi-scheduler-react
# Bind to 0.0.0.0 INSIDE the container so Docker's port mapping can reach the
# server. The privacy boundary is enforced host-side by `-p 127.0.0.1:6173:6173`
# in compose — the container's network namespace is isolated. assert_safe_bind
# requires this explicit opt-in (PEDI_SCHEDULER_TRUST_BIND=1) so any dev/CI run
# outside Docker still gets strict loopback-only.
ENV PEDI_SCHEDULER_BIND_HOST=0.0.0.0
ENV PEDI_SCHEDULER_TRUST_BIND=1

# WORKDIR must contain backend_py/ so `python -m backend_py.run` resolves.
WORKDIR /srv/pedi-scheduler-backend

EXPOSE 6173

# Functional liveness via /api/health (not / which always returns index.html).
# Base image has curl; no Node needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:6173/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/pedi-scheduler-react"]
