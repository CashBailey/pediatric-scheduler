# Project Verification

The scheduler is verified by one command:

```bash
make verify-project
```

That command writes a timestamped summary to
`verification/results/project-verification-*.md` and stores per-step logs beside
it. The model is CLI-first: every claim must be repeatable from a noninteractive
command, and every check leaves durable evidence.

## Principle

Every user-visible scheduler capability that can be proven in a browser gets a
browser-driven check. Every effect the browser cannot prove gets a CLI-backed
probe or test. The browser audit is therefore not the whole verification story;
it is one layer in a broader project gate.

## Layer A: Browser-Auditable

Browser-auditable checks are limited to behavior that a real browser can observe:

- the built React app is served by the local FastAPI backend
- React hydrates successfully
- the Scheduler shell, navigation, default dark theme, and local-save status are visible
- a screenshot and DOM snapshot are captured as evidence

Current browser IDs live in `browser_test_README.md` and are implemented by
`e2e/run-browser-audit.mjs`.

Artifacts:

- `verification/results/browser-audit-*.md`
- `verification/results/browser-audit-*.json`
- `verification/results/browser-audit-*.html`
- `verification/results/browser-audit-*.png`
- `verification/results/browser-audit-server-*.log`

## Layer B: CLI-Backed

CLI-backed checks prove facts the browser cannot prove:

- frontend/shared scheduler logic passes Vitest
- frozen JSON contracts and handoff contracts pass `node:test`
- `schedulerctl` controls scheduler state through the shared domain model and
  refuses off-machine API targets
- shared command/CLI/GUI parity checks prove low-risk GUI mutations and CLI
  commands use the same command/state model where implemented
- Python/FastAPI backend route, persistence, bind, static-serving, and schema tests pass
- command route tests prove finalized service blocks retain durable
  `postFinalChanges` and command envelopes expose `data.postFinalChange` after
  post-final edits
- `/api/health` matches `package.json`
- `POST /api/scheduler/state` writes exact JSON to local disk and `GET` round-trips it
- invalid scheduler state is rejected before persistence
- compose and bind guards preserve loopback-only exposure
- static file serving does not shadow `/api/*` routes
- native macOS bundle verification proves the SwiftUI `.app` launches its
  bundled Python engine from `Contents/Resources/Engine`
- native GUI audit proves the Desktop app opens on deterministic seeded data
  and records screen/planning-grid probes
- native release package verification proves the zipped `.app` still contains a usable
  bundled engine after extraction

Artifacts:

- `verification/results/cli-probes-*.md`
- `verification/results/cli-probes-*.json`
- `verification/results/cli-probe-state-*.json`
- per-command logs from `scripts/run_project_verification.sh`

The CLI control and shared-command tests run inside `npm run test:offline`.
They cover file-backed state, range assignment persistence, command-created
state accepted by the GUI hydration heuristic, raw loopback API POST shape, and
the loopback-only API guard. The API mode itself uses the same
`GET /api/scheduler/state` and `POST /api/scheduler/state` routes that the GUI
sync path uses.

Current shared command parity covers the native low-risk mutation paths first:
block add/switch/update/delete, roster add/edit/delete, range assign, single
inpatient/outpatient assignment, draft generation, reports, exports, settings,
and rules patch. The native Coordinator DOCX import route has backend proof; OS
file-picker behavior, PDF visual fidelity, and dense calendar readability remain
manual evidence surfaces.

## Native Bundle Gate

The native macOS app has host-specific verifiers that are included in
`make verify-project` on this Mac and can also be rerun directly:

```bash
make verify-native
# or
npm run verify:native
```

This builds the SwiftUI app, assembles `PediatricScheduler.app`, copies the
Python engine and contracts into `Contents/Resources/Engine`, launches the
Desktop copy, checks `/api/runtime` reports that bundled Engine as both
`engineRoot` and `cwd`, rejects absolute symlinks inside the bundled Engine,
proves the bundled Python can import backend/contracts with `PYTHONHOME` pointed
inside the app, smokes `export.package`, `export.pdfs`, `export.word`, and a
tiny CSV roster import through the bundled Engine, and verifies codesigning.
The static contract for this flow is also covered by
`tests/verification-contract.test.mjs` inside `npm run test:offline`.

For a local native handoff archive, `make package-native` or `npm run
package:native` builds the same app with Release configuration, verifies the
bundled Python import gate, checks the copied package signature, writes
`.build/native-release/PediatricScheduler-macOS.zip`, writes
`PediatricScheduler-macOS.SHA256.txt`, writes
`PediatricScheduler-macOS-MANIFEST.json`, copies the native handoff README,
extracts that zip into a clean verification directory, and verifies the
extracted app signature, launches the extracted app, checks `/api/runtime`
points at the extracted bundle's `Contents/Resources/Engine`, and runs the
bundled export/import smoke. The package is ad-hoc signed unless
`SCHEDULER_CODESIGN_IDENTITY` is set; notarization still requires real Apple
Developer ID credentials and a separate notary submission.

