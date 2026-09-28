# Python backend (`backend_py/`)

> **This is the shipping backend as of v0.22.0.** The Node/Fastify backend
> (`backend/`) was removed in commit `b01cce6` (2026-05-24). Docker runs this
> Python/FastAPI backend, which serves the built React static bundle and the
> `/api` routes listed below. The native macOS app embeds the same backend as
> its local scheduler engine.

## Architecture

The backend is the native app's local scheduler engine. It owns:

1. **Local state persistence** — read/write one `scheduler-state.json` file
   atomically (temp-file + rename, never raises).
2. **Health endpoint** — version check.
3. **Command execution** — the native app mutates state through
   `POST /api/scheduler/command`.
4. **Python scheduler domain ports** — initial state, draft generation,
   planning projection, reports, conflicts, exports, rules, assignments,
   rotators, blocks, attendings, and poster settings.
5. **Roster imports** — parses template-style CSV/JSON/XLSX/XLSM roster
   files, matrix-style XLSX/XLSM week grids, plus Coordinator's three-file local DOCX bundle, into validated
   scheduler-state previews.
6. **Static file serving** — serves the built `dist/` React bundle in Docker
   for the legacy web path.

The legacy React app still imports `shared/scheduler/` directly for some web UI
flows. The native macOS app does not use a WebView and does not require a React
build to run.

## Implemented routes

| Route | Purpose |
|---|---|
| `GET /api/health` | Health and version check (`{ok, name, version}`). |
| `GET /api/runtime` | Runtime provenance for native bundle verification. |
| `GET /api/scheduler/state` | Return persisted state, or fresh initial state on first launch (200). |
| `POST /api/scheduler/state` | Validate state against the frozen v1 schema and write atomically. |
| `POST /api/scheduler/command` | Execute one scheduler command and persist the returned state when changed. |
| `POST /api/import/roster` | Parse a user-selected absolute local CSV/JSON/XLSX/XLSM template roster path or XLSX/XLSM matrix roster path, including merge/replace/add mode, column mapping overrides for template files, source-record replacement previews, request-body cap, extension validation, and a 25 MiB source-file cap before parsing. |
| `POST /api/import/coordinator-docx` | Parse user-selected absolute local Master/Inpatient/Outpatient DOCX paths, after request-body cap, DOCX extension validation, and the 25 MiB per-file cap. |
| `POST /api/import/coordinator-docx/default` | Parse the newest complete Coordinator DOCX master/inpatient/outpatient bundle from the current user's Downloads folder, after the same DOCX and size guardrails. |

## Deliberately unimplemented routes

The legacy React frontend handles these route shapes client-side by importing
`shared/scheduler/` directly. The native app uses `/api/scheduler/command`
instead.

- `GET /api/scheduler/initial-state` — constructed client-side.
- `POST /api/scheduler/detect-conflicts` — legacy web route; native uses `conflicts.list`.
- `POST /api/scheduler/generate-legend` — runs client-side via shared JS.
- `POST /api/import/excel` — legacy browser route; native roster import uses
  `POST /api/import/roster`.

## Docker

The production Docker image builds the React bundle, installs Python deps, and
runs `python -m backend_py.run` to serve both `dist/` static files and the
`/api` routes on one loopback-bound port (default `127.0.0.1:6173`).

Persistent data volume: `pedi_scheduler_react_data`  
Container path: `/home/app/.local/share/pedi_scheduler/scheduler-state.json`

## Implementation notes

- `bind.py`: loopback guard — matches Node's exact host set `{127.0.0.1, localhost, ::1}`, not `ipaddress.is_loopback`.
- `contracts.py`: frozen v1 JSON schema validator (draft-07, Ajv-compatible).
- `persistence.py`: atomic temp-file + `os.replace`, 1:1 port of `backend/src/persistence.js` semantics.
- `initial_state.py`: port of `scheduler.js::createInitialState()`, parity-locked by `tests/test_initial_state.py`.
- `domain/commands.py`: native command dispatcher, parity-aligned with the shared scheduler command envelope.
- `roster_import.py`: local template-style roster parser/merger for CSV, JSON, XLSX, and XLSM, plus matrix-style XLSX/XLSM week-grid parser, with merge/replace/add previews.
- `coordinator_docx_import.py`: local DOCX parser for Coordinator's Master Schedule, Inpatient Roster, and Outpatient Assignments files.

See `contracts/v1/*.schema.json` for frozen wire-format schemas.

## Setup & test

```bash
python3 -m venv backend_py/.venv
backend_py/.venv/bin/pip install -r backend_py/requirements-dev.txt
backend_py/run-tests.sh           # hermetic pytest run
```

`run-tests.sh` clears `PYTHONPATH` and disables pytest plugin autoload so an
ambient host environment (e.g. a sourced ROS workspace) can't leak in.
