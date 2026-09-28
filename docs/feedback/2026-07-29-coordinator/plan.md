# Coordinator 2026-07-29 Feedback — Implementation Plan

Sources: iMessage thread (9:30–10:48 AM), `Scheduler_Fix_List_2026-07-29.docx` (her 9-item list), same-day phone call (zoom, blink diagnosis, weekend-off rule, AM/PM marker spec).
Verified against HEAD `9690a48` (0.28.0, clean tree) by a 7-agent code investigation on 2026-07-29. Every claim below carries file:line evidence from that pass.

**Keep untouched (her words):** planning-grid density concept and the draft generator — "A LOT better." Everything here finishes, not replaces.

**Acceptance test:** Coordinator rebuilds September (2026-08-28 → 09-24) from scratch and compares to her hand-made schedule. August fellow pattern for reference: 14-day stints, mid-block handoff, Eden → Samantha → Eden.

---

## Cross-cutting invariant

`propose_schedule` / `generate_draft` / `apply_range_assignment` are golden-vectored: Python parity tests compare against `contracts/golden/*.json` dumped from the JS engine. **Any engine-rule change must land in `shared/scheduler/scheduler.js` AND `backend_py/domain/*.py` in the same commit, then regenerate vectors** (`node scripts/dump-golden.mjs`, aliases/contracts via `scripts/freeze-contracts.mjs`). Phases below mark which changes are dual-engine.

---

## Phase 1 — Kill the blink / blank grid / lying Draft Report (Swift + py, small diffs, unblocks testing everything else)

Root causes (all confirmed):

1. **Blink**: `AppStore.run()` line 121 and `runBatch()` lines 172/181 do `planningGrid = nil` on every successful mutation → `PlanningGridView` falls back to the structurally different legacy per-day grid until `grid.show` returns, then swaps back. That view-type flip is the blink; `loadPlanningGrid` (532-567) already swaps atomically and keeps stale grid on failure.
   - **Fix**: delete the three eager `planningGrid = nil` statements. Old grid stays visible through the ~<100ms round trip.
2. **Blank until master refresh**: when the typed `SchedulerState` decode fails (`stateDecodeFailed`, a documented condition — APIClient.swift 298-325), `state` never changes, so the grid's only refresh trigger `.onChange(of: projectionRefreshKey(state))` (PlanningGridView.swift:58) never fires.
   - **Fix**: add `@Published mutationTick` to AppStore, increment where `result.ok && result.changed`; grid refreshes `.onChange(of: store.mutationTick)`; delete `projectionRefreshKey`.
3. **"Filled 0 cells" report**: `generate_draft()` baselines its report counts against the *already-preassigned* state (`commands.py:648` calls `apply_preassignments` one line before; `draft.py:1255-1256` counts from that). Top-level `data.inpatientAdded/outpatientAdded` (commands.py:645-652) are computed correctly against the original state — but Swift's `DraftReportSummary` reads only nested `report.summary.*`. Reproduced: true 4 IP / 7 OP → report 0/0.
   - **Fix**: `generate_draft(state, block, baseline_state=None)`; `_cmd_inpatient_draft` passes the original state; the duplicate top-level diff then reads from `report.summary`. No Swift change.

Tests: add `report.summary.inpatientAdded == 4 / outpatientAdded == 7` asserts to `test_draft_command_applies_segment_preassignments`; manual — paint sweep + Generate with no blink, no manual refresh.

## Phase 2 — Paint: honest results + repaintable assigned days (dual-engine)

Confirmed chain: `_compute_range_plan` (assignments.py:46-53) skips any date where `is_rotator_unavailable` (dayOff/unavailableRanges from the rotator profile) — *before* the (correct) IP/OP mutual-exclusion strip at 75-84. Empty `applyDates` → `apply_range_assignment` returns the same state identity (line 65). Meanwhile the grid still renders existing IP records on unavailable days as normal paintable cells (planning.py:65), commands.py:757 returns a canned "Assigned…" success message without consulting the `changed` flag `_ok` computes (commands.py:92), `runBatch` discards its own `anyChanged` (AppStore.swift:168), and `commitPaint` unconditionally sets "Painted N days" (PlanningGridView.swift:704). Four layers each report success on a no-op. The browser app checks `result.next === state` and says "No changes" (App.jsx:2770); native never ported that.

