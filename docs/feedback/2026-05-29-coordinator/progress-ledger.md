# Coordinator 2026-05-29 fix-map — progress ledger

Source of truth: [`fix-map.md`](./fix-map.md). Execution loop: [`meta-prompt.md`](./meta-prompt.md).
Working branch: `coordinator-fixes-2026-05-29`. Updated every iteration of the loop.

`Status ∈ {todo, in-progress, passed, parked}`. A `parked` row must name its blocker.

| ID | Tier | Status | Screenshot | What the screenshot showed | Tests | Blocker |
|----|------|--------|------------|----------------------------|-------|---------|
| B1 | P0 | passed | `coordinator-fixes/B1/after-{sidebar,sources-page}.png` | Sources is a top-level sidebar item right after Rotators; clicking it opens the Source Intake / import page. Seed hydrated (5 rotators, block May 4–31) | `scheduler.test.js` PAGES list + `app-navigation.test.js` 12-dest sentinel | — |
| B2 | P0 | passed | `coordinator-fixes/B2/after-dashboard.png` | "How scheduling works" panel at top of Dashboard with the 4-step narrative (import → days off → generate draft → review/finalize); step-1 "Sources" link navigates to the Sources page | covered by `app-navigation.test.js` Dashboard sentinel (renders without crash) | — |
| A1 | P1 | parked (plan surfaced) | `A1-scheduler-plan.md` | n/a — planning deliverable | n/a | Plan WRITTEN + surfaced for async review. Code blocked on **D3** (auto-vs-assist, gates `generateDraft` wiring) + **D2** (Methodist start side). Steps 1–2 unit-testable pre-D3 |
| A2 | P1 | parked | `coordinator-fixes/A2/seeded-op-schedule.png` | Seeded OP schedule shows **no "unresolved"** — uses "[uncovered]" / "Clinics with no rotator". Premise = stale data; candidate display is SPEC rule 2 inside the fellow program rule | n/a | **A1** (fellow program rule must exist to emit candidates) + **D4** (pick gesture) |
| A3 | P1 | passed (slice) | `coordinator-fixes/A3/weekend-op-conflict.png` | Conflict Review report surfaces the new "weekend clinic" violation (Noah, Sat OP) from a seeded weekend session, alongside existing checks | `scheduler.test.js` "A3/rule 8: flags … weekend, not a weekday" | Slice shipped (rule 8 weekend-OP; double-book already existed). Algorithm-coupled checks (Methodist≠14/14, fellow+2 staffing, 5-wk sandwich, year imbalance) deferred with full report behind **A1** |
| C1 | P2 | passed (latent fix) | `coordinator-fixes/C1/{before-phantom,after-fixed}.png` | BEFORE: Methodist-OP placeholder → 1 phantom "Methodist Outpatient" clinic card + empty white-bar attending. AFTER: 0 phantom cards, 12 real clinic boxes intact (DOM-verified) | `service-clinic.test.js` "C1: does NOT synthesize a phantom…" | **D1** parked — label *design* (show real clinic+attending for Methodist OP) is Coordinator's call; stale-data half clears on clean re-import |
| C2 | P2 | passed | `coordinator-fixes/C2/view-{1-master,2-inpatient,3-outpatient}.png` | Restored Master/Inpatient/Outpatient **editable filter tabs**. Inpatient view = Maya(FullyIP)+Noah(Mixed); Outpatient = Ari(FullyOP)+Noah(Mixed); Mixed shows in both, FullyIP/FullyOP correctly hidden from the opposite view (DOM-verified) | `src/planning-view-filter.test.js` (5 cases) | — |
| F1 | P3 | passed (core) | `coordinator-fixes/F1/{fellows-page-editable,planning-grid-fellow-star}.png` | Fellows page renders editable AvailabilityEditor cards (continuity clinic, day-off, time-off, IP/OP-first "Pre-assign") for Sam Carter + Dana Reyes; Planning Grid pins fellows with a ★ (fellows only) | `planning-grid-staff.test.js` ★ assertion | Dedicated fellow-source *upload* button deferred — general Sources import already brings in role/level="Fellow"; empty-state links to Sources |
| F2 | P3 | passed | `coordinator-fixes/F2/inpatient-schedule-exports.png` + `A2/seeded-op-schedule.png` | Export buttons discoverable on both schedule pages: Inpatient ("Inpatient poster" + "Download inpatient PDF"), Outpatient ("Clinic poster" + "Outpatient PDF") | existing pdf/poster suites | — (already shipped; discoverability verified) |
| U1 | P4 | passed | `coordinator-fixes/U1-U2/expanded-card-danger-remove.png` | Clicking a collapsed card title expands it; clicking the expanded heading collapses it (verified both ways). Dedicated Expand button kept for a11y | covered by render (no crash) | — |
| U2 | P4 | passed | `coordinator-fixes/U1-U2/expanded-card-danger-remove.png` | "Remove rotator" now danger-styled (red, dark-red border) + existing window.confirm guard | — | — |
| U3 | P4 | passed | `coordinator-fixes/U3/undo-redo-topbar.png` | Topbar Undo/Redo buttons (disabled when stack empty); full cycle via keyboard verified: 5→reset→0→Ctrl+Z→5→Ctrl+Shift+Z→0→Ctrl+Z→5. preventDefault (no browser fall-through); skips editable fields | `undo-history.test.js` (7 pure-helper cases, StrictMode-safe) | — |

