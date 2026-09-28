// Tests for shared/scheduler/paint-selection.js. Pure reducer + a
// contiguous-runs helper. Both are pure JS — no DOM, no React — so
// they're directly unit-testable via vitest + node:test.

import { describe, expect, it } from "vitest";
import {
  initialPaintState,
  paintReducer,
  selectionToContiguousRuns
} from "./paint-selection.js";

describe("paintReducer", () => {
  it("returns initial state when reducing initialPaintState with an unknown action", () => {
    const next = paintReducer(initialPaintState, { type: "weird-action" });
    expect(next).toBe(initialPaintState);
  });

  it("'down' snapshots mode and seeds selection with the starting date", () => {
    const next = paintReducer(initialPaintState, { type: "down", date: "2026-05-04", mode: "IP" });
    expect(next.isDragging).toBe(true);
    expect(next.mode).toBe("IP");
    expect([...next.selected]).toEqual(["2026-05-04"]);
  });

  it("'enter' adds a cell to the active selection", () => {
    let state = paintReducer(initialPaintState, { type: "down", date: "2026-05-04", mode: "OP" });
    state = paintReducer(state, { type: "enter", date: "2026-05-05" });
    state = paintReducer(state, { type: "enter", date: "2026-05-06" });
    expect([...state.selected].sort()).toEqual(["2026-05-04", "2026-05-05", "2026-05-06"]);
    expect(state.mode).toBe("OP");
  });

  it("'enter' is a no-op when not dragging", () => {
    const next = paintReducer(initialPaintState, { type: "enter", date: "2026-05-04" });
    expect(next).toBe(initialPaintState);
  });

  it("mid-drag mode changes do NOT corrupt the snapshotted mode", () => {
    // The spike specifically verified this. Once 'down' fires with
    // mode=IP, every subsequent 'enter' inherits IP — even if the
    // upstream UI flips the radio.
    let state = paintReducer(initialPaintState, { type: "down", date: "2026-05-04", mode: "IP" });
    state = paintReducer(state, { type: "enter", date: "2026-05-05" });
    // No reducer action can change `mode` mid-drag. The only way to
    // change mode is to release (up/cancel) and start a new 'down'.
    expect(state.mode).toBe("IP");
  });

  it("'up' clears state — ready for the next drag", () => {
    let state = paintReducer(initialPaintState, { type: "down", date: "2026-05-04", mode: "IP" });
    state = paintReducer(state, { type: "enter", date: "2026-05-05" });
    const final = paintReducer(state, { type: "up" });
    expect(final.isDragging).toBe(false);
    expect(final.selected.size).toBe(0);
    expect(final.mode).toBe(null);
  });

  it("'cancel' clears state too", () => {
    let state = paintReducer(initialPaintState, { type: "down", date: "2026-05-04", mode: "IP" });
    const final = paintReducer(state, { type: "cancel" });
    expect(final.isDragging).toBe(false);
    expect(final.selected.size).toBe(0);
  });

  it("pointer-leave-then-resume preserves selection (no leave action)", () => {
    // The DOM glue should stop firing 'enter' while the pointer is
    // outside the grid, but the reducer holds the in-flight state
    // until 'up' fires. Verified by the spike at
    // /tmp/team-planning-EzabSPRU/paint-tool/spike/.
    let state = paintReducer(initialPaintState, { type: "down", date: "2026-05-04", mode: "IP" });
    state = paintReducer(state, { type: "enter", date: "2026-05-05" });
    // ... pointer leaves the grid: glue stops firing 'enter' ...
    // ... pointer re-enters: glue resumes 'enter' ...
    state = paintReducer(state, { type: "enter", date: "2026-05-06" });
    expect([...state.selected].sort()).toEqual(["2026-05-04", "2026-05-05", "2026-05-06"]);
    expect(state.isDragging).toBe(true);
  });
});

describe("selectionToContiguousRuns", () => {
  it("returns [] on empty selection", () => {
    expect(selectionToContiguousRuns(new Set())).toEqual([]);
  });

  it("groups a single contiguous weekday run", () => {
    // Mon-Fri 2026-05-04 through 2026-05-08
    const dates = new Set(["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"]);
    expect(selectionToContiguousRuns(dates)).toEqual([
      { start: "2026-05-04", end: "2026-05-08" }
    ]);
  });

  it("treats Fri→Mon as contiguous (weekend doesn't break the run)", () => {
    // Mon 2026-05-04 + Fri 2026-05-08 + Mon 2026-05-11 all on weekdays.
    // No actual gap = continuous run from Mon-Mon via the next-weekday rule.
    const dates = new Set(["2026-05-08", "2026-05-11"]);
    expect(selectionToContiguousRuns(dates)).toEqual([
      { start: "2026-05-08", end: "2026-05-11" }
    ]);
  });

  it("breaks runs on a missing weekday in the middle", () => {
    // Mon, Tue, Thu — Wed is missing → two runs.
    const dates = new Set(["2026-05-04", "2026-05-05", "2026-05-07"]);
    expect(selectionToContiguousRuns(dates)).toEqual([
      { start: "2026-05-04", end: "2026-05-05" },
      { start: "2026-05-07", end: "2026-05-07" }
    ]);
  });

  it("handles a single-day selection", () => {
    const dates = new Set(["2026-05-04"]);
    expect(selectionToContiguousRuns(dates)).toEqual([
      { start: "2026-05-04", end: "2026-05-04" }
    ]);
  });

  // ---- contract v2: weekend-aware flag (IP/OFF paints include Sat/Sun) ----

  it("default (OP intent) breaks a run on an included weekend day", () => {
    // Fri 5/08, Sat 5/09, Sun 5/10, Mon 5/11 — without includeWeekends the
    // Sat/Sun are not consecutive WEEKDAYS, so Sat and Sun become their own
    // single-day runs. (OP paints should never reach Sat/Sun, but if they
    // are in the set this is the documented weekday-only grouping.)
    const dates = new Set(["2026-05-08", "2026-05-09", "2026-05-10", "2026-05-11"]);
    expect(selectionToContiguousRuns(dates)).toEqual([
      { start: "2026-05-08", end: "2026-05-08" }, // Fri (Fri->Sat not next weekday)
      { start: "2026-05-09", end: "2026-05-09" }, // Sat
      { start: "2026-05-10", end: "2026-05-11" }  // Sun->Mon is next weekday
    ]);
  });

  it("includeWeekends:true (IP/OFF intent) keeps a run spanning Sat/Sun", () => {
    const dates = new Set(["2026-05-08", "2026-05-09", "2026-05-10", "2026-05-11"]);
    expect(selectionToContiguousRuns(dates, { includeWeekends: true })).toEqual([
      { start: "2026-05-08", end: "2026-05-11" }
    ]);
  });

  it("includeWeekends:true still breaks on a true calendar gap", () => {
    // Sat 5/09, Sun 5/10, then skip Mon 5/11, resume Tue 5/12 → two runs.
    const dates = new Set(["2026-05-09", "2026-05-10", "2026-05-12"]);
    expect(selectionToContiguousRuns(dates, { includeWeekends: true })).toEqual([
      { start: "2026-05-09", end: "2026-05-10" },
      { start: "2026-05-12", end: "2026-05-12" }
    ]);
  });

  it("back-compat: passing no options behaves exactly as the weekday-only original", () => {
    const dates = new Set(["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"]);
    expect(selectionToContiguousRuns(dates)).toEqual([{ start: "2026-05-04", end: "2026-05-08" }]);
  });
});