Fixes (land together):
1. `assignments.py` `_compute_range_plan` + `scheduler.js` `computeRangePlan`: skip an unavailable date **only when it has no existing IP/OP record for that rotator** — visible-implies-paintable, matches the JS docstring's own stated intent (scheduler.js:3341). Brand-new assignments on genuinely unavailable days stay blocked.
2. `commands.py` `_cmd_assign_range`: when `next_state is state`, return the honest "No changes — no applicable days" message.
3. `AppStore.runBatch` returns `(ok, changed)`; `commitPaint` only claims "Painted N days" when changed (else shows backend message). Update the one other caller (PlanningEditProbe ~PlanningGridView.swift:903).

Regen golden vectors (`range-assignment.json` at minimum). Deferred (separate task, net-new UI): porting the browser's `assessRangeAssignment` warn-and-allow "!" override popup to native.

## Phase 3 — Generator rules (dual-engine except c)

1. **Outpatient designation ignored (Chandler)**: `_eligible_for` (draft.py:504-519) checks only `get_rotator_phase` — a Methodist-only concept, returns None otherwise — and never `get_rotator_segment_phase`. The OP-fill side already checks both (958-959); the IP side just never got the check. Same gap in JS `eligibleFor` (scheduler.js:2012). Reproduced live: explicit `segment.defaultPhase='outpatient'` rotator drafted IP all 7 days.
   - **Fix**: add `get_rotator_segment_phase(rotator, date) != "outpatient"` to both engines' eligibility filters.
2. **No inpatient days off**: no code path enforces it — documented "Partial" in `docs/feedback/2026-05-29-coordinator/fix-map.md:144` (rule 9). Reproduced: 2-rotator weekend block → both worked all 7 days.
   - **Fix (scoped to her ask — one day off per weekend)**: new guard in `validate_drop` (draft.py:218-249) + `validateDrop` (scheduler.js:1568): reject placing a rotator on Sat when they already work the paired Sun and vice versa. Single choke point covers auto-fill, backfill, seeding, and manual drops. Note: also blocks *manual* both-weekend-days placement — intended (rule is a rule) but flag to Coordinator. Fuller rule 9 (fellow weekend priority, Fri/Mon fallback) stays a separate tracked feature.
3. **Methodist half-and-half "weird stuff"**: derived-start rotators (no explicit `rotationStartDate`; the 2026-07-10 first-scheduled-day rule) never get `methodistStartSide` chosen — `generate_draft`'s gate (draft.py:1265) still requires `rotator.get("rotationStartDate")`; commit 061b2d5 updated every other gate *and the JS twin* (program-rules.js:156) but missed this line. Confirmed live: side stays None → outpatient-first default overrides the correct in-block-coverage choice.
   - **Fix (py-only one-liner)**: gate on `methodist_rotation_window(rotator)` truthiness.

Regen goldens after 1+2; add mirrored unit tests (`test_draft_rules.py`, `scheduler.test.js`, `program-rules.test.js`) incl. a new derived-start/partial-overlap case.

## Phase 4 — Planning grid structure: one stable list + true filter tabs (Swift-only)

Confirmed: backend buckets every row into 5 mutually exclusive sections (planning.py:116-157, priority needs > mixed > fullyIp > fullyOp > unavailable); Swift renders one collapsible section per bucket (PlanningGridView.swift:1453, titles 1676-1686). Rows jump sections as their mix changes. "Not in block" = the `unavailable` bucket; it re-expands because `scrollToFocus` force-uncollapses whichever section holds the focused rotator (1536), and `scheduleFocus` is set from 7 other screens. Bonus confirmed bug: IP/OP tabs show `["mixed","fullyIp"]`/`["mixed","fullyOp"]` (999) but any row with an open day classifies as `needs` — **invisible on both tabs** despite having IP/OP days.

The flat unsectioned `projection.rows` array already ships with per-day cell statuses (AppStore.swift:963; planning.py:86) — everything needed client-side. **No backend changes.**

- `PlanningDisplayMode`: replace `projectionSectionIds` with a per-row predicate (`inpatient` ⇒ any cell `inpatient`/`both`; `outpatient` ⇒ any `outpatient`/`both`; master ⇒ all). Mixed appears in both — exactly her ask.
- Replace bucket ForEach with one flat filtered list, alphabetical, `.filter { $0.cells.contains { $0.status != "absent" } }` — "Not in block" rows gone from all tabs.
- `scrollToFocus` trims to staff-section-only auto-open; delete `sectionId(containing:)`, trim `PlanningMatrixSectionHeader`/`PlanningMatrixEmptyRow`.
- Leave `planning.py` sections + stat-chip bar + probes untouched (chip counts stay informational).