## Tier gates

- **P0 gate (`npm run verify:project`): PASS** (2026-05-31T20-00-14Z) — all 6 steps green
  (build, vitest 395/395, offline contracts, Python backend, CLI probes, headless browser audit).
- **P2 gate (`npm run verify:project`): PASS** (after C1+C2) — all 6 steps green, vitest 401/401.
- **FINAL gate (`npm run verify:project`): PASS** (2026-05-31T20-47-50Z) — all 6 steps green,
  vitest 409/409. Covers the whole change set (B1, B2, C1, C2, A3, F1, U1, U2, U3 + audit fix).

## Status: COMPLETE for this pass

**Done (10 items, screenshot-proven):** B1, B2 (P0); A3-slice, (A1 plan surfaced) (P1);
C1, C2 (P2); F1, F2 (P3); U1, U2, U3 (P4). Final `verify:project` green.

**Parked (await Coordinator / Cash — do NOT guess):**
- **A1** — staged solver plan written (`A1-scheduler-plan.md`); blocked on **D3** (auto-vs-assist,
  gates the `generateDraft` wiring) + **D2** (Methodist start side). Surfaced for async review.
- **A2** — blocked on **A1** (fellow program rule must exist to emit candidates) + **D4** (pick gesture).
- **C1 label design (D1)**, **A3 full report** (Methodist≠14/14, fellow+2 staffing, etc.) — behind A1.
- **External data:** Methodist schedule (~first-half June), fellow re-upload, requested days-off.

## Notes / decisions log

- **Pre-existing main bug fixed (not a fix-map item):** the headless browser audit's
  `T-SCH-BROWSER-001` asserted `"Block Setup"` is in the Dashboard boot DOM. That string became a
  Settings *sub-tab* in the 2026-05-28 nav redesign, so it's correctly absent on boot — the audit
  was failing on clean `main` before my changes (isolated via `git stash` + rebuild + re-audit).
  Fixed the assertion to check a real top-level nav label (`"Configuration"`) in
  `e2e/run-browser-audit.mjs`. **Flag for Cash:** this is a harness correction, review separately.

- **Seed fixture:** `createDemoState()` (`shared/scheduler/test-fixtures.js`) injected via `POST /api/scheduler/state`. Ships 5 rotators incl. Methodist (Maya Lopez) → unblocks C1 synthetically. Only 1 fellow (Sam Carter) → A2 slash-list needs a 2nd fellow added.
- **B1 decision:** restored Sources as a top-level nav item; left the Settings→Sources sub-tab in place for back-compat (fix-map allows either). Stale Roster help text (`App.jsx:2123`) auto-corrected by the restore.
- **Parked, awaiting Coordinator:** D1 (Methodist OP label), D2 (Methodist start side), D3 (auto vs assist — blocks A1), D4 (fellow candidate pick gesture).
- **External data waiting-on:** Methodist schedule (~first-half June), fellow re-upload, requested days-off.
