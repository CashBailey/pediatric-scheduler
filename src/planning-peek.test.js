// Render-level verification of the "Peek past block end" feature (Coordinator's
// cross-block continuity ask). The 289 existing tests verify the date-math
// helper + code paths but NEVER render the Planning Grid, so AC1 (no next
// block → 14 peek days) and AC3 (peek columns visually marked) are unproven
// at the DOM level. This file mounts PlanningGridPage and asserts on the
// rendered <th class="planning-datehead ..."> day-column headers.
//
// Uses React.createElement (no JSX) so the file stays a plain *.test.js
// matched by vite.config's include glob — same pattern as import-preview.test.js.
//
// NOTE: requires `export` on `function PlanningGridPage(` in src/App.jsx
// (it is not exported by default). If the Lead has not added it, the import
// below resolves to undefined and render() throws "Element type is invalid",
// which is the reported blocker.
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { PlanningGridPage } from "./App.jsx";
import { createInitialState, makeRotator } from "../shared/scheduler/scheduler.js";

afterEach(cleanup);

// D = the (only/last) block's end date. Peek-on with NO next block should add
// columns for D+1 .. D+14 (PEEK_BUFFER_DAYS = 14), computed via addDaysToIso
// (UTC-safe). For D = 2026-07-31 that is 2026-08-01 .. 2026-08-14.
const BLOCK_START = "2026-07-01";
const BLOCK_END = "2026-07-31";
const EXPECTED_PEEK_DATES = [
  "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04",
  "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08",
  "2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12",
  "2026-08-13", "2026-08-14"
];
const EXPECTED_PRIOR_PEEK_DATES = [
  "2026-06-17", "2026-06-18", "2026-06-19", "2026-06-20",
  "2026-06-21", "2026-06-22", "2026-06-23",
  "2026-06-24", "2026-06-25", "2026-06-26", "2026-06-27",
  "2026-06-28", "2026-06-29", "2026-06-30"
];

// A state with exactly one service block (ending on D) and one rotator whose
// segment spans the block — so buildPlanningGrid yields >0 rows (otherwise the
// component short-circuits to an empty state with no table).
function singleBlockState() {
  const base = createInitialState();
  const block = {
    id: "block-jul-2026",
    name: "July 2026 Pediatric Neurology",
    startDate: BLOCK_START,
    endDate: BLOCK_END,
    status: "Draft",
    generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
    holidays: []
  };
  return {
    ...base,
    activeBlockId: block.id,
    serviceBlocks: [block],
    rotators: [
      makeRotator("rot-peek-1", "Maya Lopez", "Methodist", "PGY-3", [
        { start: BLOCK_START, end: BLOCK_END }
      ])
    ]
  };
}

// Two ADJACENT blocks: block A (the active one) ends on D, block B starts the
// next day and ends 2026-08-31. The neighboring block must not widen the fixed
// 14-day context window, per AC2.
function twoBlockState() {
  const s = singleBlockState();
  const blockB = {
    id: "block-aug-2026",
    name: "August 2026 Pediatric Neurology",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "Draft",
    generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
    holidays: []
  };
  return { ...s, serviceBlocks: [s.serviceBlocks[0], blockB] };
}

function renderGrid(state) {
  const block = state.serviceBlocks.find((b) => b.id === state.activeBlockId);
  return render(
    React.createElement(PlanningGridPage, {
      state,
      block,
      updateState: () => {}
    })
  );
}

// All day-column header dates, in render order, read off the `title` attribute
// (carries the raw ISO date — "<date>" for in-block, "<date> — beyond this
// block" for peek days — so we strip at the em dash).
function headDates(container) {
  return [...container.querySelectorAll("th.planning-datehead")].map(
    (th) => (th.getAttribute("title") || "").split(" — ")[0]
  );
}

function peekDates(container) {
  return [...container.querySelectorAll("th.planning-datehead-peek")].map(
    (th) => (th.getAttribute("title") || "").split(" — ")[0]
  );
}

