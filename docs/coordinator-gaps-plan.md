# Coordinator Gaps — Implementation Plan (for approval, nothing implemented)

Baseline: `main` @ `e60200d`, clean (two untracked docs: this plan + the brief). Deadline: P1+P2 merged and app rebuilt by **7/13 EOD** (Coordinator back 7/14–7/15). Port 6174: never kill without `lsof` first.

Authoritative brief: `docs/coordinator-gaps-meta-prompt.md`. This plan incorporates a second recon round (4 read-only scouts, 2026-07-10) that **changed one headline decision** (legacy grid: keep as `else`, do not delete) and **already resolved two of the three step-0 confirmations**.

---

## Step 0 — Runtime confirmations (status after recon)

| Item | Status | Finding |
|---|---|---|
| Build vintage | **RESOLVED** | Both bundles (`.build/app/PediatricScheduler.app`, `.build/native-release/…` v0.26.0) built 2026-07-07 08:31, ~5 min after the `e60200d` commit. Not stale. No copy in /Applications. **Unknown: which build Coordinator runs** — her copy comes from the release zip; confirm her version (v0.26.0) in Q&A or via About screen screenshot. The paint bug exists at e60200d regardless. |
| Casey Moore schoolType | **RESOLVED, with a twist** | Local state (`~/Library/Application Support/PediatricScheduler/scheduler-state.json`, mtime 7/06) has ALL four named rotators as `schoolType:"other"`, `program:"Other"`, `source:"Coordinator DOCX master schedule"`, no `rotationStartDate` key. `classify_rotator` = `schoolType or infer_school_type(program)` (draft.py:36–39), so locally NONE classify Methodist — **her warnings cannot reproduce on this machine's state**. Conclusion: Coordinator manually reclassified 3 rotators as Methodist on her machine (RotatorsView), and Casey as `ut-peds`/`ut-adult` (year-balance fires only for those, confirmed draft.py:1140–1141). The DOCX import hardcode is the upstream cause on both machines. |
| Double-grid visual | **REMAINS — do first in P1** | App not running (port 6174 idle, verified read-only). Launch `.build/app` copy against a **copied** data dir (`PEDI_SCHEDULER_DATA_DIR=<copy>`) — never against live state — and confirm: both grids render stacked; the 460pt-capped matrix sits above the unbounded legacy grid; clicks in the legacy grid apply one cell at a time. |

**New step-0 item:** obtain Coordinator's state file (or a Draft Report export) so P2 verification runs against her real data, not a reconstruction. Ask her to send `~/Library/Application Support/PediatricScheduler/scheduler-state.json`.

---

## P1 — Paint regression (target: 7/11–7/12, ship by 7/13)

### Root causes (verified)
- `workspace()` renders `PlanningMatrixView` inside `if let projection = activeProjection(block), !projection.dates.isEmpty {…}` (PlanningGridView.swift:253–297) then calls `grid(block:state:)` **unconditionally as a sibling** at line 299. Matrix is hard-capped `.frame(minHeight: 260, maxHeight: 460)` (line 1374); legacy grid's ScrollView is the pane's only greedy child → dominates visually.
- `@State private var paintOn = false` (line 26, transient); matrix `onPaintCell` assigns only `if paintOn` (275–285). Click-to-paint became opt-in at e60200d; toggle can wrap to a lower toolbar row (`FlexibleWrap`, InpatientView.swift:849).

### Decision: legacy grid becomes a true `else` — NOT deleted. Defense:
Recon overturned the "prefer deletion" presumption:
1. **Legacy is the sole renderer during real windows.** `activeProjection` returns nil on cold start, on every block switch, and after **every successful edit** — `applyCommand`/`runBatch` nil out `planningGrid` on success (AppStore.swift:120–121, 180–181), refresh is an async `Task`. Delete `grid()` and those windows render a blank pane.
2. **Legacy has capabilities the matrix lacks:** per-assignment delete (`PlanningChip` trash → `inpatient.delete`/`outpatient.delete`, lines 2563–2577 + 616–628 — the matrix has NO delete affordance at all), per-assignment chips with source dots, unmatched half-day facts row, Off-column chips.
3. **Layout breaks on deletion:** the outer `VStack` has no spacer/scroll wrapper; `grid()`'s ScrollView is the flexible filler. Removing it leaves dead space and no overflow container.

Deletion is deferred to a backlog item ("retire legacy grid") gated on: matrix gains per-assignment delete (context menu), a loading placeholder for nil-projection windows, and a scroll/height rework. ~514 lines deletable at that point (all legacy-only symbols confirmed single-referenced).