Open question for Coordinator: OK that not-in-block rotators are unreachable from the grid entirely (vs. a permanently-collapsed stub)? Plan assumes fully hidden per her literal ask.

## Phase 5 — Fellow pipeline (backend + Swift + contracts)

Confirmed: `PROGRAMS` has no fellow value and exists as **5 independent literal copies** (scheduler.js:55, roster_import.py:26, initial_state.py:34, coordinator_docx_import.py:57, RotatorsView.swift:887) + aliases mapping every pedi-neuro spelling to plain "UT Pediatrics" (roster-import-aliases.json:117-120). Fellow role is a fragile heuristic: `\bfellows?\b` does **not** match "Fellowship"; `^PGY-5$` doesn't match "PGY05". Two currently-passing tests literally assert the wrong label (test_state_routes.py:837, ~880). Sources page has no program picker at all; FellowsView's Import button is a bare tab-switch. Manual path dead too: role only recomputes when *Level* changes (RotatorDraft.patch:1007); no `originalProgram` tracked.

Steps (order matters):
1. Add `"UT Pediatric Neurology Fellow"` to all 5 PROGRAMS copies (canonical: scheduler.js first, then freeze-contracts regen).
2. `make_rotator` (rotators.py:164, the single creation choke point): `role = Fellow` when program is the new value; `infer_school_type` (draft.py:26) + Swift `inferredSchoolType` get `"ut-peds"` entries. `is_fellow_rotator` + Swift mirror already match any 'pedi' substring — no change.
3. RotatorsView edit flow: track `originalProgram`, recompute role on program change, extend `inferredRole`.
4. `_apply_role_signals` (roster_import.py:904): when it concludes Fellow and program is ambiguous (empty/Other/UT Pediatrics), rewrite program to the new value + recompute schoolType; widen regex `\bfellows?\b|\bfellowship\b`.
5. Aliases: add fellow-flavored entries → new value, via `excel-import.js` then freeze (aliases are frozen from JS — never hand-edit the contract JSON).
6. Fellows as expected source: falls out of step 1 via `initial_state.py` `expectedSourcePrograms`; existing state self-serves via Settings' `source.expected.add`.
7. Retroactive relabel: extend `normalize_pediatric_fellow_roles` (rotators.py:93, runs on every load/write) to rewrite program for existing fellows. Idempotent.

Ripple: regenerate `initial-state.json` fixture + every golden embedding `expectedSourcePrograms` (freeze-contracts, not hand-patch). Update the two tests asserting the old label; add "Fellowship"-wording regression test.

## Phase 6 — Grid extras: peek, AM/PM badge, zoom

**Peek (diagnose first — projection is NOT the bug).** Investigation reproduced her exact scenario against live `_cmd_grid_show`: date-keyed lookups return absent/unassigned in the peek window, never shifted copies. State is one global document (no per-block sharding), so prior-block data is always loaded. Two real actions:
1. **Diagnostic**: grep her actual `state.json` for Jared McAda / Megan Samuels rows dated 08-14..08-27 — if duplicates exist, the bug is an upstream *write* (suspects: assign.range, draft generate, roster import merge), and that's what gets fixed.
2. **Real defect found**: `activeProjection` (PlanningGridView.swift:365) checks only `blockId`, not peek flags — a grid fetched under a different peek config renders mid-toggle. Store peek flags on `PlanningGridProjection`, require match.

**AM/PM continuity badge.** Backend already serializes `continuityClinic` on every grid row (planning.py:86); Swift's `PlanningGridRotator` just drops it in decode (AppStore.swift:1039-1064). Old spec intact at App.jsx:3452-3658 + styles.css:2530 (bottom-left, 8px bold, "C" when both periods). Port `continuity_periods_for_weekday` (draft.py:70-119) into `CalendarUtil.continuityPeriods(_:onWeekday:)` — grammar-parity with backend tokenizer, parity unit test — decode the field, overlay badge in `PlanningMatrixCellView` regardless of cell status.

