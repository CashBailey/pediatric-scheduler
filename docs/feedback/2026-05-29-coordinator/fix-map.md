# Coordinator feedback round — 2026-05-29 — Fix Map

**Audience:** Cash (developer). **Customer:** Coordinator Khalili (pediatric neurology
fellow, the end user). This document consolidates *every* note and need from the
05-29 walkthrough into one prioritized, code-grounded roadmap so there is a single
source of truth to work from — instead of scattered chat messages and screenshots.

> **Governing principle (Cash, this conversation):** *"Try not getting too hung up on
> small details. Definitely keep a log of them, but we ought to first ensure the main
> algorithms are working."* and *"Like building a house we need to focus on the overall
> structure… Let's put up the drywall before we start putting in the hedge molding."*
>
> So this map is tiered: **P0 blockers → P1 the scheduling algorithm (the drywall) →
> P2 correctness/regressions → P3 features → P4 UX polish (the hedge molding, logged but
> deferred).** Do P0/P1 first.

## Sources (every claim below traces to one of these)

| Tag | What it is |
|-----|------------|
| `T:n` | Line `n` of `05-29 …Walkthrough-transcript.txt` (Cash ↔ Coordinator recorded call) |
| `IMG-<time>` | The `WhatsApp Image 2026-05-29 at <time>.jpeg` screenshots |
| `CHAT` | The pasted ChatGPT/WhatsApp design thread (export design + "I want this thread in my projects app") |
| `SPEC` | The pasted scheduling-algorithm rules spec ("update the automatic scheduling algorithm rules…") |
| `NOTE` | A standalone bullet Coordinator wrote alongside the screenshots |

**Screenshot key:**
`IMG-10.00.05` = the polished target Outpatient Clinic Schedule poster ·
`IMG-08.06.20` = empty Fellows page ·
`IMG-08.04.42` = expanded rotator card (Remove button) · `IMG-08.04.16` = collapsed rotator cards ·
`IMG-08.03.09` = Clinics page (phantom "Methodist Outpatient" + white bars) ·
`IMG-08.02.40` = Outpatient Schedule ("Methodist Outpatient" + "unresolved") ·
`IMG-08.02.01` = Attendings page · `IMG-07.58.16` = Planning Grid · `IMG-07.57.37` = Inpatient Schedule.

---

## At-a-glance priority table

| ID | Tier | Item | Effort | Status today |
|----|------|------|--------|--------------|
| **B1** | P0 | "SOURCES tab is gone" — she can't find where to import data | S | Page exists, buried in Settings sub-tab |
| **B2** | P0 | Workflow guidance text invisible — she can't follow/test the flow | S | Text never implemented |
| **A1** | P1 | Program-specific **auto-scheduling algorithm** (IP/OP split rules) | **L** | Only Methodist auto-assigns; all others are no-ops |
| **A2** | P1 | Fellow blank-assignment → show **"Coordinator / Eden"** candidates, not "unresolved" | M | Shows red "unresolved" |
| **A3** | P1 | **Validation report** (staffing minimums, day-off, 14/14, sandwich, double-book…) | M–L | Only partial conflict checks |
| **C1** | P2 | Phantom **"Methodist Outpatient"** clinic + white bar | S–M | Stale data + latent filter gap |
| **C2** | P2 | **Inpatient / Outpatient filtered planning tabs** ("really important") | M | Regression — removed |
| **F1** | P3 | **Fellows page**: upload fellow source + profiles (pinned ★, prefs) | M | Read-only empty filter view |
| **F2** | P3 | Rotator-facing **PDF exports** + multi-clinic per AM/PM | — | ✅ Already shipped — verify discoverability |
| **U1** | P4 | Click same area to **expand AND collapse** | S | Separate button only |
| **U2** | P4 | **Accidental "Remove rotator"** — guard against mis-click | S | Button under cursor after expand |
| **U3** | P4 | **Ctrl+Z undo** + keyboard shortcuts | M | None exist |

`S`=small `M`=medium `L`=large.

---

# P0 — Blockers (she literally cannot use the app right now)

