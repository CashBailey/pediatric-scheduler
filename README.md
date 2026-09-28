# Pediatric Neurology Scheduler

Local-only (machine-local) pediatric neurology scheduler. The current native
macOS app is SwiftUI and boots a bundled Python + FastAPI scheduler engine; the
legacy React + Vite frontend remains in the repo for the browser/Docker path.
No off-machine communication — schedule and roster data live entirely on the
user's machine. The backend binds loopback only; schedule data, roster data,
logs, telemetry, and analytics must not leave the machine.

## Project Layout

```
.
├── src/                          Frontend code (React)
├── macos/PediatricScheduler/      Native SwiftUI app
├── script/build_and_run.sh        Builds/verifies the native .app bundle
├── shared/                       Frontend domain code (imported by Vite)
│   ├── contracts/v1/             Canonical JSON Schemas (authored in JS)
│   └── scheduler/                Pure domain logic + tests + fixtures
├── contracts/v1/                 Frozen JSON Schemas (generated from the JS;
│                                   language-neutral copy the Python backend reads)
├── backend_py/                   Local-only Python + FastAPI backend
│   ├── main.py                   App factory + routes (health, state, static)
│   ├── persistence.py            Atomic JSON-file state storage
│   ├── bind.py                   Loopback bind guards
│   ├── initial_state.py          First-launch state (port of the JS leaf)
│   ├── contracts.py              Loads + validates against contracts/v1
│   ├── run.py                    Entrypoint (`python -m backend_py.run`)
│   └── tests/                    pytest suite
├── tests/                        Cross-cutting node:test specs
│                                   (offline-contract, contracts, contracts-freeze, handoff)
├── scripts/freeze-contracts.mjs  Regenerates contracts/v1 + the initial-state fixture
├── docs/                         Internal docs
├── docker/                       Dockerfile + entrypoint
├── dist/                         Vite build output (gitignored)
├── index.html                    Vite entry
├── vite.config.js
├── package.json
├── compose.yaml                  Local docker compose for the built image
└── release/
    ├── PediatricSchedulerMac/      Native customer handoff README
    └── CoordinatorPediSchedulerReact/  Legacy Docker handoff bundle
```

## Develop

```bash
npm install                                          # frontend deps
python3 -m venv backend_py/.venv                     # one-time: backend venv
backend_py/.venv/bin/pip install -r backend_py/requirements-dev.txt

npm run dev          # Vite dev server on 127.0.0.1:5173
npm run server       # Local-only Python backend on 127.0.0.1:6174 (uvicorn)
```

Vite proxies `/api/*` to `127.0.0.1:6174` during development (the proxy is
backend-agnostic — it just needs something answering on that port). In
production (Docker), the backend serves both the static React build (via
FastAPI `StaticFiles`) and the `/api/*` routes on a single port (6173).

## Native macOS App

The native app is the primary desktop surface:

```bash
make native-app       # builds and opens ~/Desktop/Pediatric Scheduler.app
make verify-native    # builds, opens, verifies runtime provenance + codesign
make package-native   # builds a Release .app and zip under .build/native-release/
make verify-native-ui # records native process/window/runtime audit artifacts
npm run verify:native # same verifier without Make
npm run package:native
npm run e2e:native
```

`script/build_and_run.sh` creates a self-contained app bundle at
`.build/app/PediatricScheduler.app`, then copies it to
`~/Desktop/Pediatric Scheduler.app`. The bundle includes
`Contents/Resources/Engine` with `backend_py/`, `contracts/`, `package.json`,
and the Python virtual environment the app launches. Verification calls
`/api/runtime` and fails if the backend is not running from the bundled Engine.
The native package command builds the same bundle with Release configuration,
writes `.build/native-release/PediatricScheduler-macOS.zip`, writes a SHA-256
file, copies the native handoff README, writes a JSON manifest, then extracts
that zip and verifies the extracted app signature plus bundled export/import
smoke checks. By default the bundle is ad-hoc signed for local use; set
`SCHEDULER_CODESIGN_IDENTITY` to a Developer ID Application certificate when
preparing a notarization-ready build.

## CLI Control

The scheduler has a local CLI control surface for the same state model the GUI
and backend use:

```bash
npm run ctl -- state show
npm run ctl -- block add --name "July 2026" --start 2026-07-01 --end 2026-07-31
npm run ctl -- rotator add --name "Drew Quinn" --program "UT Pediatrics" --level PGY-2 --start 2026-07-01 --end 2026-07-31
npm run ctl -- assign range --rotator "Drew Quinn" --from 2026-07-01 --to 2026-07-03 --phase inpatient
npm run ctl -- assign outpatient --rotator "Drew Quinn" --date 2026-07-06 --period AM --clinic "Continuity Clinic"
npm run ctl -- conflicts list --json
make ctl ARGS='state show'
```