**Zoom.** Cell height is a hardcoded 42pt constant (PlanningMatrixLayout:1202); width auto-fits with a 24-66 clamp; totals footer already exists (2205) — it just scrolls away, so this is purely density. Add `cellHeight` to `PlanningMatrixMetrics` + `zoom` param (~8 mechanical call-site swaps, metrics already threaded everywhere); `@AppStorage("planningGridZoom")` clamped ~0.55...1.4; Option+scroll via `NSEvent.addLocalMonitorForEvents(.scrollWheel)` installed onAppear/removed onDisappear (consume the event when modifier held). Keep an absolute cellWidth floor — `sweepDates` divides by cellWidth and must not misresolve paint sweeps at min zoom.

## Phase 7 — Exports: her three July documents, docx + pdf

Confirmed: current exports (4 generic files each side) match nothing in her format; but `coordinator_docx_import.py` already parses the exact target structure — starred fellows (`STAR='★'`, :223), per-cell IP/OP/OFF + AM/PM (parse_master_cell:280), literal "Inpatient coverage"/"Outpatient coverage" bottom rows (:340), month-calendar inpatient (:505), AM/PM weekly outpatient with attending parsing (:666). `service_type_for_rotator_date` (clinics.py:415) already computes exactly the per-cell status needed; `week_buckets` (calendar_utils.py:109) serves both Mon–Fri outpatient and Sun–Sat month grids.

Build:
1. Shared master-grid model builder (new `coordinator_exports.py` or extended `exports.py`): rows = fellows-first-then-alphabetical (`is_fellow_rotator`), cells from `service_type_for_rotator_date`, AM/PM from `halfDayFacts` **with fallback** to `continuity_periods_for_weekday` (halfDayFacts is `[]` for natively-built blocks — initial_state.py:85), coverage rows mirroring the importer's count logic.
2. Word: `_coordinator_master_docx` (landscape via `WD_ORIENT` — vendored python-docx has it; nothing sets orientation today), `_coordinator_inpatient_docx` (week_buckets over full range incl. weekends), `_coordinator_outpatient_docx` (reuse `build_week_grid` + `week_grid_card_text`, switch to `add_run(bold:)` for attendings; "No Clinic" text already round-trips the importer).
3. PDF: extend the dependency-free writer (pdf_exports.py) — landscape = swapped page dims, second built-in font `/F2 Helvetica-Bold` for attendings (watch object numbering at :250).
4. Command `export.coordinatorBundle` returning 6 `{name,mimeType,base64}` files, registered beside `export.pdfs`/`export.word` (commands.py:1261).
5. Swift: `AppStore.exportCoordinatorBundle()` mirroring `exportWordDocs()`; one Download button in ReportsView's finalize panel, gated by existing `canBuildFinalPacket` (Final status = "finished"). Reuses `writeBase64Exports` folder plumbing wholesale.

Strongest test available: round-trip — generate the trio, feed it to `parse_coordinator_docx_bundle`, assert zero count/coverage mismatches. Plus landscape MediaBox smoke check.

Open questions for Coordinator: (a) tie-break for a both-IP-and-OP day in the single-status Master cell (plan: IP wins, matches her format's assumption); (b) is per-*active*-finished-block enough, or does she need downloads for older blocks (needs a new blocks-list screen + blockRef param — scope change)?

---

## Order & rationale

| # | Phase | Size | Why here |
|---|-------|------|----------|
| 1 | Render/refresh + report | S | Makes every later fix visually verifiable; 3 root causes, tiny diffs |
| 2 | Paint honesty + gate | M | Her most-hit daily friction; dual-engine + goldens |
| 3 | Generator rules | M | Needed before her from-scratch September test; dual-engine + goldens |
| 4 | Grid structure | M | Swift-only, independent; big daily-use win |
| 5 | Fellow pipeline | M/L | Contracts + fixture regen ripple; 7 ordered steps |
| 6 | Peek/badge/zoom | M | Peek needs the data diagnostic before code; badge+zoom independent |
| 7 | Exports | L | Largest net-new; depends on Phase 6's continuity helper for AM/PM fallback parity |

Phases 1→3 land first as one release ("engine correctness"), 4→6 second ("grid UX"), 7 third ("final documents"). Each phase: run `pytest backend_py` + `node --test shared/scheduler` + verify-project; goldens regenerated in the same commit as any dual-engine change.

## Standing open questions (ask Coordinator, don't block Phases 1–3)

1. "Not in block" rotators fully hidden from the grid, or reachable stub?
2. Weekend day-off guard also blocks *manual* Sat+Sun placement — intended?
3. Master export cell tie-break when a day is both IP and OP (plan: IP wins).
4. Export download for older finished blocks, or active block only?