function findPeekToggle(getByLabelText) {
  // Label text varies by next-block presence; match the stable prefix. The
  // <input> is nested in the <label>, so getByLabelText returns the checkbox.
  return getByLabelText(/Peek past block end/);
}

function findPriorPeekToggle(getByLabelText) {
  return getByLabelText(/Peek before block start/);
}

// Rotator-name row headers (one per rendered grid row). Each row's name is in a
// <th class="planning-rowhead-draggable">{displayName}</th> (DraggableRotatorHeader),
// distinct from the corner "Rotator" header and the tfoot total headers.
function rowNames(container) {
  return [...container.querySelectorAll("th.planning-rowhead-draggable")].map(
    (th) => th.textContent.trim()
  );
}

// Two ADJACENT blocks where a rotator is active ONLY in the next block's window
// (no segment touching the active block). Used to prove the onlyThisBlock roster
// filter stays pinned to the RAW block even when peek extends the columns.
function nextBlockOnlyRotatorState() {
  const s = twoBlockState();
  return {
    ...s,
    rotators: [
      // (a) active in the ACTIVE block (Jul) — should appear.
      makeRotator("rot-inblock", "Maya Lopez", "Methodist", "PGY-3", [
        { start: BLOCK_START, end: BLOCK_END }
      ]),
      // (b) active ONLY in the NEXT block (Aug) — must NOT appear with the
      // default onlyThisBlock filter on, even with peek extending the columns.
      makeRotator("rot-nextonly", "Noah Patel", "UT Adult Neuro", "PGY-2", [
        { start: "2026-08-05", end: "2026-08-20" }
      ])
    ]
  };
}

// Two blocks whose "next" (by startDate) ends EARLIER than the active block —
// misordered/overlapping data. effectiveBlock still uses the same 14-day
// window rather than collapsing dateRange(start, earlierEnd).
function misorderedNextBlockState() {
  const s = singleBlockState(); // active block: 2026-07-01..2026-07-31
  const earlierEndingNext = {
    id: "block-bad-next",
    name: "Misordered partial block",
    startDate: "2026-07-10", // sorts AFTER active block start → picked as nextBlock
    endDate: "2026-07-20",   // but ends BEFORE the active block's end (D)
    status: "Draft",
    generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
    holidays: []
  };
  return { ...s, serviceBlocks: [s.serviceBlocks[0], earlierEndingNext] };
}

