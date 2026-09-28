# Comprehensive manual screenshot test — 2026-05-31

**Goal:** Screenshot every screen and operation of the app; verify each screen renders as
expected, every button that should be present is present, and results match expectations.

**App under test:** working tree of branch `coordinator-fixes-2026-05-29` (includes the uncommitted
B1/B2/C1/C2/A3/F1/U1/U2/U3 features). Dev server `:5173` → backend `:6174`.

**Seed:** `e2e/seed-demo-state.mjs` — 5 rotators (Maya Lopez = Methodist/FullyIP, Drew Quinn =
UT Peds/FullyOP, Noah Patel = UT Adult/Mixed, Sam Carter + Dana Reyes = Fellows/Needs),
2 attendings (Alder, Birch), 1 source (AY 2026 roster.xlsx, Reviewed), block May 4–31
(Memorial Day holiday 05-25), 6 IP assignments, 10 OP sessions.

### Deliberate seed fixtures — these are EXPECTED, not defects
- Maya's `"Methodist Outpatient"` placeholder OP (empty provider) → after C1 fix, **0 phantom
  clinic cards** on Clinics.
- Noah's **Saturday** OP (2026-05-09) → a planted weekend-clinic conflict that **should**
  appear as a Warning in Reports → Conflicts.

### Method (per the advisor)
1. Read-only screen sweep FIRST (S-rows), then mutation operations LAST (O-rows). Re-seed if a
   destructive op poisons state.
2. Each row: navigate → screenshot → accessibility snapshot (authoritative for buttons) →
   **console-message check** (a screen can render perfectly and still throw). StrictMode
   double-invoke warnings are dev noise, not failures.
3. This is an AUDIT: log defects, keep sweeping. Do NOT fix mid-sweep. Do NOT commit the 12
   pending implementation files.
4. Termination = every row below has a Result + screenshot + console verdict.

---

## Results summary

**33 / 33 rows PASS** (19 screens + 14 operations). **Zero console errors or warnings on any screen
or operation** (every page checked at `warning` level; only 3 benign info logs per page).

- Every one of the 12 top-level pages + 4 Reports sub-tabs + 4 Settings sub-tabs renders correctly,
  with all expected buttons/controls present (verified against the code via accessibility snapshot,
  not just the screenshot).
- All recent feature work is confirmed live: B1 Sources nav, B2 workflow panel, A3 weekend-clinic
  conflict (Noah Sat 5/9), C1 zero phantom clinics (DOM-verified), C2 IP/OP view filters (symmetric,
  DOM-verified), F1 editable fellows + ★ pinning, F2 export buttons, U1 click-to-expand, U2 danger
  Remove, U3 undo/redo (button + Ctrl+Z + Ctrl+Shift+Z + input-focus skip, all DOM-verified).
- The **core scheduling operation was exercised end-to-end** three independent ways — every assignment
  gesture the grid offers: O09 range-assign (Sam→IP, cells/totals/conflicts all updated 27→22, then
  undo), O10 paint-a-cell (Dana 5/11→OP, totals 0→1, then undo), and O14 drag-a-name-onto-a-cell
  (Noah→IP 5/10, then undo). All three prove the grid is reactive and the assign→persist→undo loop is
  sound, and each writes a distinct backend record (range/paint via the command path; drag stamps
  `source:"Drag-Drop"`).
- Nine mutating operations were run and reverted (O03 undo/redo, O04 add/remove rotator, O05
  add/remove attending, O09 range-assign, O10 paint-cell, O11 field-edit, O12 new-block + switch,
  O13 theme toggle, O14 drag-assign); the **persisted backend state is net-zero** — re-confirmed via
  the API after every op: 5 rotators, 2 attendings, 1 block (active = block-may-2026), 6 IP
  assignments, 10 OP sessions, Maya level = PGY-3, theme restored to dark.
- One finding: **DEF-1** (low severity, pre-existing, partly seed-induced) — attending recurring-clinic
  checkboxes don't reflect clinics stored under the legacy `session` key. Cosmetic in the editor only;
  scheduling data is unaffected (Clinics page generates them correctly). See defects log.