### Changes (all in `macos/PediatricScheduler/View/PlanningGridView.swift`)
1. **Line 299** → move `grid(block: block, state: state)` into the `else` of the projection `if`. Result: matrix when projection is live; legacy only during load/refresh windows (a brief flash after edits — same content the user sees today, minus the permanent double grid).
2. **Line 26** → `paintOn` default **true**, persisted via `@AppStorage("planningGridPaintOn")`. (No `@AppStorage` precedent in the codebase — all existing UserDefaults use is env-first audit probes; this is a deliberate new one-liner pattern, acknowledged.) Keep the `.onChange(of: paintOn)` in-flight-selection drop (51–57).

### Explicitly untouched
Sweep machinery (`canPaintSweep`/DragGesture 1707–1764, `extendPaintSweep`/`commitPaint` 656–709), `runBatch` one-undo contract, `PaintSelection.swift`, MethodistSetup panel, matrix height cap (raising it is follow-up polish, not P1 risk), the `planningGrid = nil` invalidation in AppStore (an alternative "keep stale projection during refresh" smoothing exists — one-line removal — but risks acting on stale dates mid-refresh; noted, not taken).

### Verification
1. `swift build` (compile gate) + `swift test` (runs `PaintSelectionTests` — note: XCTest target exists but is absent from every documented verify command; run it anyway).
2. `make native-app` against a **copied** data dir. Drive: Paint toggle visible and ON at launch; single click paints selected phase; drag-sweep paints a contiguous run; **⌘Z once reverts the whole stroke**; toggle off → click does nothing, sweep disabled; relaunch → toggle state persisted; block switch → brief legacy fallback then matrix; per-assignment delete (trash on chip) still reachable during fallback windows.
3. `lsof -i :6174` first; if idle, `npm run e2e:native` planning profiles (planning-grid, planning-edit-undo — T-SCH-NATIVE-003/004/005/006).

### Risk & rollback
Default-on paint → accidental single-click assigns (mitigated: one-undo, tinted toggle, `.help` text). Post-edit legacy flash is a visible behavior change — acceptable, and strictly better than the permanent double grid. Rollback: revert one commit (two small diffs, no engine changes, no vectors touched).

---

## P2 — Methodist start-date pipeline (target: 7/12–7/13)

### Root causes (verified, including against live local state)
- `apply_methodist_auto_assign` silently skips Methodist rotators with falsy `rotationStartDate` (draft.py:496–499); warning `methodist-no-start` fires at report time only (1005–1016).
- Every creation path leaves it empty: `make_rotator` never defaults it (rotators.py:106–121); **DOCX import hardcodes `program='Other'`, `schoolType='other'`** (coordinator_docx_import.py:719–735) — confirmed in live state: all 16 rotators from that source are `other`; roster import sets it only on exact alias match + methodist classification, silently otherwise (roster_import.py:572–578).
- Casey Moore = separate `year-balance` check (draft.py:1139–1165, `ut-peds`/`ut-adult` only). On her machine Casey must be classified ut-peds/ut-adult; the question is whether she should be Methodist (→ Q1 for Coordinator).

### Changes
1. **Import-time warnings (Python only, no parity surface):**
   - `roster_import.py`: when any row classifies `methodist` and no `rotationStartDate` column matched → import-result warning naming the rotators ("N Methodist rotators imported without a rotation start date — set them in Planning → Methodist Setup").
   - `coordinator_docx_import.py`: import summary line "N rotators imported unclassified (program 'Other') — classify Methodist/UT residents in Rotators to enable program rules." Do NOT guess classification from the DOCX; it carries no school info.
2. **Alias broadening**, `contracts/v1/roster-import-aliases.json` → `columnSynonyms.rotationStartDate`: add "rotation start", "rotation start date", "methodist rotation start date". Keep aliases specific (no bare "start date" — collides with segment columns). Aliases are single-sourced (contract JSON) — both engines read the same file; no mirror edit.
3. **Decision-gated (do NOT build until Coordinator answers Q2):** auto-derive `rotationStartDate` = rotator's first segment start when Methodist and unset. This is an engine *rule* change → must land in `shared/scheduler/program-rules.js` and `backend_py/domain/draft.py` in the same commit, with JS unit test + pytest mirror, and a note that no golden vector covers methodist (recon: `apply_methodist_auto_assign` and all of clinics.py are absent from `scripts/dump-golden.mjs`; parity for these is enforced by mirrored unit tests — T-SCH-CMD-006/008 — not vectors).
4. **Leave alone:** MethodistSetup panel, RotatorsView field, DraftReportPanel fix-it, Dashboard jump (all verified working); `methodistStartSide` auto-fill (commands.py:1198 already fills side once a start date exists).

### Files
`backend_py/roster_import.py`, `backend_py/coordinator_docx_import.py`, `contracts/v1/roster-import-aliases.json`, (+ `shared/scheduler/program-rules.js` + `draft.py` only if Q2 = yes). `COMMAND_INVENTORY.md`: no new commands unless Q2 lands (then note the changed `methodist.auto` semantics).

