# GOAL: Produce the "Coordinator gaps" implementation plan for the Pediatric Scheduler

**First action: Read `<repo-root>/docs/coordinator-gaps-meta-prompt.md` in full — it is the authoritative brief (verbatim feedback, verified file:line root causes, constraints, required plan shape). Everything below is a summary; the file wins on any conflict.**

Repo: `<repo-root>` — SwiftUI Mac app (`macos/PediatricScheduler`) + Python engine (`backend_py/domain`), one `/command` endpoint. App owns port 6174 — never kill anything on that port without `lsof` first. Clean at `e60200d` on `main`. Coordinator (physician end user) returns 7/14–7/15; bug fixes (P1, P2) must be planned to land before then.

Three gaps (full detail + anchors in the file):

1. **Paint gone** — legacy `grid()` renders as an unconditional sibling after the paint matrix (PlanningGridView.swift:299, missing `else`); legacy grid unbounded height dominates the capped matrix; `paintOn` defaults false since e60200d.
2. **Methodist warnings** — 14/14 generator silently skips rotators with falsy `rotationStartDate` (draft.py:496–499); every import path fails to supply it (DOCX import hardcodes schoolType='other'; roster import silent when header missing). Casey Moore warning is a separate `year-balance` check (ut-peds/ut-adult only) → likely misclassification, don't conflate.
3. **Every clinic card "No rotators"** — auto-draft writes placeholder OutpatientSessions ("Outpatient (clinic TBD)"), cards read only manual `clinicAssignments`; two disjoint pools. Coordinator wants a weekly Mon–Fri AM/PM grid (rows = week × AM/PM), per-clinic cells, dark No Clinic/Holiday cells, plus a rotator-name side-list with click-to-assign. Exports (pdf/word/csv) must follow the grid.

The goal is met when a complete plan document exists containing:

1. Phases P1 paint → P2 methodist pipeline → P3 weekly grid + side-list → P4 exports; P1+P2 sized to land pre-7/14.
2. Per phase: files to touch (line-anchored per the brief), the minimal change (prefer deletion — defend legacy-grid removal vs true-`else` fallback), and what explicitly stays untouched.
3. Per phase: verification steps — build and run the actual app and drive the flow (paint a sweep + single undo; roster import with Methodist Start column; draft warnings drop; assign from side-list), plus golden-vector parity for any engine change (JS mirror `shared/scheduler/*.js`; if a rule intentionally changes, update vectors in the same commit and say so).
4. Step 0 runtime confirmations (cheap, can invalidate P1/P2 assumptions): visual confirm of double-grid rendering; confirm user's installed build isn't older than e60200d; check Casey Moore's actual schoolType.
5. UX decisions surfaced, not buried — one recommendation each, alternative in one line: paint persistence/default-on/hint-when-off, import-time vs report-time warning, grid replaces vs sits beside current list, week color-band palette.
6. Risks & rollback per phase; ≤5 open questions for Coordinator phrased for a non-engineer.

Constraints (full list in brief): golden-vector parity with JS mirror; keep COMMAND_INVENTORY.md current for new/changed commands; one undo per paint gesture via `runBatch`; new interactive controls need accessibilityIdentifiers (container ids cascade — pair with `.accessibilityElement(children: .contain)`); placeholder-clinic semantics are intentional — gap-3 fix is an assignment workflow, not auto-attribution of placeholder sessions to clinics (flag as a decision point if evidence says Coordinator expects auto-attribution).

Do NOT implement anything. Produce the plan for approval first.