## B1 — "What happened to the SOURCES tab? I can't find where to import the data"
*Source: `NOTE` ("What hapepned to the SOURCES tab?" ×3, "The sources tab is gone" ×2,
"I can't find where to import the data"), `T:4` (her workflow starts at the Sources tab).*

**This is the single most important blocker** — she cannot import her roster, so nothing
downstream works.

- **What's actually true:** the import page still exists and works fully — `SourcesPage`
  (`src/App.jsx:684`). The 2026-05-28 navigation redesign (commit `a6f5d77`, "Phase 1")
  **demoted it from a top-level sidebar item to a sub-tab buried inside Settings → Sources**
  (`src/App.jsx:5039`). The sidebar `PAGES` array (`shared/scheduler/scheduler.js:27`) no
  longer lists Sources.
- **Why it's invisible:** Settings reads as a utility page (Rules / Block Setup / Poster),
  so a user looking to *import data* would never think to look there. Worse, `RosterPage`
  still tells her to *"upload a roster on the Sources tab"* (`src/App.jsx:2123`) — a tab
  that no longer appears.

**Fix (small, ~3–5 lines across 2 files):**
1. Add `"Sources"` back to `PAGES` in `shared/scheduler/scheduler.js:27` (suggest position 3,
   right after `Rotators` — it's a data-intake step).
2. Add `Sources: FileUp` (or `Upload`) to `pageIcons` (`src/App.jsx:115`).
3. Add `Sources: SourcesPage` to the `PageComponent` map (`src/App.jsx:247`).
4. Remove the now-duplicate Sources sub-tab from `SettingsPage` (`src/App.jsx:5039`), or
   leave it for back-compat.
5. Fix the stale "Sources tab" help text (`src/App.jsx:2123`).
6. *Nice-to-have:* make the Dashboard "Sources" metric (`src/App.jsx:360`) a link to the page,
   and show a CTA when `state.sources.length === 0`.

**Risk:** verify `SettingsPage` `SectionTabs` doesn't assume a fixed tab count; grep tests for
a `"sources"` deep-link id.

## B2 — "Can't see this" — the workflow guidance text is missing
*Source: `NOTE` ("Can't see this", "so is this important to ensure I can see the text, so I
can test the functionality. Then I will see if the maps at the top are helpful"), and the
4-step text she pasted twice.*

She wants this visible (she believes it's supposed to be at the top of the Dashboard) so she
can follow and test the flow:

> First, import the schedule data. Next, enter any requested days off or other constraints.
> Then, the system generates a draft schedule. Finally, review the draft, resolve any flagged
> conflicts, and finalize the schedule.

- **What's true:** this narrative was **never added to the code**. `DashboardPage`
  (`src/App.jsx:348-420`) shows only metric cards + a 6-step "Schedule Pipeline" of bare
  icon badges — no descriptive prose. (`IMG` of an empty view; her "This is empty nothing is
  there".)

**Fix (small):** add a static "Workflow Overview" `<section>` on the Dashboard (reuse
`.panel.wide`) rendering the 4 steps with text. Pure read-only UI, no state. Wire step 1's
link to the restored **Sources** page (B1) so the two fixes reinforce each other.

---

# P1 — The scheduling algorithm (the drywall) — **do this before any polish**

This is the "main algorithm" Cash flagged as the priority. **Bottom line: there is no
automatic scheduler today.** The app is a *manual construction tool* (paint mode +
range-assign on the Planning Grid) with exactly **two** automated helpers:
- `applyMethodistAutoAssign` — the Methodist 14/14 split (`shared/scheduler/scheduler.js:1932`).
- `applyPreassignments` — fills cells the user *manually* marked with a segment phase
  (`shared/scheduler/scheduler.js:1987`).

Everything else in `program-rules.js` is an explicit **no-op**: `ut-adult`, `ut-peds`,
`ut-student`, `ut-psychiatry`, `other` all dispatch to `noopAutoAssign`
(`shared/scheduler/program-rules.js:64-92`). There is **no** `generateSchedule` / solver /
"generate draft" entrypoint anywhere in the codebase.

So `SPEC` ("make the automatic scheduler split the full master rotator schedule into
inpatient and outpatient using the rules below") is **largely unbuilt**.

## A1 — Per-rule gap analysis (from `SPEC`)

| # | Rule (from SPEC) | Status | Evidence / where it lives |
|---|------------------|--------|---------------------------|
| 1 | **Classify** by program (fellow / Methodist / UT peds / UT adult / psych / other) | ✅ **Implemented** | `inferSchoolType` (`scheduler.js:97`), `classifyRotator` (`scheduler.js:1870`), `schoolType` field; fellows via `level/role==="Fellow"` (`scheduler.js:210`) |
| 2 | **Fellow follows template**; blank+multiple → show candidate names, not "unresolved" | ⛔ **Missing** | Fellows only follow *manual* `segments[].defaultPhase`; OP view shows red **"unresolved"** (`IMG-08.02.40`). No candidate-name display. → see **A2** |
| 3 | **Non-fellow split by length** (3+ wk ≈ half/half · 2 wk 1IP/1OP · 1 wk single) | ⛔ **Missing** | `noopAutoAssign` — no length-based split logic exists |
| 4 | **5-week anti-burnout** OP/IP/IP/IP/OP; never sandwich; keep 3 IP consecutive | ⛔ **Missing** | `maxConsecutiveInpatientDays:6` (`scheduler.js:69,1060`) is a *cap*, not the pattern rule |
| 5 | **Methodist** 28-day, exactly 14 IP / 14 OP, clean swap | ✅ **Implemented** | `applyMethodistAutoAssign` (`scheduler.js:1932`), `getRotatorPhase` (`scheduler.js:1921`) |
| 5b | …choose **start side** by staffing/continuity | ◑ **Partial** | Start side is fixed by `methodistOutpatientFirst` rule (default OP-first); not staffing-driven |
| 6 | **UT peds / UT adult** — balance IP/OP **across the year**, across non-consecutive blocks | ⛔ **Missing** | No cross-block balance tracking anywhere |
| 7 | **Psychiatry** 4–5 wk split, continuity over balance | ⛔ **Missing** | `noopAutoAssign` |
| 8 | **Outpatient ⇒ Sat/Sun off** (clinics closed) | ◑ **Partial** | OP placeholder fill skips weekends (`scheduler.js:2027`); clinics are weekday-only by construction. Not an explicit validation, but structurally enforced |
| 9 | **Inpatient day off** 1/wk · prefer weekend · **fellow weekend priority** · Fri/Mon fallback | ◑ **Partial** | Per-rotator *manual* weekly `dayOff` (`scheduler.js:214,254`) + consec-day cap. No auto weekly-off assignment, no fellow weekend priority, no Fri/Mon fallback |
| 10 | **Inpatient staffing minimums** (wd fellow+2, prefer +3 · wknd variants) · staff IP before OP | ◑ **Partial** | Coverage-count + heatmap exist (`scheduler.js:1298`, `heatmap.js`); grid shows IP/OP tallies (`IMG-07.58.16`). But the fellow+2/+3 minimums are **not encoded or enforced**, and there is no "staff inpatient first" automation |
| 11 | **Outpatient target** OP fellow + 2–3 rotators (lower priority) | ⛔ **Missing** | No target enforced |
| 12 | **Validation report** (~18 violation types) | ◑ **Partial** | `detectClinicAssignmentConflicts` / `validateClinicAssignment` (`clinic-validation.js:49,122`), consec-day check, `rotator-unavailable` conflict, and slot-dedupe (prevents double-booking). **Missing:** below-min staffing, no-weekly-day-off, Methodist≠14/14, 5-week sandwich, missing IP/OP fellow, year-end imbalance, out-of-range — as one consolidated report → see **A3** |

### Recommended staged build (do not write code until the plan is reviewed — per `SPEC`)
1. **Lock classification + a `generateDraft(state, block)` entrypoint.** Today there's no
   place for a solver to live; `applyProgramRules` (`program-rules.js:61`) is the natural seam —
   it already dispatches per `schoolType`. Replace the `noop`s here one program at a time.
2. **Length-based split (rule 3)** for UT peds/adult — the highest-volume rotators.
3. **5-week pattern + sandwich guard (rule 4)**, then **Methodist start-side selection (5b)**.
4. **Staffing minimums + "IP before OP" (rule 10/11)** — the staffing engine; reuse the
   existing coverage-count/heatmap surface.
5. **Day-off engine (rule 9)** with fellow weekend priority.
6. **Year balance tracking (rule 6)** — needs cross-block state per rotator.
7. **Validation report (A3)** last, since it asserts everything above.

Each step ships behind tests (the repo already has a strong `scheduler.test.js` suite to
extend). Keep manual paint/range-assign working — the solver should *seed* the grid, and the
user edits on top (preserve existing manual entries, which the dedupe already guarantees).

## A2 — Fellow blank assignment: show "Coordinator / Eden", not "unresolved"
*Source: `SPEC` ("Blank Fellow Assignment Behavior") + `IMG-08.02.40` (red "unresolved").*

When two fellows are active for the same range but the template doesn't say who's IP vs OP
first, the cell must display the **candidate names** (`Coordinator / Eden`) and be flagged for
manual selection — **not** a generic "unresolved." Currently the OP schedule renders
"unresolved." Build a candidate-pool resolver: for each date, find active fellows; if exactly
one → show that name (confirm if ambiguous); if multiple with no template side → show the
slashed candidate list; if none → flag missing fellow coverage.

## A3 — Consolidated validation report
*Source: `SPEC` ("Validation Rules" — ~18 checks).*

Extend the existing conflict surface into a single post-generate report covering: missing
IP/OP fellow · fellow-blank-with-candidates · IP weekday below fellow+2 (and below preferred
+3) · IP weekend below required · weekend fellow-off with <2 rotators · 7 days with no day off
· OP assigned to Sat/Sun · Methodist not 14/14 · 5-week sandwich · UT year-end imbalance ·
psych avoidable imbalance · out-of-range assignment · IP/OP double-booking. Several primitives
already exist (`clinic-validation.js`); this is mostly new assertions + a report view.

---

# P2 — Correctness bugs & regressions

## C1 — Phantom "Methodist Outpatient" clinic (+ the "white bar")
*Source: `NOTE` ("I still don't know where METHODIST OUTPATIENT is coming from — I don't have
a clinic or attending named that"; "Another example… with the white bar"), `IMG-08.03.09`,
`IMG-08.02.40`.*

There are **two distinct mechanisms**, and it matters which one she's looking at:

**1. What's on her screen right now = stale persisted data (not live code).**
In current code, the string `"Methodist Outpatient"` (`METHODIST_OP_CLINIC`,
`scheduler.js:19`) can **only** be written for rotators classified `"methodist"` —
`getRotatorPhase` returns `null` for everyone else (`scheduler.js:1923`), and range-assign /
pre-assign now use the generic `"Outpatient (clinic TBD)"` (`OP_PLACEHOLDER_CLINIC`). But her
screenshots show "Methodist Outpatient" on **Morgan Bell / Quinn Hayes**, who are
**UT Adult Neuro** (`inferSchoolType("UT Adult Neuro") → "ut-adult"`, `scheduler.js:97`).
Current code *cannot* produce that. So those labels are **left over from before commit
`d075b32` (2026-05-27)**, when the generic OP placeholder string literally *was* "Methodist
Outpatient" and got stamped on all OP cells. That fix renamed the label going forward but did
**not migrate existing records**.
→ **The fix that clears her screen is re-import / a one-time data migration, not a code change
to the writer.** Since she's re-uploading fresh sources anyway (see Dependencies), **first
verify the labels disappear on a clean re-import** before doing anything else here.

**2. A real, *latent* bug = the placeholder leaks into the Clinics view.**
`isRealClinicName` (`shared/scheduler/clinic-selectors.js:41-44`) excludes
`OP_PLACEHOLDER_CLINIC` but **not** `METHODIST_OP_CLINIC`. So when there *is* a genuine
Methodist rotator, the 14/14 auto-assign's OP placeholder sessions (which have an **empty
provider** = the **"white bar"** Coordinator saw) get synthesized into fake clinic cards on the
Clinics page and Outpatient Schedule (`clinic-selectors.js:119,164`). This will bite the
moment she has a Methodist rotator on service.

**Decision required (this is *not* a slam-dunk one-liner — see Open Decisions D1):** the
author *intentionally* kept `METHODIST_OP_CLINIC` "meaningful" (`scheduler.js:15-17`). Three
options: (a) suppress it from `isRealClinicName` like the generic placeholder — but that also
hides legitimate Methodist OP labels; (b) relabel; (c) **the design fix Coordinator actually
wants** (per `CHAT`): outpatient cells should show the **real clinic + attending + rotator**,
not any synthesized placeholder at all.

## C2 — Inpatient / Outpatient **filtered planning** tabs ("OK this is really important")
*Source: `NOTE` ("I want an outpatient and inpatient tab so only rotators on either inpatient
or outpatient are shown, **this is different from** the INPATIENT SCHEDULE and OUTPATIENT
schedule tab" — marked "OK this is really important", "so is this"), and `T:40-44` ("There is
this master planning grid and then I want another tab that says outpatient planning grid and
inpatient planning grid. We had that.").*

> Note: the transcript's "after I separate rotators into IP/OP I want to **see everyone on
> outpatient and everyone on inpatient so I can ensure no coverage gaps and smooth
> transitions**" (`T:40`) is the *same* need — listed once here.

This is a **regression**, not a new feature. The `PlanningGridPage` (`src/App.jsx:2341`) today
groups rows only by completion state (Needs Assignment / Mixed / Fully Inpatient / Fully
Outpatient / Not in block) — one combined editable view (`IMG-07.58.16`). The previous
`CombinedPlanningPage` with Master / Inpatient / Outpatient **editable** tabs was removed in
commit `18abb08` (2026-05-28).

**Key distinction to preserve:** these are **editable construction** filters (a focused view of
the master grid showing only IP-assigned or only OP-assigned rotators) — *distinct from* the
read-only final `Inpatient Schedule` / `Outpatient Schedule` tabs
(`src/components/inpatient/InpatientSchedule.jsx`, `.../outpatient/OutpatientSchedule.jsx`).

**Fix (medium):** restore the IP/OP filter tabs within Planning Grid (re-introduce the
`rowVisibleInView` filtering). Watch: tab-state persistence, Paint-mode reset on tab switch,
prop rewiring.

---

# P3 — Features she asked for

## F1 — Fellows page: upload fellow source + real fellow profiles
*Source: `NOTE` ("Ideally there would be an option to upload the source for fellows directly
to this page, then I can view fellow rotator profiles with preferences for days off,
continuity clinic schedule, etc."), `IMG-08.06.20` (empty "No fellows in the roster yet"),
`T:14,32,36,50` (pin the fellow at the top with a ★, hideable).*

- **Today:** `FellowsPage` (`src/App.jsx:4987`) is a **read-only filtered list** (rotators
  with `role/level==="Fellow"`) showing only name/program/dates, and it points her back to the
  Rotators page to edit. It's empty because no fellows are imported/classified yet.
- **The data already exists** on the rotator model — `continuityClinic`, `dayOff`,
  `unavailableRanges`, and `segments[].defaultPhase` (the IP-first/OP-first preference) — it's
  just not surfaced here.

**Fix (medium):**
1. Add a fellow-source **upload** on this page (reuse `SourcesPage`'s import path, filter to
   fellows).
2. Render **full editable fellow cards** (reuse `AvailabilityEditor`, `src/App.jsx:1813`):
   preferred day off (Sat/Sun), continuity clinic, IP-first vs OP-first, free-text notes.
3. Add an explicit **IP-first / OP-first** preference field (today only encoded indirectly via
   `segments[].defaultPhase`).
4. In the Planning Grid, render the pinned fellow rows with a **★** badge (the
   `planning-row-fellow` rows exist at `src/App.jsx:2793` but have no star), keep the
   hide/show toggle she likes.

> Context (`T:36-38`): fellows are easy to schedule (always 2 on service, half IP / half OP),
> so she wants them **pinned + hideable**, not run through the hard rotator logic.

## F2 — Rotator-facing PDF exports + multiple clinics per AM/PM — ✅ already shipped
*Source: `CHAT` (the export design thread), `IMG-10.00.05` (the target poster).*

**Good news — this is already built** (commit `0d4b0d0`) and matches her mockup:
- `buildClinicPosterPdf` (`src/clinicPosterPdf.js:404`) — the polished "OUTPATIENT CLINIC
  SCHEDULE" poster (title, date range, Mon–Fri AM/PM grid, category colors, legend, notes,
  locations), with a week selector on the Outpatient Schedule page
  (`src/components/outpatient/OutpatientSchedule.jsx:54`).
- `buildInpatientPosterPdf` (`src/clinicPosterPdf.js:453`) — the inpatient counterpart with a
  staffing heatmap (`src/components/inpatient/InpatientSchedule.jsx:102`).
- **Multiple parallel clinics per half-day already works:** `poster-weeks.js:69-107` builds
  `cardsByDateSession` keyed `"<date>|<period>"` where each AM/PM is an **array** of clinic
  cards; `drawSession` (`clinicPosterPdf.js:187`) stacks them (with "+N more" overflow). The
  `outpatient-session.js` schema even has a `details[]` array (`clinic/attending/task`). This
  is exactly the data model `CHAT` asked for.

**Action: none structural — just confirm discoverability.** Make sure Coordinator can find the
"Clinic poster" / "Inpatient poster" download buttons. (One caveat for later: today's poster
is clinic-occurrence-centric while sessions are rotator-centric — fine for now, revisit only
if the cards don't line up with her real clinic data.)

---

# P4 — UX polish backlog (the "hedge molding" — logged, deferred until P0–P2 land)

Per Cash's instruction these are **logged, not yet scheduled.** All are small except U3.

## U1 — Click the same area to expand **and** collapse
*Source: `NOTE` ("I love the expand button, but I want to be able to click twice in the same
area to 'EXPAND' and 'COLLAPSE'").*
Today it's a dedicated `Expand`/`Collapse` button only (`RotatorProfileActions`,
`src/App.jsx:1734-1763`). **Fix:** attach the toggle to the whole card header
(`roster-profile-summary-head`) — clicking the header toggles. Keep the button for a11y
(`aria-expanded`); don't let header clicks hit the Select checkbox or trigger text-selection.

## U2 — Guard against accidental "Remove rotator"
*Source: `NOTE` ("Once I expand it, my mouse is hovering over REMOVE ROTATOR so I can
accidentally deleting a rotator profile"), `IMG-08.04.42`.*
The "Remove rotator" button sits top-right (`src/App.jsx:1862-1870`) exactly where the cursor
lands after clicking Expand, styled as a plain secondary button. **Fix (pick one+):** add a
`window.confirm` guard on single-rotator removal (`onRemove`, `src/App.jsx:1594`) to match the
bulk-delete guard; give it danger styling (`.danger-button`, `styles.css:710`); separate it
spatially / move to an overflow menu; or (best, ties to U3) an **undo toast** with a few-second
restore window.

## U3 — Ctrl+Z undo + keyboard shortcuts
*Source: `NOTE` ("put in the … control Z control line and other shortcuts").*
**None exist.** App state is plain `useState` (`src/App.jsx:154`); the only `keydown` handler
is Escape in the import modal (`src/App.jsx:1041`). **Fix (medium — small refactor):** move
state to a reducer with a bounded past/present/future history stack; add a global keydown for
Ctrl+Z / Ctrl+Shift+Z; surface a shortcuts help panel. **Watch:** don't bloat `localStorage`
(cap history depth), and don't let Ctrl+Z fall through to the browser. *This also gives U2 its
undo path — consider doing U2+U3 together.*

---

# External dependencies / waiting-on (not code — track these)

*Source: `NOTE`/`T` conversation.*

- **Methodist schedule** — Coordinator *does not have it yet*; expects it **first half of June
  2026**. Until then, the Methodist 14/14 path (and C1's latent phantom) can't be tested with
  real data.
- **Fellow schedule** — she needs to **re-upload** it ("I need to reupload the fellow
  schedule"). She *can* provide it now. This feeds F1 and the fellow rules.
- **Requested days-off** — *not yet collected* ("Not requested days yet"). The schools' info is
  in; the per-person day-off constraints are not. This is required input for rules 9/12.
- **Cash's commitment:** *"You'll have the newest version by Monday morning"* → **2026-06-01**.
- Source-of-truth note: she replaced the source documents in the context folder — treat the
  **replaced files as authoritative** and re-read them before regenerating (`SPEC` execution
  prompt).

---

# Decisions for Coordinator — ✅ RESOLVED 2026-05-31 (Coordinator, via Cash/WhatsApp)

- **D1 — Methodist OP label (from C1): RESOLVED → it's a *continuity clinic*, not a "Methodist
  outpatient clinic".** Coordinator: *"There is no such thing as a Methodist outpatient clinic, just
  a rotator's continuity clinic at which point they should be considered **unavailable** and I
  want the schedule to **show that they have clinic** but give me the **option to hide** that part
  and just have it assumed for the rotators referencing the schedule. I like it **visible to me**
  so I can stay organized."* → **Display answer = (b)+toggle:** show the continuity clinic by
  default (her organizing view); add a **hide toggle** for the rotator-facing version. The
  `METHODIST_OP_CLINIC = "Methodist Outpatient"` label (`scheduler.js:19`) is **wrong** — it is
  not a real clinic. See the **NEW DOMAIN RULE** and the **D1b resolution** below.
- **D2 — Methodist start side: RESOLVED → staffing-driven, INPATIENT-first.** Coordinator: *"they
  should start on inpatient if they are needed to fill in scheduling needs, so prioritize that."*
  → Phase selection must look at **inpatient coverage need** and default to **inpatient-first**,
  not the current fixed OP-first. ⚠️ **Grounded finding:** the existing `methodistOutpatientFirst`
  rule + Settings checkbox (`App.jsx:4014`) is a **DEAD FLAG** — defined in `DEFAULT_RULES`
  (`scheduler.js:69`), the v1 contract, and the Py backend, but **never read** by `getRotatorPhase`/
  `applyMethodistAutoAssign` (only asserted in tests). The split is hardcoded OP-first at
  `scheduler.js:1953`. D2 therefore needs **real staffing-aware logic**, not a flag flip; either
  wire up or remove the dead checkbox.
- **D3 — Auto vs. assist: RESOLVED → fully auto, then she edits.** Coordinator: *"auto and then I
  edit."* → `generateDraft` should **auto-assign everyone** to seed the grid; she tweaks from
  there. This unblocks the A1 build gate. (No general fully-auto whole-grid scheduler exists yet —
  only the Methodist 14/14 generator + `applyPreassignments`.)
- **D4 — Fellow candidate UX (A2): RESOLVED → resolve on the Fellows page.** Coordinator: *"do it on
  the fellows page."* → When a blank-template day has multiple fellow candidates, the pick gesture
  is **on the Fellows page**, NOT click-to-choose in the grid cell.

## NEW DOMAIN RULE — continuity clinic (everyone, every week) — 2026-05-31

Coordinator: *"Every rotator and fellow has a continuity clinic half-day during some point in the week
at which point they are **excused from the rotation** to attend that clinic… I get excused from
whatever rotation I'm on (whether that is in the hospital or **another outpatient clinic**) in
order to attend that and have continuity of care."* Recurs **weekly**. Known instances:
- **Pediatrics residents → Wednesday PM**
- **Coordinator (the fellow) → Thursday AM**
- **All other rotators (Methodist, UT Adult Neurology) → an individually-specified half-day** (per
  person; comes from their data — do not assume a global default).

**GOOD NEWS — this is mostly REUSE, not a new build (grounded 2026-05-31):**
- Continuity clinic is **already first-class**: `rotator.continuityClinic` is a required contract
  field (`contracts/v1/rotator.js:18,46`), Excel-imported (`excel-import.js:52,407`), parsed
  single + multi-slot (`parseContinuityClinic` / `parseContinuityClinicSlots`,
  `scheduler.js:1736,1774`), surfaced per-date (`continuityClinicsForDate` `scheduler.js:1812` →
  `derived-views.js:311,396`), and it **already excuses** in the OP auto-preassign
  (`scheduler.js:2066-2069`) + raises `continuity-clinic-conflict` warnings (`scheduler.js:957`).
- **Fellows are rotators** (`role==="Fellow"`, `derived-views.js:393`) — Coordinator's Thu-AM needs
  **zero new fields**.
- **Genuinely new wiring (not data):** (1) **half-day unavailability** — `isRotatorUnavailable`
  (`scheduler.js:253`) is **day-only** and ignores continuity, so a D3 fully-auto assigner would
  *place-then-warn* instead of hard-skipping the half-day; needs a `(date,period)` availability
  axis. (2) **Seed defaults are wrong** — `scheduler.js:214` hardcodes `"Tuesday PM"` for
  Adult/Methodist and **blank** for peds/fellows; should seed peds → Wed-PM, fellow → Thu-AM,
  leave Methodist/UT-Adult per-person. (3) `avoidContinuity` (`scheduler.js:1093`) is single-slot
  weekday-only → over-blocks the whole day, misses a 2nd slot; move to `parseContinuityClinicSlots`
  (weekday+period). (4) **D1 hide toggle** = pure UI on `continuityClinicsForDate`/
  `continuityPullouts` output — no model change.

## D1b — Methodist outpatient fortnight — RESOLVED 2026-06-02

Coordinator #8 resolves the inpatient-backup rule: during a Methodist rotator's outpatient fortnight,
they are **off our inpatient service** and must not be pulled into inpatient fair-fill, including
weekends and holidays where they would otherwise look available. The 14/14 split stays split.

Planner tracking may still keep an internal outpatient-half marker so the rotation remains visible
in the working grid, but that marker is not a real "Methodist Outpatient" clinic and does not make
the rotator eligible for inpatient backup. The visible clinic fact remains the rotator's actual
weekly continuity clinic, governed by the D1 show/hide behavior above.

Verification anchors:

- JS rule: `shared/scheduler/scheduler.test.js` covers "excludes a Methodist rotator during their
  outpatient fortnight from inpatient fair-fill".
- Python parity: `backend_py/tests/test_draft_rules.py` covers
  `test_d1b_methodist_outpatient_fortnight_is_not_inpatient_backup`.
- Implementation: `generateDraft` / `proposeSchedule` exclude Methodist outpatient-phase rotators
  from fair-fill eligibility before any swap-repair can reuse them.

---

# Appendix — where things live (architecture map)

| Concern | File(s) |
|---|---|
| Main UI shell + all pages (monolith, 5,146 lines) | `src/App.jsx` |
| Nav order / page list | `shared/scheduler/scheduler.js:27` (`PAGES`), `src/App.jsx:115,247` |
| Core scheduler logic (2,533 lines) | `shared/scheduler/scheduler.js` |
| Program-rule dispatch (the solver seam) | `shared/scheduler/program-rules.js` |
| Classification | `inferSchoolType` / `classifyRotator` (`scheduler.js:97,1870`) |
| Methodist 14/14 | `applyMethodistAutoAssign`, `getRotatorPhase` (`scheduler.js:1921-2400`) |
| Pre-assignment fill | `applyPreassignments` (`scheduler.js:1987`) |
| OP placeholder constants | `scheduler.js:18-19` |
| Clinic synthesis / the phantom filter | `shared/scheduler/clinic-selectors.js:41` (`isRealClinicName`) |
| Service assignment helpers | `shared/scheduler/service-assignments.js` |
| Validation / conflicts | `shared/scheduler/clinic-validation.js` |
| Staffing counts / heatmap | `scheduler.js:1298`, `shared/scheduler/heatmap.js` |
| Outpatient session schema (multi-clinic `details[]`) | `shared/contracts/v1/outpatient-session.js` |
| Poster PDF exports | `src/clinicPosterPdf.js`, `shared/scheduler/poster-weeks.js` |
| Final read-only schedules | `src/components/{inpatient,outpatient,clinics}/` |
| Excel import | `shared/scheduler/excel-import.js`, `SourcesPage` (`src/App.jsx:684`) |

---

*Generated 2026-05-31 from the 05-29 transcript, 9 screenshots, the export-design chat, and
the scheduling-rules spec. Code references verified against the working tree at commit
`0d4b0d0`.*