### Verification
1. `bash backend_py/run-tests.sh` (full pytest) incl. new tests: roster fixture with "Methodist Start" column → `rotationStartDate` set → `methodist.auto` populates 14/14 → `generate_draft` report has zero `methodist-no-start`; fixture without the column → import warning present. Extend `test_coordinator_docx_import.py` for the summary line.
2. `npm test` (Vitest — untouched JS must stay green) + `npm run test:offline`. `node scripts/dump-golden.mjs` only if Q2 rule lands (state which vectors changed in the commit message).
3. GUI drive: Sources → import fixture roster → warning visible; set start date via MethodistSetup → regenerate draft → warnings drop. Then re-run against **Coordinator's state copy** (step 0) — her three warnings must be reproducible before, gone after setting dates.
4. `make verify-project` as the pre-handoff gate for the combined P1+P2 build.

### Risk & rollback
Alias broadening could mis-bind a column (kept narrow; import warning makes any miss visible). Import-warning changes are additive; rollback = revert. Q2 auto-derive is the only behavior-change risk — that's why it's gated on her answer.

---

## P3 — Weekly Mon–Fri AM/PM clinic grid + rotator side-list (week of 7/14)

### Recon facts shaping the design
- `schedule()` (ClinicsView.swift:136–184) is a flat `ForEach(weekdayDates)` — regrouping is self-contained; `ClinicOccurrence` already carries `attendingName/clinicName/location/capacity/allowedRoles`; `sessionColumn` already stacks multiple cards per date+period. "Epilepsy Urgent (Fir)" / "Fir at International District" are pure string formatting of existing fields (location already rendered at 542–547).
- **Blocks are NOT Monday-aligned** (golden fixture `populated-state.json` starts Thursday 2026-01-01; `initial_state.py` uses `today`). Partial first/last weeks are first-class, not edge cases.
- **No week-bucketing helper exists anywhere** (repo-wide grep: zero `weekOfYear/startOfWeek/isocalendar` hits). Build one.
- `eligibleRotators(on:occurrence:state:)` (798–804) is a pure function of (date, occurrence, state), already date- AND occurrence-dependent (`roleAllowed` reads the cell's `allowedRoles`) — a side-list is the same call re-triggered `onChange` of selected cell. No backend change.
- Live local state: `clinicAssignments` = **0 entries**, 104 OutpatientSessions (only 4 placeholder "Outpatient (clinic TBD)" — most carry real clinic names like "Elm", "Epilepsy Urgent" as *sessions*, not assignments). The "No rotators" cards are fully explained; the side-list assign workflow is the fix, per the brief's placeholder constraint.

### Changes
1. **`CalendarUtil.swift`**: `weekBuckets(dates:) -> [[String]]` — chunk the weekend-filtered date list, new bucket at each Monday; first/last buckets may hold <5 days. Pure + unit-tested (XCTest), including a Thursday-start block.
2. **`ClinicsView.swift`**: new `ClinicsWeekGridView` — `Grid` rows = week × {AM, PM}, columns Mon–Fri; each cell stacks compact occurrence cards (reuse/trim `ClinicOccurrenceCard`); assigned rotator names comma-joined per card; **stop excluding** holiday/noClinic dates in grid mode — render them as dark cells ("No Clinic"/"Holiday"), reusing `PlanningMatrixCellView.backgroundColor` styling (PlanningGridView.swift:1943–1970); one color band per week (see UX #4). Surface the backend's `stale` flag on assignment chips (computed at clinics.py:206–238, currently ignored by Swift).
3. **View switcher**: segmented control "Week grid | List", **grid default**, list retained one release (see UX #3). Existing list path untouched.
4. **Rotator side-list**: trailing panel listing `eligibleRotators` names for the selected cell (or selected date when no cell chosen); click name → `clinic.assign` to the selected occurrence (existing command — `COMMAND_INVENTORY.md` gets an updated GUI-action row, no new command). Selection state + `syncSelections` (194–208) already drive the current picker; reuse.
5. **AX**: `clinics-week-grid`, `clinics-rotator-sidelist`, per-cell ids (`clinics-cell-<date>-<session>`), each container paired with `.accessibilityElement(children: .contain)`.

### Explicitly untouched
Placeholder-clinic semantics (draft pool stays disjoint; assignment via `clinic.assign` only — auto-attribution is Q4, not built); `expandClinicOccurrences` both ports; `OutpatientView.swift`; all engine code (P3 is Swift-only).

### Verification
`swift build` + XCTest for `weekBuckets`; run app on copied state: grid renders weeks × AM/PM × Mon–Fri; partial first week correct on a Thursday-start block (seed from `contracts/golden/populated-state.json`); holiday cells dark; select cell → side-list filters to eligible OP rotators; click name → chip appears in cell, ⌘Z removes; stale chip badge renders when a template is deleted post-assignment. `lsof` then `npm run e2e:native` clinics-edit profile (T-SCH-NATIVE-023) must still pass; add a `clinics-week-grid` e2e profile if time allows.

### Risk & rollback
Largest UI change; risk contained by the view switcher — rollback = flip default back to List (one line), grid code inert behind the toggle.

---

## P4 — Exports matching the grid (after P3)

### Recon facts
- `pdf_exports.py` writer is **text-only** — content streams emit only `BT/ET`, `Tf`, `Td`, `Tj`; zero rect (`re`), fill (`f`), or color (`rg`) operators exist. A colored weekly grid PDF means hand-writing those operators + column math from scratch — the largest single work item in this round.
- `word_exports.py` uses real **python-docx**; `Table Grid` tables already used 3×. Weekly grid table = easy; cell shading needs ~10 lines of raw OOXML (`w:shd` on `tcPr`) — new but small.
- All export paths already share one join: `clinic_assignment_rows` (pdf_exports.py:66,105; word_exports.py:49; exports.py:122; reports.py:290). **`location` is not threaded into the Python row dict** (Swift-only today) — add it once at the join, all consumers benefit. The JS mirror of `clinic_assignment_rows` (shared/scheduler) gets the same key + test in the same commit (mirrored-unit-test parity; not golden-vectored).

### Changes, in order
1. **Python `calendar_utils.py`**: `week_buckets` mirroring Swift (+ pytest, Thursday-start case).
2. **`clinic_assignment_rows`** (+ JS mirror): add `location`.
3. **Word first**: `_schedule_docx`/new `_outpatient_week_grid_docx` — rows = week × AM/PM, cols Mon–Fri, comma-joined rotators, week shading, dark No Clinic/Holiday cells. Matches her printable artifact fastest.
4. **PDF second**: extend the writer with `re`/`f`/`rg` helpers, then rebuild `_outpatient_poster_pdf` (102–120) as the grid. Keep the old flat poster emitted alongside for one release (cheap safety valve).
5. **CSV/JSON**: add `location` column only; shape otherwise unchanged.

### Verification
`bash backend_py/run-tests.sh` with new export unit tests (fixture state, assert docx table dimensions + PDF operator presence); `npm test` for the JS mirror; open generated .docx/.pdf and eyeball against Coordinator's July PDF; `make verify-project` before release.

### Risk & rollback
PDF writer work can slip without blocking anything — Word grid alone satisfies the printable need; ship Word, defer PDF if the week runs short. Rollback per format: keep legacy flat outputs alongside.

---

## UX decisions (recommend / alternative)

1. **Paint discoverability**: default ON + `@AppStorage` persistence. *Alt: keep off-default, show a one-time hint toast when a cell is clicked with paint off.*
2. **Methodist missing-date warning**: import-time warning AND existing report-time check. *Alt: report-time only (status quo, rejected — failure surfaces too late).*
3. **Weekly grid placement**: grid is the default Clinics view; List kept behind a segmented control for one release, then retired. *Alt: hard replace immediately (rejected — no rollback lever).*
4. **Week color bands**: 4-color repeating pastel cycle at low opacity (dark-mode aware, colorblind-safe — run the dataviz palette validator), mirroring her July PDF's banding. *Alt: single accent hue alternating intensity per week.*

## Questions for Coordinator (≤5, plain language)

1. Is Casey Moore a Methodist resident? Her warning is a different rule that only applies to UT residents — if she's Methodist we'll reclassify her and it goes away.
2. For Blair, Harper, and Gray: is the first day they appear on your schedule the day their Methodist 14-day clock starts? If yes, the app can fill the start date automatically.
3. Should the new weekly clinic grid fully replace the current day-by-day list, or keep both with a switch for a while?
4. When you assign someone to a specific clinic from the new side list, should that automatically replace their generic "Outpatient" slot for that half-day?
5. For printing: do you want the same week colors as your July PDF, and is a Word document okay first (PDF version follows)?

## Sequencing

| Date | Work |
|---|---|
| 7/10–7/11 | P1 step-0 visual confirm → P1 implement + verify |
| 7/12 | P2 implement + verify; request Coordinator's state file + send Q1–Q5 |
| 7/13 | `make verify-project`, package v0.27.0, deliver build to Coordinator |
| 7/14+ | P3 (grid + side-list), then P4 (Word → PDF), each behind its own commit + verify gate |

Backlog (out of scope this round): retire legacy `grid()` (~514 lines) once matrix gains per-assignment delete + loading state; raise/remove matrix 460pt cap; wire `swift test` into `verify-project`; smooth post-edit refresh by keeping stale projection.
