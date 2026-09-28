// Pure reducer for the paint-tool feature. Tracks the in-flight cell
// selection as the user drags across planning-grid cells. Decoupled
// from the DOM glue so the reducer can be tested without jsdom or
// real pointer events.
//
// Action vocabulary (matches the planning research at
// /tmp/team-planning-EzabSPRU/paint-tool/deliverable.md, refined by
// the spike at /tmp/team-planning-EzabSPRU/paint-tool/spike/):
//
//   { type: "down", date, mode }  — pointerdown on a cell. Snapshots
//                                     the mode (IP | OP) for the duration
//                                     of this drag. Mid-drag mode flips
//                                     are intentionally ignored so the
//                                     in-flight paint stays coherent.
//   { type: "enter", date }       — pointer entered a cell (drag-over).
//                                     Adds the cell to the selection.
//                                     No-op when no drag is active.
//   { type: "up" }                — pointerup. Commits the drag (caller
//                                     reads `selected` + `mode`, then
//                                     issues a reset).
//   { type: "cancel" }            — drag canceled (e.g., Esc).
//   { type: "reset" }             — reset to initial state.
//
// Note on `pointerleave`: the spike caught that this is NOT a
// separate action. Grid-exit is NOT a cancel. The DOM glue layer
// should simply STOP firing `enter` actions while the pointer is
// outside the grid; when it re-enters, `enter` resumes and the
// selection continues from where it left off. Conflating grid-exit
// with cancel would corrupt a user's in-flight paint.

export const initialPaintState = Object.freeze({
  isDragging: false,
  mode: null,            // "IP" | "OP" — snapshotted at pointerdown
  selected: new Set()    // dates (ISO strings) added by `enter` actions
});

export function paintReducer(state, action) {
  switch (action?.type) {
    case "down": {
      // Snapshot mode and start a new selection at this cell.
      if (!action.date || !action.mode) return state;
      return {
        isDragging: true,
        mode: action.mode,
        selected: new Set([action.date])
      };
    }
    case "enter": {
      // Add the cell to the selection. No-op if no drag is active or
      // the date is already selected.
      if (!state.isDragging || !action.date) return state;
      if (state.selected.has(action.date)) return state;
      const next = new Set(state.selected);
      next.add(action.date);
      return { ...state, selected: next };
    }
    case "up":
    case "cancel": {
      // Commit (caller has already read selected+mode) or abort.
      // Either way, end the drag. Selection is cleared so the next
      // `down` starts fresh.
      return initialPaintState;
    }
    case "reset": {
      return initialPaintState;
    }
    default: {
      return state;
    }
  }
}

/**
 * Group a flat set of ISO dates into runs of consecutive days, then
 * issue one applyRangeAssignment call per run.
 *
 * Weekend handling is controlled by `options.includeWeekends` (contract
 * §1e / paint-selection task):
 *   - includeWeekends:false (DEFAULT, back-compat): runs are built on the
 *     next-WEEKDAY rule — Sat/Sun are skipped, so Fri→Mon is contiguous
 *     and a Sat/Sun in the middle of the selection breaks the run. This
 *     is the behavior OP (outpatient) paints want: there are no weekend
 *     outpatient clinics, so weekend cells must never reach
 *     applyRangeAssignment as part of an OP run.
 *   - includeWeekends:true: runs are built on the next-CALENDAR-DAY rule —
 *     a run extends across Sat/Sun as consecutive days. This is the
 *     behavior IP (inpatient) and OFF paints want: inpatient is staffed
 *     every day (incl. weekends, contract §1d) and OFF can land any day,
 *     so a weekend selection must span into a single range.
 *
 * CALL CONVENTION (the UI / Workstream B passes the paint mode's intent):
 *   IP paint  -> selectionToContiguousRuns(dates, { includeWeekends: true })
 *   OFF paint -> selectionToContiguousRuns(dates, { includeWeekends: true })
 *   OP paint  -> selectionToContiguousRuns(dates)            // weekends skip
 * Existing callers that pass no options keep the original weekday-only
 * behavior unchanged.
 *
 * Returns an array of { start, end } pairs sorted ascending.
 *
 * The spike specifically verified this function's correctness against
 * pointer-leave-and-resume sequences. See findings.md in /tmp.
 */
export function selectionToContiguousRuns(dateSet, options = {}) {
  const includeWeekends = options?.includeWeekends === true;
  const dates = [...dateSet].sort();
  if (dates.length === 0) return [];

  const isContiguous = includeWeekends ? isNextCalendarDay : isNextWeekday;

  const runs = [];
  let runStart = dates[0];
  let runEnd = dates[0];

  for (let i = 1; i < dates.length; i++) {
    if (isContiguous(runEnd, dates[i])) {
      runEnd = dates[i];
    } else {
      runs.push({ start: runStart, end: runEnd });
      runStart = dates[i];
      runEnd = dates[i];
    }
  }
  runs.push({ start: runStart, end: runEnd });
  return runs;
}

/**
 * Return true if `b` is the calendar day immediately after `a` (any day,
 * including across a weekend: Fri→Sat, Sat→Sun, Sun→Mon all count).
 * Used by selectionToContiguousRuns when includeWeekends is true.
 */
function isNextCalendarDay(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const aDate = new Date(Date.UTC(ay, am - 1, ad));
  const bDate = new Date(Date.UTC(by, bm - 1, bd));
  aDate.setUTCDate(aDate.getUTCDate() + 1);
  return aDate.getTime() === bDate.getTime();
}

/**
 * Return true if `b` is the next weekday after `a` (skipping Sat/Sun).
 * Saturday → Monday counts as next. Friday → Monday also counts.
 * Used internally by selectionToContiguousRuns (default, OP paints).
 */
function isNextWeekday(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const aDate = new Date(Date.UTC(ay, am - 1, ad));
  const bDate = new Date(Date.UTC(by, bm - 1, bd));
  // Step forward day-by-day from a until we hit a weekday. That's the
  // expected next date.
  let cursor = new Date(aDate);
  for (let step = 0; step < 4; step++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const wd = cursor.getUTCDay();
    if (wd !== 0 && wd !== 6) {
      return cursor.getTime() === bDate.getTime();
    }
  }
  return false;
}
