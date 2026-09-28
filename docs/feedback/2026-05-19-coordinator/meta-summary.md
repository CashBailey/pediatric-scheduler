# Multi-team Run — Coordinator feedback features #2-#6

Implements Coordinator's 5 outstanding feature requests from her 2026-05-19
iMessage screenshots, dispatched as 4 parallel sub-teams (requests #4 and
#5 merged into ST-C since both are fields on the same profile form).

## Tasks and sub-teams

- **sub-team-a** — Source viewer (request #2) — `/tmp/team-multi-qxrkVsvL/sub-team-a/deliverable.md` — commit `e6241cf`
- **sub-team-b** — Excel ingest → auto-create rotator profiles (request #3) — `/tmp/team-multi-qxrkVsvL/sub-team-b/deliverable.md` — commit `37186ec` (also absorbed ST-D's parser/wiring due to shared worktree)
- **sub-team-c** — Profile day-off + unavailable date range (requests #4 + #5) — `/tmp/team-multi-qxrkVsvL/sub-team-c/deliverable.md` — commit `f4a7023` (on isolated branch `sub-team-c-availability`, merged as `621ea2e`)
- **sub-team-d** — Inpatient Calendar AM/PM continuity-clinic display (request #6) — `/tmp/team-multi-qxrkVsvL/sub-team-d/deliverable.md` — commits `37186ec` (core) + `6f5174f` (tests + CSS)

## Per-sub-team summaries

### sub-team-a
Click-to-open modal viewer for the Reviewed Sources table. Extended source records with `content: string` (raw text) and `parsedRows: Array<object>` (structured rows). Viewer prefers `parsedRows` (table view) over `content` (text view), with plain-English empty state for legacy records. Centered modal chosen over inline expansion to avoid table reflow. Open risk: if user uploads `.xlsx` through the generic picker instead of ST-B's import path, the FileReader renders garbled text — should be tested manually.

### sub-team-b
New `src/excelImport.js` parser using bundled SheetJS, fully client-side (no offline-contract violation). Confirmation modal previews parsed rows and offers three explicit merge choices: merge by name (default, stable ids), replace all, add as new. Downloadable blank-template button surfaces the expected column layout; column matching is loose with synonyms. Populates the exact rotator field names ST-C added (`dayOff`, `unavailableRanges`) when present. `continuityClinic` preserved. 14/14 vitest, 4/4 offline, clean build.

### sub-team-c
Added `dayOff: string[]` and `unavailableRanges: [{start,end}]` to `makeRotator()` with empty-array defaults so older saved states load unchanged. RosterPage gained per-rotator `AvailabilityEditor` (Sun–Sat checkboxes + stackable date-range pickers). `detectConflicts` emits new `rotator-unavailable` Critical conflict for assignments on a day-off weekday or inside an unavailable range; rendered automatically by the existing Conflicts page. Built in isolated git worktree to avoid contamination — smart move under the dispatch race. Exported `isRotatorUnavailable`, `weekdayName`, `WEEKDAYS`, `updateRotator` helpers.

### sub-team-d
Inpatient Calendar shows small "AM clinic" / "PM clinic" labeled pills at the bottom of any day cell where a rotator's continuity-clinic commitment matches that weekday. Pills carry native tooltips listing affected provider names so the cell stays uncluttered when multiple providers share a clinic. New exported helpers in `src/scheduler.js`: `parseContinuityClinic(str)`, `continuityClinicsForDate(state, date)`. New reusable `renderBadges` prop on `CalendarGrid`. CSS classes `.clinic-strip`, `.clinic-chip`, `.clinic-chip-am`, `.clinic-chip-pm`. Visual choice: muted amber/indigo labeled pills (not unlabeled stripes) so users don't have to remember a color legend; 1-CSS-block change to quieten further if Coordinator wants.

## Cross-team findings

- **Field-name alignment came out clean.** Pre-brokering the rotator schema upfront (Meta-Lead Phase 0) paid off: ST-B's Excel populates exactly the `dayOff` / `unavailableRanges` field names ST-C added, and ST-A's source viewer expects exactly the `parsedRows` field name ST-B writes. No re-brokering required.
- **Sub-team-c built in an isolated worktree on its own initiative** — caught the dispatch mistake (no `isolation: "worktree"` parameter passed by Meta-Lead) and routed around it. The other three sub-teams shared the working tree; ST-A and ST-B's commits sequenced cleanly into main, ST-D's parser/wiring inadvertently rode in ST-B's commit (functionality intact, attribution split). Lesson: ALWAYS pass `isolation: "worktree"` when dispatching parallel code-mutating Agents (recorded in `~/mempalace-checkpoints/2026-05-20-multi-team-dispatch/decisions/worktree-isolation-mistake.md`).
- **Reusable helpers worth knowing about across teams** (none missed integration, but flagged for future work):
  - `parseContinuityClinic(str)` and `continuityClinicsForDate(state, date)` from ST-D — could feed into ST-C's conflict detection (inpatient assigned during own continuity clinic) and into the Daily Report
  - `isRotatorUnavailable(rotator, dateStr)` from ST-C — could let ST-D dim calendar cells when a rotator is fully out
  - `CalendarGrid` now accepts an optional `renderBadges(date)` prop — reusable for holidays, conflict counts, any per-day overlay
- **One UX seam likely worth a small follow-up:** Sources tab now has both ST-A's generic file picker (any file → viewer) and ST-B's Excel import button (xlsx → profile creation). Both work, but two upload paths on one page may confuse users. Worth a tiny consolidation pass.

## Unresolved

- **Visual verify on the live UI not yet done.** Tests assert structure; they don't assert "this looks good to a physician." Recommend `npm run dev` walkthrough before declaring the features shipped to Coordinator.
- **Outpatient sessions are not yet flagged for `rotator-unavailable` conflicts** — ST-C explicitly noted this as out-of-scope; only inpatient assignments are checked. Worth deciding.
- **Build now warns about chunk size >500 kB** — caused by SheetJS bundle. Acceptable trade for the feature; can be addressed with dynamic import later if startup time becomes an issue.
- **Customer Docker bundle (`release/CoordinatorPediSchedulerReact/`) is stale** — still represents the pre-feature build. Needs regeneration before sending an updated build to Coordinator.

## Final repo state

```
main:
  621ea2e (HEAD) Merge sub-team-c — roster: add day off and time-off ranges per rotator
  6f5174f         inpatient: surface AM/PM continuity clinic on calendar cells (ST-D tests+CSS)
  37186ec         sources: auto-create rotator profiles from uploaded Excel roster (ST-B + ST-D core)
  e6241cf         sources: open uploaded files to preview their contents (ST-A)
  c751bf0         ui: replace dev-jargon with plain-English labels (prior session)
  cd1b5f3         Initial commit: cleaned React project layout

verification:  16/16 vitest, 4/4 offline, clean build
```