Screenshots: `verification/results/manual-test-2026-05-31/` (full-window, 1854×1080, dark theme).
**All 34 screenshots objectively verified by decoding their PNG pixels (`_decode-px.mjs`):** every one
is exactly **1854×1080** (the full window — none `fullPage`), and the theme is uniform — **33 dark**
(topbar `rgb(16,20,15)`) plus the **1 intentionally-light** shot O13-theme-toggle (`rgb(244,243,237)`).
This pixel decode is authoritative over downscaled-thumbnail perception (which twice falsely read dark
pages — S04, S13 — as "light"; disproved here).
Every O-row screenshot is **viewport-only** (the full 1854×1080 window, matching the S-rows) — never
`fullPage` (which captures the whole scrollable document, contradicting the "full window" instruction).
The 10 shots first taken `fullPage` (S03, S06, S08, S10, S12, O04-1, O04-2, O05-1, O09-1, O09-2) were
**re-captured as 1854×1080 viewport** and re-verified; O09-1/O09-2 were also re-driven live (range-assign
Sam→IP 5/11–5/15 → conflicts 27→22 → Undo → 27) and visually inspected, with backend net-zero re-confirmed.
Note on method: O10–O13 were first captured as DOM/API-only on the reasoning that a rejected `fullPage`
screenshot meant "no screenshots." That was an over-read — the rejection was of the `fullPage` *format*,
not screenshots as a category, and the goal explicitly asks for screenshots whose appearance is checked.
Corrected: each O10–O13 screenshot was captured (viewport), **and visually inspected** against its
expected content, in addition to the DOM/API state+revert proof. Both layers are recorded.

---

## Matrix A — Read-only screen sweep

