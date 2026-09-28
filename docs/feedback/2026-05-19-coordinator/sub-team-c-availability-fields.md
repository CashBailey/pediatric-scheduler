# sub-team-c deliverable — Day off + Unavailable date range (Coordinator #4, #5)

## Branch / commit
- Branch: `sub-team-c-availability`
- Worktree: `/tmp/team-multi-qxrkVsvL/sub-team-c/worktree`
- Commit: **`f4a7023`** roster: add day off and time-off ranges per rotator
- Based on: `c751bf0` (main)

## Mandatory field contract (for other sub-teams)
Both fields added to `makeRotator()` in `src/scheduler.js` with empty-array defaults so old persisted states still work:

```js
dayOff: string[]                                       // e.g. ["Tuesday"], ["Monday","Friday"], or []
unavailableRanges: Array<{ start: string, end: string }> // YYYY-MM-DD inclusive both ends; stackable; [] = none
```

`continuityClinic` was preserved untouched (sub-team-d dependency).

## What was built

### `src/scheduler.js`
- Added `WEEKDAYS` constant (Sunday-first, matches `Date.getDay()`).
- Extended `makeRotator()` with `dayOff: []` and `unavailableRanges: []`.
- Added helpers:
  - `weekdayName(dateStr)` → "Monday" etc.
  - `isRotatorUnavailable(rotator, dateStr)` → `null` | `{ reason: "day-off"|"range", label }`. Tolerates missing fields (legacy states).
  - `updateRotator(state, rotatorId, patch)` → immutable rotator patch helper.
- Extended `detectConflicts()`: new conflict type **`rotator-unavailable`** (severity `Critical`) for any inpatient assignment that falls on a rotator's day-off weekday or inside an unavailable range. Conflicts page renders it automatically because it uses the standard `{ id, severity, type, date, title, detail, status }` shape.

### `src/App.jsx` — RosterPage ("Who's On Pedi" tab)
- Roster table gained two columns: **Day off**, **Time off**.
- New "Availability per rotator" panel with one `AvailabilityEditor` card per rotator:
  - Weekday checkboxes (Sunday–Saturday) for `dayOff`.
  - Stackable date-range rows for `unavailableRanges` with "Add time-off range" and per-row "Remove" buttons.
  - Each new range pre-fills with the rotator's `startDate` so the date inputs are valid immediately.
- Imports `updateRotator`, `WEEKDAYS` from scheduler.
- All copy is plain English (matches commit `c751bf0` tone): "Day off each week", "Time off (date ranges)", "Add time-off range", helper paragraph naming vacation/conference/family leave.

### `src/scheduler.test.js`
- Imports new helpers.
- Added 2 tests:
  - Defaults: every seeded rotator has empty `dayOff` and `unavailableRanges` arrays.
  - Conflict rule: inpatient on a Monday day-off produces `rotator-unavailable`; range-based absence also produces it; `isRotatorUnavailable` returns the right reason/null for in/out-of-range dates.

## Verification
- `npx vitest run` → **6 passed / 6** (was 4; +2 new cases). All originally-passing scheduler tests still pass.
- `npm run build` → clean, builds in ~0.8s, output 224 kB / 70 kB gzip.
- `npm run test:offline` → 1 pre-existing failure about `pedi-scheduler-react-docker-linux-amd64.tar.gz` missing from the release dir. Verified by stashing my changes that this failure exists on baseline `c751bf0`. **Not introduced by sub-team-c.**

## Critic checks addressed
- **Overlapping ranges**: stored as-is; `isRotatorUnavailable` short-circuits on first match. No dedup needed for correctness — duplicates only produce identical conflict ids that the conflicts list de-dups by id naturally (same `conflict-unavailable-<date>-<rotator>`).
- **Range spanning a block boundary**: comparison is pure string compare on `YYYY-MM-DD`, so ranges that extend before/after the block still flag any inpatient day inside them. They simply have no effect outside the block because there are no assignments there.
- **Day off on a weekend**: allowed (Coordinator said "Monday–Sunday"). No assignments typically exist on weekends, so it's a harmless no-op then; if one does exist, it correctly flags.
- **Day off == continuity clinic day**: this is a roster-level concern, not an inpatient conflict. We chose not to flag it here because (a) the user's request scoped this to *inpatient* unavailability, and (b) outpatient/continuity scheduling lives elsewhere. The two columns are shown side-by-side in the roster table so the user can spot the overlap visually. Flagged below as a brokering candidate.

## Brokering candidates for Meta-Lead
1. **New conflict type id**: `rotator-unavailable` (severity `Critical`). If sub-team-b's Excel ingest or sub-team-d's continuity-clinic work wants a constants file, this name + `double-booked` + `holiday-clinic` should be unified.
2. **Helper to reuse**: `isRotatorUnavailable(rotator, dateStr)` is exported. Sub-team-d (continuity clinic logic) and any future outpatient/auto-scheduler work should call this instead of recomputing weekday/range logic. Also exported: `weekdayName`, `WEEKDAYS`, `updateRotator`.
3. **Sub-team-b (Excel ingest)**: if the spreadsheet has day-off / time-off columns, populate using exactly `dayOff: string[]` of full weekday names matching `WEEKDAYS` and `unavailableRanges: [{start,end}]` with `YYYY-MM-DD`. Empty arrays are safe defaults.
4. **Possible follow-up (NOT done)**: flag outpatient sessions that conflict with a rotator's day-off (e.g., Monday continuity clinic for a rotator whose day off is Monday). Out of scope for Coordinator request #4/#5 as worded, but a natural extension — left for Meta-Lead to schedule.

## Summary (3–5 sentences)
Added two optional rotator fields (`dayOff: string[]` and stackable `unavailableRanges: [{start,end}]`) wired through the data model, the "Who's On Pedi" tab UI, and conflict detection. The RosterPage now shows two new roster columns and a per-rotator AvailabilityEditor with Sunday–Saturday checkboxes plus add/remove date-range rows. `detectConflicts` produces a new `rotator-unavailable` Critical conflict whenever an inpatient assignment lands on a day-off weekday or inside an unavailable range, surfaced automatically on the Conflicts page. All six scheduler tests pass (two new), `npm run build` is clean, and `continuityClinic` is untouched per the sub-team-d contract.