## Native UI Audit

The host-specific native GUI smoke check is part of the main project gate and
can also be run directly:

```bash
make verify-native-ui
# or
npm run e2e:native
```

It first seeds a deterministic Planning Grid state with
`e2e/seed-demo-state.mjs --data-dir --profile planning-grid`, launches the
Desktop app with `SCHEDULER_INITIAL_SCREEN="Planning Grid"` and an isolated
`SCHEDULER_DATA_DIR`, then records process,
frontmost-window, System Events window, native window-probe, native screen-probe,
Planning Grid projection-probe, `/api/runtime`, `/api/scheduler/state`, and
`grid.show` evidence. The seeded state is `block-may-2026` / May 2026 Pediatric
Neurology and includes Maya Lopez, Jules Nguyen, Drew Quinn, Noah Patel, Sam
Carter, and Dana Reyes across the fully inpatient, fully outpatient, mixed, and
needs-assignment Planning Grid sections.

The audit then seeds a separate finalizable Reports scenario with
`--profile reports-final-handoff`, launches the Desktop app on Reports with
`SCHEDULER_REPORTS_HANDOFF_AUDIT=1`, and waits for the SwiftUI Reports handoff
probe at `native-ui-reports-handoff.json`. That probe uses the native store
paths to load all-date review checks, mark `block-final-handoff-2026` Final,
build the combined handoff packet, and assert root package files plus
`PDFs/*.pdf` and `Word/*.docx` files were written. It also exercises the
Reports export review/acceptance surface by checking the package, PDF, Word,
and CSV artifact counts and recording that the handoff was accepted. Shared JS
and Python command tests also verify later edits to a Final block append
`postFinalChanges`, echo `data.postFinalChange`, persist the ledger, and render
the native Reports ledger section.

Next, the audit seeds `--profile dashboard-draft-generation`, launches the
Desktop app on Dashboard with `SCHEDULER_DASHBOARD_DRAFT_AUDIT=1`, and waits for
`native-ui-dashboard-draft.json`. That probe runs the same native
`draft.generate` store path as the Dashboard button, verifies the decoded draft
report, and confirms the backend state now contains five Auto-Draft inpatient
assignments for `block-draft-generation-2026`.

Then, the audit seeds `--profile methodist-auto`, launches the Desktop app on
Inpatient with `SCHEDULER_METHODIST_AUTO_AUDIT=1`, and waits for
`native-ui-methodist-auto.json`. That probe runs the same native
`methodist.auto` store path as the Inpatient Methodist 14/14 button, verifies
the generated 14 inpatient and 18 outpatient Auto-Methodist rows, preserving
the default Tuesday PM continuity-clinic slots, reruns the command for
idempotency, and confirms the backend state persisted the generated schedule
for `block-methodist-auto-2026`.

Then, the audit seeds `--profile planning-edit-undo`, launches the Desktop
app on Planning Grid with `SCHEDULER_PLANNING_EDIT_AUDIT=1`, and waits for
`native-ui-planning-edit.json`. That probe runs the native `assign.range` edit
path, verifies undo removes the assignment through the raw-state stack, verifies
redo restores it, and confirms the backend state ends with one `Range-Assigned`
inpatient assignment for `block-planning-edit-2026`.

The native audit also attempts a separate Planning Grid AX click proof from a
fresh `planning-grid-ax` data directory without
`SCHEDULER_PLANNING_EDIT_AUDIT`. When macOS exposes the app window through
System Events, it clicks the real SwiftUI Apply button by
`planning-grid-apply-button`, clicks the toolbar Undo and Redo controls by
`scheduler-toolbar-undo` and `scheduler-toolbar-redo`, and polls
`/api/scheduler/state` until the seeded block goes `0 -> 5 -> 0 -> 5` range
assignments for the five weekday dates in `block-planning-edit-2026`. If the
session has no screenshot/AX window access, the audit records an explicit skip
with the native Planning Grid probe artifact instead of reporting a product
failure.

Then, the audit seeds `--profile sources-roster-import`, launches the
Desktop app on Sources with `SCHEDULER_SOURCES_IMPORT_AUDIT=1`, and waits for
`native-ui-sources-import.json`. That probe writes a small local CSV into the
isolated audit data directory, runs the native `previewRosterFile` and
`commitRosterImportResult` store paths, verifies the preview counts, and
confirms the backend state now contains the reviewed source record plus the
imported rotators for `block-source-import-2026`.

Then, the audit seeds `--profile rotators-edit`, launches the Desktop app on
Rotators with `SCHEDULER_ROTATORS_EDIT_AUDIT=1`, and waits for
`native-ui-rotators-edit.json`. That probe runs the native `rotator.add`,
`rotator.update`, `roster.dedupe`, and `rotators.delete` store paths, verifies
Methodist metadata, segment templates, availability fields, duplicate cleanup,
IP/OP session repointing, and bulk-delete behavior, and confirms the backend
state now contains the edited rotator plus one deduped duplicate-name rotator
for `block-rotators-edit-2026`.

