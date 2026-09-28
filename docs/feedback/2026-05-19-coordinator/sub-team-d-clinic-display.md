# Inpatient Calendar — Inline Continuity-Clinic AM/PM Indicator

## 1. Team structure
Single-Lead pass (work was small enough that full ceremony was overhead).
- lead/implementer — parser, calendar wiring, CSS, test
- self-critic — challenged design (multiple rotators, malformed input, color-only signaling, mobile)
- self-verifier — `npm run test`, `npm run test:offline`, `npm run build`

Three roles collapsed into one pass because the change touches a single render path and one helper; spawning parallel agents would have added coordination overhead without expanding the search space.

## 2. Result

### What ships
On the Inpatient Calendar, every day cell that has any active rotator with a continuity-clinic commitment for that weekday now shows a small pill at the bottom of the cell: `AM clinic` and/or `PM clinic`. Hovering the pill reveals the provider name(s) via the native `title` tooltip (e.g. "PM continuity clinic: Noah Patel, Maya Lopez").

### Files changed
- `src/scheduler.js` — added two exported helpers:
  - `parseContinuityClinic(str): { weekday, period } | null` — defensive parser, tolerates case/whitespace/either-ordering ("Tuesday PM", "pm tue", "Monday afternoon"), returns null on empty / malformed / missing-half input.
  - `continuityClinicsForDate(state, date): { AM: Rotator[], PM: Rotator[] }` — filters rotators by parsed weekday + active block window, grouped by period.
- `src/App.jsx`
  - Imported `continuityClinicsForDate`.
  - Extended `CalendarGrid` with an optional `renderBadges(date)` prop (additive; other CalendarGrid callers unaffected).
  - Added `ContinuityClinicBadges` component used only by the Inpatient Calendar.
- `src/styles.css` — new classes: `.clinic-strip`, `.clinic-chip`, `.clinic-chip-am`, `.clinic-chip-pm`. Includes dark-mode overrides.
- `src/scheduler.test.js` — two new vitest cases (parser + per-date roll-up).

### Design choice (justify for Coordinator)
Chose a labeled pill (`AM clinic` / `PM clinic`) over an unlabeled colored stripe. Reasoning: Coordinator's non-negotiable #2 is "indicate AM vs PM". A stripe alone forces the viewer to remember a color legend; a 2-word pill is self-describing at a glance and accessible to anyone who can't distinguish the two warm/cool tones. The pill is muted (low-saturation amber for AM, low-saturation indigo for PM, both with rounded `999px` corners and small `0.7rem` text), placed at the bottom of the cell so it doesn't crowd the assignment names at the top. Tooltip carries the "who", keeping the cell uncluttered even with multiple providers.

Trade-off: pill + label takes slightly more horizontal space than a stripe. At 120px min cell width with two assignments + two pills, layout still fits because the strip wraps with `flex-wrap: wrap`. Verified visually via the calendar at 92px min cell height.

### Verification
- `npm run test` — 6/6 vitest pass (4 prior + 2 new).
- `npm run test:offline` — 4/4 node tests pass.
- `npm run build` — clean, 1.18s, no warnings beyond the pre-existing chunk-size note.

## 3. Critical review
- **Major objections raised:**
  - "What if `continuityClinic` is malformed?" — parser returns `null` and the cell renders nothing extra; verified with `parseContinuityClinic("nonsense")` and null/undefined inputs.
  - "What if 5 rotators share a Tuesday-PM clinic?" — pill text stays constant ("PM clinic"); names accumulate in the tooltip. No visual blow-up.
  - "Color-only signaling?" — rejected stripe-only; the pill carries text so color is reinforcement, not the sole channel.
  - "Should this filter to only rotators currently assigned inpatient that day?" — No. Coordinator's framing ("we will be down a person") is about the recurring pattern, not the current inpatient assignment; the badge should appear even on days where the clinic-holding rotator isn't on inpatient yet. Filtered instead by active block window (`startDate <= date <= endDate`) so we don't show badges for rotators who aren't even on service.
  - "Mobile-friendliness?" — `.clinic-strip` uses `flex-wrap`, pills shrink-wrap; the calendar grid is already `overflow: auto`, so narrow viewports scroll horizontally rather than crushing the cells.
- **What changed:** Initial sketch used an unlabeled top-stripe; revised to labeled bottom pill after the AM/PM-specificity objection.
- **Remaining uncertainty / risk:**
  - Multi-week visibility: if a rotator's `endDate` falls in the middle of the block, the badge correctly disappears past their end. Not yet shown to a real user.
  - Internationalization: weekday detection uses English names (matches the rest of the app's text). If a future user enters "martes PM", parser returns null silently. Acceptable for now; Coordinator's data is English.
  - Tooltip-only "who": touch devices have no hover. If Coordinator wants the names visible on tap, follow-up should add a click-to-expand. Flagged but not implemented — would clutter the "nice and clean" requirement.

## 4. Codex usage
None. Mechanical scope was small; direct edits were faster than handing to Codex.

## Brokering candidates for other sub-teams
- `parseContinuityClinic(str)` in `src/scheduler.js` — exported. Sub-team-b/c can reuse if they need to interpret `rotator.continuityClinic` (e.g. for conflict detection on continuity-clinic days).
- `continuityClinicsForDate(state, date)` in `src/scheduler.js` — exported. Useful for any per-day roll-up (Daily Report could ingest this; Conflicts page could flag inpatient assignments that collide with the rotator's own continuity clinic).
- CSS class names introduced: `.clinic-strip`, `.clinic-chip`, `.clinic-chip-am`, `.clinic-chip-pm`. If another team wants to surface the same indicator elsewhere (Daily Report, Conflicts list), reuse the chip classes for visual consistency.
- `CalendarGrid` now accepts an optional `renderBadges(date)` prop. Sub-teams adding other per-day overlays (holidays, conflict counts) can hang them off the same hook.

## Commit
See git log on `HEAD`. Commit message: `inpatient: surface AM/PM continuity clinic on calendar cells`.