| ID | Screen | Expected (controls / content) | Result | Shot | Console |
|----|--------|-------------------------------|--------|------|---------|
| S01 | Dashboard | "How scheduling works" 4-step panel; step-1 Sources link; conflicts summary; nav works | **PASS** | S01-dashboard.png | clean | 12 nav items, topbar Undo/Redo/Restore/Save/Reset/Theme, cards 5 rotators·1 source·27 conflicts, pipeline, AY log, export readiness |
| S02 | Configuration | Attendings editors (Alder, Birch); clinic defaults; Save/Add controls | **PASS** | S02-configuration.png | clean | Alder+Birch editors (recurring AM/PM grid, one-off dates, Remove); Add attending; Expected Sources section |
| S03 | Rotators | 5 roster cards grouped by section; Add rotator; per-card Expand + danger Remove | **PASS** | S03-rotators.png | clean | Add Rotator form (name/program×6/level/start/end/Add); 2 filter toggles; 5 cards grouped Methodist(1)/UTAdult(1)/UTPeds(1)/Other(2); Expand+Select per card. Danger Remove → O04 |
| S04 | Sources | Source Intake; 1 source row (AY 2026 roster.xlsx, Reviewed); import control | **PASS** | S04-sources.png | clean | Source Intake (Program dropdown, Choose local file, Download blank template); Reviewed Sources table 1 row + Open·Replace·Delete. Theme-fidelity verified by pixel decode: body=rgb(16,20,15) dark (downscaled thumbnail looked light — perception artifact, NOT a defect) |
| S05 | Attendings | 2 attending cards (Alder, Birch); "Add attending" + Add button | **PASS*** | S05-attendings.png | clean | Alder+Birch editors, recurring AM/PM grid, one-off + Add controls all present. *Finding DEF-1: seeded recurring clinics render UNCHECKED (editor reads `period`, seed used legacy `session`) — see defects log; verify consequence at S07 |
| S06 | Fellows | 2 editable fellow cards (Sam, Dana); ★ context; Sources link in prose | **PASS** | S06-fellows.png | clean | Sam+Dana fully editable: name/program/level, continuity AM/PM grid, day-off checkboxes, time-off, on-service date ranges + Pre-assign dropdown, red "Remove rotator". Prose mentions ★ pinning |
| S07 | Clinics | Two-week AM/PM grid; real clinic boxes; **0 phantom "Methodist Outpatient"** | **PASS** | S07-clinics.png | clean | Prev/Next/Reset nav; 10 day cards (2 wks × Mon–Fri); **0 phantom Methodist-OP cards (C1 ✓, DOM-verified)**; Alder/Birch recurring clinics present (DEF-1 consequence ✓); Eligible/Unassigned/Uncovered panels |
| S08 | Planning Grid (Master) | Combined grid; Master/Inpatient/Outpatient view tabs; Paint toggle; Staff rows; fellow ★ | **PASS** | S08-planning-grid-master.png | clean | 3 view tabs (C2), Paint toggle (O02), Staff-rows + peek filters, Range assign (Rotator/From/To/Phase/Apply), Calendar key legend; 28 date cols, ★5/25 holiday; ★Sam/★Dana pinned (F1), Alder/Birch projections; Mixed(Maya,Noah w/ Sat 5/9 OP), FullyOP(Ari); IP/OP/Unassigned totals sum correctly |
| S09 | Inpatient Schedule | Read-only IP projection; heatmap; "Inpatient poster" + "Download inpatient PDF" | **PASS** | S09-inpatient-schedule.png | clean | Both export buttons present (F2); staffing heatmap + legend (28 tiles, 2/2/1/1 then 0 = matches seed); continuity timeline (Maya 5/4–7, Noah 5/4–5); daily roster w/ Senior labels + Memorial Day 5/25 |
| S10 | Outpatient Schedule | Read-only OP itinerary; "Clinic poster" + "Outpatient PDF" | **PASS** | S10-outpatient-schedule.png | clean | Poster-week dropdown + Clinic poster + Outpatient PDF (F2); "Needs attention" (Clinics w/ no rotator ×8; Maya no-clinic) — uses correct phrasing, no "unresolved" (A2 ✓); By date/session + By rotator (Ari→Alder×5, Maya no clinic, Noah→Birch×4 incl Sat 5/9) |
| S11 | Reports → Daily Report | Per-day report; sub-tablist (Daily/Conflicts/Legend/Export) | **PASS** | S11-reports-daily.png | clean | Report-views tablist (4 tabs); Date dropdown (28 dates); Copyable Daily Summary + Copy button + generated report text |
| S12 | Reports → Conflicts | Conflict report; **weekend-clinic Warning (Noah, Sat)** present | **PASS** | S12-reports-conflicts.png | clean | "Conflict Review" 27 conflicts; **"Noah Patel has a weekend clinic" (Sat 5/9, A3 ✓)** present + Jump buttons; remaining "No inpatient coverage" 5/8–5/31 expected from sparse seed |
| S13 | Reports → Legend | Legend / key | **PASS** | S13-reports-legend.png | clean | "Rotator Legend" table: 1 Ari/2 Maya/3 Noah numbered; fellows Dana/Sam shown as "Fellow" (per prose rule); Dates + Continuity Clinic cols |
| S14 | Reports → Export | Export controls (CSV/PDF/etc.) | **PASS** | S14-reports-export.png | clean | Historical pre-CSV package snapshot (5/28/27/1); current package now includes CSV companions; 4 export buttons (export package, inpatient/outpatient/combined PDF); Summary panel |
| S15 | Settings → Rules | Scheduling rules toggles | **PASS** | S15-settings-rules.png | clean | Settings tablist (4); Methodist Rule (OP-first, checked); Coverage Rules (holidays checked, Max IP=6); Rule Impact Preview — all reflect seed |
| S16 | Settings → Block Setup | Block name/dates/holidays editor; Memorial Day holiday row | **PASS** | S16-settings-blocksetup.png | clean | All Blocks (+Add); Block Details (name/status/start/end); Calendars (5 checked); Coverage Demand (1/0/0/0)+Pre-fill; Memorial Day 5/25 holiday; Save block |
| S17 | Settings → Sources | Sources page hosted as sub-tab | **PASS** | S17-settings-sources.png | clean | SourcesPage mounts as sub-tab (Source Intake + Reviewed Sources), same component as top-level S04 |
| S18 | Settings → Poster | Header/Notes/Locations editors; Add location; Remove | **PASS** | S18-settings-poster.png | clean | Header (Program name/Chief/Footer tagline), Notes textarea, Locations (Main Campus + Name/Address/Remove) + Add location |
| S19 | Topbar | Undo + Redo buttons present, disabled at rest | **PASS** | (every Sxx shot) | clean | Undo/Redo present + disabled at rest on all 18 pages; plus Restore backup, Save backup, Reset demo data, Toggle theme, Block selector |

## Matrix B — Operations (mutation) sweep