describe("Planning Grid — Peek past block end", () => {
  it("default off: no peek columns, headers cover only the block (AC: default unchanged)", () => {
    const { container } = renderGrid(singleBlockState());
    const before = headDates(container);
    // Block 2026-07-01..2026-07-31 = 31 day columns, none peeked.
    expect(before[0]).toBe(BLOCK_START);
    expect(before[before.length - 1]).toBe(BLOCK_END);
    expect(before).toHaveLength(31);
    expect(peekDates(container)).toEqual([]);
    expect(container.querySelectorAll("th.planning-datehead-peek-start")).toHaveLength(0);
  });

  it("AC1: no next block → peek adds 14 day columns past D (D+1..D+14)", () => {
    const { container, getByLabelText } = renderGrid(singleBlockState());
    const before = headDates(container);
    fireEvent.click(findPeekToggle(getByLabelText));
    const after = headDates(container);

    // 14 columns added, all beyond D.
    expect(after.length - before.length).toBe(14);
    const added = after.slice(before.length);
    expect(added).toEqual(EXPECTED_PEEK_DATES);

    // The added columns carry .planning-datehead-peek; in-block columns do not.
    const peeked = peekDates(container);
    expect(peeked).toEqual(EXPECTED_PEEK_DATES);
    // Every in-block header (<= D) must NOT be peek-classed.
    const inBlockPeeked = [...container.querySelectorAll("th.planning-datehead-peek")].filter(
      (th) => (th.getAttribute("title") || "").split(" — ")[0] <= BLOCK_END
    );
    expect(inBlockPeeked).toHaveLength(0);
  });

  it("prior context: peek adds 14 read-only day columns before block start", () => {
    const { container, getByLabelText } = renderGrid(singleBlockState());
    const before = headDates(container);
    fireEvent.click(findPriorPeekToggle(getByLabelText));
    const after = headDates(container);

    expect(after.length - before.length).toBe(14);
    expect(after.slice(0, 14)).toEqual(EXPECTED_PRIOR_PEEK_DATES);
    expect(after[14]).toBe(BLOCK_START);
    expect(peekDates(container)).toEqual(EXPECTED_PRIOR_PEEK_DATES);

    const cells = [...container.querySelectorAll("td.planning-cell[data-date]")];
    const readonlyDates = cells
      .filter((td) => td.classList.contains("planning-cell-peek-readonly"))
      .map((td) => td.getAttribute("data-date"));
    expect([...new Set(readonlyDates)].sort()).toEqual(EXPECTED_PRIOR_PEEK_DATES);
  });

  it("AC3: exactly the post-D columns are marked peek; first one is peek-start", () => {
    const { container, getByLabelText } = renderGrid(singleBlockState());
    fireEvent.click(findPeekToggle(getByLabelText));

    // Exactly the post-D columns are peek-classed.
    expect(peekDates(container)).toEqual(EXPECTED_PEEK_DATES);

    // Exactly one peek-start, and it is the first post-D column (D+1).
    const starts = [...container.querySelectorAll("th.planning-datehead-peek-start")];
    expect(starts).toHaveLength(1);
    expect((starts[0].getAttribute("title") || "").split(" — ")[0]).toBe(EXPECTED_PEEK_DATES[0]);
    // peek-start is also a peek column.
    expect(starts[0].classList.contains("planning-datehead-peek")).toBe(true);
  });

  it("AC2: next block defined → peek still stops after 14 days", () => {
    const { container, getByLabelText } = renderGrid(twoBlockState());
    const before = headDates(container);
    expect(before[before.length - 1]).toBe(BLOCK_END); // off: ends at block A's D
    fireEvent.click(findPeekToggle(getByLabelText));
    const after = headDates(container);

    // The long neighboring block does not widen the two-week window.
    expect(after[after.length - 1]).toBe("2026-08-14");
    // All post-D columns (2026-08-01..08-14 = 14 days) are peek-marked.
    const peeked = peekDates(container);
    expect(peeked[0]).toBe("2026-08-01");
    expect(peeked[peeked.length - 1]).toBe("2026-08-14");
    expect(peeked).toHaveLength(14);
    // Exactly one peek-start, at the first post-D column.
    const starts = [...container.querySelectorAll("th.planning-datehead-peek-start")];
    expect(starts).toHaveLength(1);
    expect((starts[0].getAttribute("title") || "").split(" — ")[0]).toBe("2026-08-01");
  });

  // #1 (critic fix): the "Only show providers active in this block" roster
  // filter must key on the RAW block, not the extended effectiveBlock — so
  // turning peek on extends the COLUMNS but never surfaces people who are
  // active solely in the next block. This is the headline-intent guard.
  it("#1: roster stays pinned to the raw block when peek is ON (next-block-only rotator hidden)", () => {
    const { container, getByLabelText } = renderGrid(nextBlockOnlyRotatorState());

    // Default (peek off, onlyThisBlock on): only the in-block rotator shows.
    expect(rowNames(container)).toEqual(["Maya Lopez"]);

    // Turn peek ON — columns extend through Aug, but the roster must NOT grow.
    fireEvent.click(findPeekToggle(getByLabelText));

    const names = rowNames(container);
    expect(names).toContain("Maya Lopez");       // in-block rotator still shown
    expect(names).not.toContain("Noah Patel");    // next-block-only rotator NOT surfaced
    expect(names).toEqual(["Maya Lopez"]);        // roster unchanged by the peek toggle
  });

  // #2 (critic fix): RangeAssignForm's reset effect now keys on block.id (not
  // its dates), so toggling peek — which keeps the same block id and only
  // extends the end — must NOT clobber a From/To range the user is composing.
  it("#2: a typed To-date survives a peek toggle (reset keyed on block.id, not dates)", () => {
    const { container, getByLabelText } = renderGrid(twoBlockState());

    // The From/To date inputs live in RangeAssignForm (rendered inside the grid).
    const dateInputs = [...container.querySelectorAll('input[type="date"]')];
    expect(dateInputs).toHaveLength(2); // From, To
    const toInput = dateInputs[1];

    // Default To is the block's end. Type a custom mid-block value.
    expect(toInput.value).toBe(BLOCK_END);
    const CUSTOM_TO = "2026-07-15";
    fireEvent.change(toInput, { target: { value: CUSTOM_TO } });
    expect(toInput.value).toBe(CUSTOM_TO);

    // Toggle peek ON — same block id, extended end. Must not reset the input.
    fireEvent.click(findPeekToggle(getByLabelText));
    const toAfter = [...container.querySelectorAll('input[type="date"]')][1];
    expect(toAfter.value).toBe(CUSTOM_TO);

    // And toggling it back OFF likewise preserves the typed value.
    fireEvent.click(findPeekToggle(getByLabelText));
    expect([...container.querySelectorAll('input[type="date"]')][1].value).toBe(CUSTOM_TO);
  });

  // #4 (critic fix): when the "next" block (by startDate) ends EARLIER than the
  // active block, effectiveBlock must retain the fixed 14-day window instead
  // of collapsing the grid to dateRange(start, earlierEnd). Peek-on must show
  // MORE days (block + 14), never fewer.
  it("#4: misordered next block retains the 14-day window (grid does not collapse)", () => {
    const { container, getByLabelText } = renderGrid(misorderedNextBlockState());

    const before = headDates(container);
    expect(before[0]).toBe(BLOCK_START);
    expect(before[before.length - 1]).toBe(BLOCK_END); // peek-off: full active block
    expect(before).toHaveLength(31);

    fireEvent.click(findPeekToggle(getByLabelText));
    const after = headDates(container);

    // Did NOT collapse — still has all in-block days plus the 14-day buffer.
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.length).toBe(before.length + 14);
    expect(after[0]).toBe(BLOCK_START);
    expect(after.slice(before.length)).toEqual(EXPECTED_PEEK_DATES); // 2026-08-01..08-14
    // Buffer columns are peek-marked; the misordered next block's end was ignored.
    expect(peekDates(container)).toEqual(EXPECTED_PEEK_DATES);
  });

  // View-only policy (product decision): peek-day cells are visible + tinted but
  // NOT editable — no paint/drag/range-assign. PlanningCell tags read-only cells
  // with `planning-cell-peek-readonly` (which also disables the droppable and
  // paint handlers); in-block cells stay interactive (no such class).
  it("view-only: peek-day cells are read-only, in-block cells are not", () => {
    const { container, getByLabelText } = renderGrid(singleBlockState());

    // Peek off: no read-only cells at all.
    expect(container.querySelectorAll("td.planning-cell-peek-readonly")).toHaveLength(0);

    fireEvent.click(findPeekToggle(getByLabelText));

    const cells = [...container.querySelectorAll("td.planning-cell[data-date]")];
    expect(cells.length).toBeGreaterThan(0);
    const readonlyDates = [];
    for (const td of cells) {
      const date = td.getAttribute("data-date");
      const isReadOnly = td.classList.contains("planning-cell-peek-readonly");
      if (date > BLOCK_END) {
        expect(isReadOnly).toBe(true); // peek day → view-only
        readonlyDates.push(date);
      } else {
        expect(isReadOnly).toBe(false); // in-block day → still editable
      }
    }
    // Exactly the 14 peek days are read-only (one row of cells in this fixture).
    expect([...new Set(readonlyDates)].sort()).toEqual(EXPECTED_PEEK_DATES);
  });
});
