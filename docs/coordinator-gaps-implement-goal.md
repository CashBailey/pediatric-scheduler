# GOAL: Implement the approved "Coordinator gaps" plan for the Pediatric Scheduler

**First action: Read `<repo-root>/docs/coordinator-gaps-plan.md` in full — the approved plan (root causes, file:line anchors, per-phase changes, verification, risks). Also read `docs/coordinator-gaps-meta-prompt.md` for constraints. The plan wins on any conflict with this summary.**

Repo: `<repo-root>`, `main` @ `e60200d`. SwiftUI Mac app (`macos/PediatricScheduler`) + Python engine (`backend_py/domain`). **App owns port 6174 — never kill anything on that port without `lsof` first.** Never run against live state — copy `~/Library/Application Support/PediatricScheduler/scheduler-state.json` elsewhere and point `PEDI_SCHEDULER_DATA_DIR` at the copy. Deadline: P1+P2 verified and packaged for Coordinator by 7/13 EOD.

Execute phases in order, commit per phase, each gated on its plan-specified verification before the next:

**Step 0** — launch `.build/app` bundle on copied state; confirm double-grid rendering.

**P1 Paint** (PlanningGridView.swift only): move `grid(block:state:)` at line 299 into `else` of the projection `if` (253–297). Legacy grid stays — sole renderer during nil-projection windows, only per-assignment delete; do NOT delete. `paintOn` (line 26) → default true via `@AppStorage("planningGridPaintOn")`; keep `.onChange` selection-drop. Verify per plan: `swift build`, `swift test`, drive app (paint on at launch, sweep paints, one ⌘Z per stroke, toggle persists, block-switch fallback), then e2e planning profiles (`lsof` first).

**P2 Methodist**: import-time warnings in roster_import.py (methodist rows lacking rotationStartDate column → named warning) and coordinator_docx_import.py (N imported unclassified). Broaden `contracts/v1/roster-import-aliases.json` rotationStartDate aliases: add "rotation start", "rotation start date", "methodist rotation start date" — nothing generic. Do NOT build rotationStartDate auto-derive (gated on Coordinator's Q2). MethodistSetup/RotatorsView/fix-it paths untouched. Verify: `bash backend_py/run-tests.sh` incl. new tests, `npm test`, `npm run test:offline`, goldens untouched. Then `make verify-project` + package build for Coordinator.

**P3 Weekly grid + side-list** (Swift only): `CalendarUtil.weekBuckets(dates:)` chunking on Monday boundaries, partial weeks first-class (blocks NOT Monday-aligned — test Thursday-start via contracts/golden/populated-state.json) + XCTest. New `ClinicsWeekGridView` in ClinicsView.swift: rows = week × {AM,PM}, cols Mon–Fri, compact occurrence cards, comma-joined rotator names, holiday/noClinic as dark cells (stop excluding in grid mode), pastel band per week, surface backend `stale` flag. Segmented "Week grid | List", grid default, list kept. Side-list: `eligibleRotators(on:occurrence:state:)` for selected cell; click name → `clinic.assign`. AX ids (`clinics-week-grid`, `clinics-rotator-sidelist`, `clinics-cell-<date>-<session>`) each paired with `.accessibilityElement(children: .contain)`. Placeholder-clinic semantics untouched. Update COMMAND_INVENTORY.md. Verify per plan incl. e2e clinics-edit.

**P4 Exports**: python `calendar_utils.week_buckets` (+ pytest); add `location` to `clinic_assignment_rows` AND its JS mirror, tests, same commit; Word weekly-grid table first (python-docx + OOXML `w:shd` shading); PDF grid second (add `re`/`f`/`rg` operators to the hand-rolled writer, rebuild `_outpatient_poster_pdf`, keep flat poster alongside); CSV adds `location` only. Verify: pytest, `npm test`, open generated files, `make verify-project`.

Constraints: engine changes mirror `shared/scheduler` JS with tests in same commit; one undo per paint gesture via `runBatch`; use the plan's recommended UX options; commit messages state any intentional rule/vector change.

Goal met when: P1–P4 committed, each phase's verification executed and passing, `make verify-project` green, and a per-phase summary of what shipped + evidence is reported.