| ID | Operation | Expected | Result | Shot | Console |
|----|-----------|----------|--------|------|---------|
| O01 | Planning Grid view filter | Master→Inpatient→Outpatient filters rows correctly | **PASS** | O01-planning-inpatient-view.png, O01-planning-outpatient-view.png | clean | IP view: Mixed+FullyIP only, Ari(FullyOP) hidden. OP view: Mixed+FullyOP, Ari shown. Symmetric C2 filter (DOM-verified) |
| O02 | Paint mode toggle | Paint on/off toggles; view switch turns paint off | **PASS** | O02-paint-mode-on.png | clean | Paint on → brush radios (IP/OP/Off/Reset) appear; switching view sets paintChecked=false (C2 reset). No cells painted (net-zero) |
| O03 | Undo / Redo | mutate → Ctrl+Z reverts → Ctrl+Shift+Z reapplies; buttons enable/disable | **PASS** | O03-1-after-toggle-undo-enabled.png, O03-2-restored.png | clean | Toggled a Rules checkbox: Undo button ✓, Redo button ✓, Ctrl+Z ✓, Ctrl+Shift+Z ✓ (all DOM-verified incl. enable/disable transitions). Input-focus skip ✓ (Ctrl+Z ignored while checkbox focused — correct). Restored net-zero (backend rules unchanged) |
| O04 | Add / Remove rotator | Add appends card; Remove (danger) confirms + deletes | **PASS** | O04-1-rotator-added.png, O04-2-rotator-removed.png | clean | Add "ZZ Temp Tester" → card appears under UT Peds (count 5→6, Undo enabled). U1 click-title-to-expand ✓. U2 danger "Remove rotator" (class danger-button) ✓. window.confirm guard shows correct message → accept → card gone (6→5). Backend net-zero (orig 5) |
| O05 | Add / Remove attending | Add appends; Remove confirms + deletes | **PASS** | O05-1-attending-added.png, O05-2-attending-removed.png | clean | Add disabled-when-empty → enabled w/ text; "Dr Temp Test" appended (3rd card); Remove → confirm dialog (correct message) → accept → back to Alder/Birch. Backend net-zero |
| O06 | Sub-tab switching | Reports + Settings sub-tabs switch panels | **PASS** | S11–S18 shots | clean | Exercised live during sweep: Reports (Daily/Conflicts/Legend/Export) + Settings (Rules/Block Setup/Sources/Poster) all switch panels on click; aria-selected tracks correctly |
| O07 | Sources import affordance | Import/file control present + actionable | **PASS** | S04-sources.png | clean | "Choose local file" enabled; "Download blank roster template" present; hidden file inputs wired incl. `.xlsx,.xls` roster importer (+ general intake + JSON backup-restore). Full import not run (destructive; covered by import suites) |
| O08 | Export buttons | Poster + PDF buttons present on IP/OP + Reports Export | **PASS** | S09/S10/S14 shots | clean | All present + enabled: IP (Inpatient poster, Download inpatient PDF); OP (poster-week, Clinic poster, Outpatient PDF); Reports Export (export package + inpatient/outpatient/combined PDF). Actual file generation covered by pdf/poster suites |
| O09 | **Range-assign (CORE scheduling op)** | Assign rotator → cells + totals + conflicts update; undo reverts | **PASS** | O09-1-range-assigned-IP.png, O09-2-conflicts-cleared-22.png | clean | Range-assign Sam→IP: cells 5/11–5/15 "—"→**IP**, Inpatient totals 0→**1**, Unassigned 2→**1**; Reports→Conflicts **27→22** (5/11–5/15 no-coverage cleared, 5/8/weekend remain). Undo → all revert, conflicts 27, **backend net-zero (6 IP, Sam 0)** |
| O10 | Paint-a-cell (assign variant) | Paint brush assigns a day; undo clears | **PASS** | O10-paint-cell-op.png | clean | Paint ON + OP brush → real-click Dana Reyes 5/11 cell: "—"→**OP**, class →`planning-cell-outpatient`, Outpatient totals 0→**1**. Screenshot shows banner **"Painted 1 day as outpatient."** + active brush controls (visually confirmed). Undo → cell "—" + Paint OFF. Backend net-zero (OP 10, Dana 0). Note: paint fires on `onMouseDown`, so a synthetic `.click()` is a no-op — a real pointer click is required (2nd assign input path vs O09 range) |
| O11 | Edit existing field | Change a roster field; persists to backend; undo reverts | **PASS** | O11-field-edit-maya-pgy4.png | clean | Edited Maya Lopez **Level PGY-3→PGY-4**; **persisted to backend** (`rot-methodist-1.level=PGY-4`), Undo enabled. Screenshot (visually confirmed) shows card heading **"Maya Lopez (Methodist · PGY-4)"** + Level field "PGY-4" consistent. Undo → input + backend + heading all revert to **PGY-3**. Net-zero. (Incidental: roster name lives under `fullName`/`displayName`, not `name` — schema naming, not a defect) |
| O12 | Block switch / + New block | Block selector creates + switches; reversible | **PASS** | O12-new-block-created.png | clean | "**+ New block…**" → created "New rotation block" + **auto-switched** (screenshot visually confirms notice **"Created new block 'New rotation block' and switched to it."** + selector value + empty-roster message for the new June block); explicit **switch back** to May 2026 (`block.use`, seed roster re-rendered ✓). Undo → new block removed + active restored. Backend net-zero (`serviceBlocks`=1, `activeBlockId`=block-may-2026) |
| O13 | Theme toggle | Topbar toggle switches dark↔light app-wide; reversible | **PASS** | O13-theme-toggle-light.png | clean | "Toggle theme" → `data-theme` dark→**light**; screenshot (Dashboard, visually confirmed) shows full light theme — light sidebar/panels/cards, all content readable, no contrast/clipping issues. Toggled back → `data-theme`=**dark** restored. Net-zero (UI preference only) |
| O14 | **Drag-to-assign (CORE — 3rd assign path)** | Drag a rotator name onto a cell → assigns IP; undo reverts | **PASS** | O14-drag-assign-ip.png | clean | Low-level pointer drag (dnd-kit `PointerSensor`) of Noah Patel's row-name onto his unassigned 5/10 cell. NB: standard Playwright `dragTo` / HTML5 drag is a **no-op** here — the row-head is `role=button` with no `draggable` attr, so only a real pointerdown→pointermove×N→pointerup reaches the sensor. Cell **"—"→IP**; banner **"Noah Patel assigned to inpatient on 2026-05-10."**; dnd-kit live status "Draggable item rot-utadult-1 was dropped over droppable target cell::rot-utadult-1::2026-05-10"; backend gained `{date:2026-05-10, rotatorId:rot-utadult-1, role:Resident, source:"Drag-Drop"}` (IP 6→7). Undo → cell "—", **backend net-zero (IP 6)**. The `source:"Drag-Drop"` stamp proves a code path distinct from O09 (range) / O10 (paint) — all three assign gestures now exercised live |