Then, the audit seeds `--profile outpatient-edit`, launches the Desktop app
on Outpatient with `SCHEDULER_OUTPATIENT_EDIT_AUDIT=1`, and waits for
`native-ui-outpatient-edit.json`. That probe runs the native
`outpatient.assign` and `outpatient.delete` store paths, verifies the
multi-detail outpatient session payload after assignment, then confirms the
backend state returns to zero outpatient sessions after deletion for
`block-outpatient-edit-2026`.

Then, the audit seeds `--profile inpatient-edit`, launches the Desktop app
on Inpatient with `SCHEDULER_INPATIENT_EDIT_AUDIT=1`, and waits for
`native-ui-inpatient-edit.json`. That probe runs the native
`inpatient.assign` and `inpatient.delete` store paths, verifies the manual
inpatient assignment payload after assignment, then confirms the backend state
returns to zero inpatient assignments after deletion for
`block-inpatient-edit-2026`.

Then, the audit seeds `--profile clinics-edit`, launches the Desktop app
on Clinics with `SCHEDULER_CLINICS_EDIT_AUDIT=1`, and waits for
`native-ui-clinics-edit.json`. That probe runs the native `clinic.assign` and
`clinic.delete` store paths, verifies the manual clinic placement payload after
assignment, then confirms the backend state returns to zero clinic assignments
after deletion for `block-clinics-edit-2027`.

Then, the audit seeds `--profile fellows-resolve`, launches the Desktop app
on Fellows with `SCHEDULER_FELLOWS_RESOLVE_AUDIT=1`, and waits for
`native-ui-fellows-resolve.json`. That probe runs the native `draft.generate`
store path until the draft report exposes a `fellow-blank-candidates` warning,
then runs the native `inpatient.fellow.resolve` path for the selected fellow,
verifies the Manual Fellow inpatient rows, confirms `/api/scheduler/state`
persists those assignments, and confirms the draft report is cleared after
successful resolution for `block-fellows-resolve-2027`.

Finally, the audit seeds `--profile settings-edit`, launches the Desktop app
on Settings with `SCHEDULER_SETTINGS_EDIT_AUDIT=1`, and waits for
`native-ui-settings-edit.json`. That probe runs the native Settings store paths
for `block.update`, `rules.patch`, `posterSettings.patch`, `attending.add`,
`attending.update`, `attending.remove`, `expectedSource.add`, and
`expectedSource.remove`, verifies block coverage/holiday/rules/poster/attending
and source fields, and confirms `/api/scheduler/state` persists the Settings
edits for `block-settings-edit-2027`.

The native probes are written by the SwiftUI app when its `NSWindow`, selected
screen, Planning Grid projection, Reports handoff workflow, and Dashboard draft
workflow, Planning Grid edit workflow, Sources import workflow, and Rotators
edit workflow, Outpatient edit workflow, Inpatient edit workflow, Clinics edit workflow, Fellows resolve workflow, and Settings edit workflow attach, so the audit still has
durable GUI evidence when Codex/macOS automation cannot see the display. It attempts a macOS screenshot as optional visual
evidence; sessions without Screen Recording or an available display record that
screenshot step as `SKIP` instead of weakening the process/window/runtime/grid
assertions.

Artifacts:

- `verification/results/native-ui-audit-*.md`
- `verification/results/native-ui-audit-*.json`
- `verification/results/native-ui-audit-data-*`
- optional `verification/results/native-ui-audit-*.png`

## Manual-only

These remain outside the automated verification runner because they require
human judgment or host/browser shell behavior:

- PDF visual fidelity after download
- operating-system print preview
- screen-reader walkthroughs
- OS-level file picker behavior
- subjective review of dense schedule readability at unusual zoom levels

## Not Applicable In Current Scheduler

The City-style examples in the philosophy document are useful categories, but
this scheduler currently has no database server, audit table, email server,
background queue, object storage, authentication/RBAC layer, or HTTPS reverse
proxy. Those surfaces are documented as not applicable rather than represented
by fake browser tests.

If any of those systems are added later, they must enter Layer B with a stable
test ID, a command-line probe, and a durable artifact.

## Command Sequence

`make verify-project` runs:

1. `npm run build`
2. `npm test`
3. `npm run test:offline`
4. `npm run test:py`
5. `npm run verify:cli -- --results-dir verification/results`
6. `npm run e2e:audit -- --results-dir verification/results`
7. `npm run e2e:native -- --results-dir verification/results`
8. `npm run package:native`

The final status is only PASS when every step exits 0.

`make verify-native`, `make verify-native-ui`, and `make package-native` remain
available for targeted reruns when the full project gate is more than you need.