By default the CLI reads and writes
`~/.local/share/pedi_scheduler/scheduler-state.json`, matching the non-Docker
backend default. To control a running Docker or dev server through the same
route the GUI uses, point it at the loopback API:

```bash
npm run ctl -- --api http://127.0.0.1:6173 state show
npm run ctl -- --api http://127.0.0.1:6173 assign range --rotator "Drew Quinn" --from 2026-07-01 --to 2026-07-03 --phase outpatient
```

`--api` accepts only loopback hosts. After CLI changes through the API, refresh
an already-open browser tab to rehydrate the visible UI from the backend mirror.
Browser edits still save through the existing debounced `/api/scheduler/state`
sync. The shared command inventory lives in `docs/COMMAND_INVENTORY.md`.

The backend exposes:

| Route | Purpose |
|---|---|
| `GET /api/health` | liveness + version |
| `GET /api/runtime` | runtime provenance for native bundle verification |
| `GET /api/scheduler/state` | persisted state, else a fresh initial state |
| `POST /api/scheduler/state` | validates against `scheduler-state.v1` + writes atomically |
| `POST /api/scheduler/command` | executes native scheduler commands and persists changed state |
| `POST /api/import/roster` | parses a selected local template roster or matrix Excel roster |
| `POST /api/import/coordinator-docx` | parses selected local Coordinator DOCX files |
| `POST /api/import/coordinator-docx/default` | parses the known July 2026 DOCX bundle from Downloads |

The native macOS app uses the Python backend as its local scheduler engine.
The legacy React path still imports `shared/scheduler` directly for browser UI
flows such as generic Excel roster import.

Routes are loopback-only; `assert_safe_bind` rejects non-loopback hosts
unless `PEDI_SCHEDULER_TRUST_BIND=1` (set in Docker, where the host
port-mapping enforces loopback at the network layer).

## Test

```bash
npm test             # vitest (frontend + shared/scheduler tests)
npm run test:offline # node --test (offline-contract + contracts + handoff)
npm run test:py      # pytest (Python backend)  [= backend_py/run-tests.sh]
```

Three categories:

- **vitest** (jsdom) — exercises `shared/scheduler` (domain + derived-views),
  `shared/scheduler/excel-import` (roster parser), and storage migration.
- **node:test** — offline-contract scans `src/`, `shared/`, and `backend_py/`
  for off-machine URLs; contracts-freeze guards the generated `contracts/v1`
  against the JS source; handoff-contract checks the Docker build files.
- **pytest** — the Python backend: bind guards, persistence, contract
  validation, state routes, static serving, and the entrypoint.

## Build

```bash
npm run build        # → dist/ (static HTML/CSS/JS)
npm run preview      # serve the built dist/ locally
make native-app      # → native .app copied to the Desktop
make package-native  # → Release native .app zip in .build/native-release/
```

## Customer Release

The primary customer release is the native macOS package:

```bash
make package-native
```

That writes these handoff files under `.build/native-release/`:

```text
PediatricScheduler-macOS.zip
PediatricScheduler-macOS.SHA256.txt
PediatricScheduler-macOS-MANIFEST.json
README.md
```

Coordinator only needs the zip and README for the native handoff — no Docker, Node,
npm, Python, Git, source checkout, or browser URL. See
`release/PediatricSchedulerMac/README.md` for the tracked copy of the end-user
instructions.

The legacy Docker handoff bundle remains supported at
`release/CoordinatorPediSchedulerReact/`. That path needs Docker Desktop and that
folder, but still no Node, npm, Python, Git, or source code on the customer
machine. It contains a prebuilt Docker image tarball, `compose.yaml`, and Mac
double-click scripts. See `release/CoordinatorPediSchedulerReact/README.md` for
legacy browser instructions and `release/CoordinatorPediSchedulerReact/WHATS_NEW.md`
for the per-version plain-language change log.

To regenerate the legacy Docker release bundle:

```bash
npm run build
docker build -f docker/Dockerfile -t pedi-scheduler-react:<version> .
docker save pedi-scheduler-react:<version> | gzip \
  > release/CoordinatorPediSchedulerReact/pedi-scheduler-react-docker-linux-amd64.tar.gz
sha256sum release/CoordinatorPediSchedulerReact/pedi-scheduler-react-docker-linux-amd64.tar.gz \
  | awk '{print $1}' > release/CoordinatorPediSchedulerReact/IMAGE_SHA256.txt
cd release && zip -r CoordinatorPediSchedulerReact-<version>.zip CoordinatorPediSchedulerReact/
```