### Operations verified PRESENT but intentionally not exercised
These topbar/import controls are confirmed present + enabled (S19 / S04), but were **not triggered**
because doing so has side effects outside the app's in-memory state that can't be cleanly made
net-zero in this read-mostly audit:
- **Save backup** — downloads a JSON file to disk (would litter the Downloads dir). Control present.
- **Restore backup** — reads a user-chosen file and *replaces* the entire state (destructive; needs a
  re-seed to recover). Control present; the JSON-restore path is also covered by import suites.
- **Reset demo data** — destructive re-seed; deliberately not fired mid-audit to preserve the fixture.
- **Sources file import (O07)** — `.xlsx` upload; full import not run (covered by the import test suites).

---

## Defects log

- **DEF-1 (low, PRE-EXISTING, partly seed-induced)** — `AttendingProfileEditor` recurring-clinic
  checkbox grid reads only `slot.period` (`src/App.jsx:4185,4221`), but the rest of the app
  (`shared/scheduler/clinic-selectors.js:83,104`) reads `slot.session ?? slot.period`, honoring a
  legacy `session` key. An attending whose recurring clinic is stored under `session` (as the seed
  writes, and as imported/older data may) is **honored by clinic generation but shows UNCHECKED in
  the editor** — a user could think the clinic is unset and re-add it under the other key.
  Not part of the uncommitted B1–U3 work. **Consequence VERIFIED at S07**: Clinics renders
  Alder·General Neuro (Mon AM) and Birch·Epilepsy (Wed PM) for both weeks (DOM-confirmed) →
  the generator honors `session`; only the editor checkbox *display* lags. So the impact is
  cosmetic/confusing in the editor, not a scheduling-data loss.
  Fix candidate: editor should read `slot.session ?? slot.period` for display, matching selectors.
  **Severity pinned (per advisor):** traced the write paths — `excel-import.js` imports *rotators*,
  not attendings (no recurringClinics written there); the attending command path
  (`commands.js:360,369`) writes `period`. So the *current* app always writes+reads `period`, and
  the blank-checkbox display only affects legacy/migrated data stored under `session` (the very case
  the `clinic-selectors` fallback was added for). Confirms LOW severity — not an every-import bug.
  - **✅ RESOLVED 2026-05-31 (same day):** `AttendingProfileEditor` now reads `slot.session ?? slot.period`
    via extracted pure helpers (`clinicSlotPeriod` / `hasRecurringClinic` / `toggleRecurringClinic`),
    matching `clinic-selectors`. The one-off `<select>` got the same accessor **plus** normalize-on-write
    (`normalizeOneOffPeriod` drops the stale `session` key on edit, so the nullish-coalescing reader
    can't snap the control back). Locked by unit tests `src/attending-clinic-slots.test.js` (6 cases,
    legacy-`session`-shaped data) and verified on-screen: with the `session`-keyed seed, Alder now renders
    **AM/Mon checked** and Birch **PM/Wed checked** (both were blank before). Full `verify:project` green
    (415 vitest). Confirmed the only raw reader of `slot.session` is `clinic-selectors` (`?? period`), so
    normalize-on-write is safe; no bulk data migration performed (read-fallback + normalize-on-touch).
