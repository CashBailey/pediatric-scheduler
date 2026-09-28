import { afterEach, describe, it, expect, vi } from "vitest";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { makeRotator } from "../shared/scheduler/scheduler.js";
import { InpatientSchedule } from "./components/inpatient/InpatientSchedule.jsx";

const h = React.createElement;

// One-day block so the heatmap has exactly one cell to assert on.
const DATE = "2026-05-04";
const BLOCK = { id: "b", startDate: DATE, endDate: DATE, holidays: [] };

afterEach(cleanup);

function rotator(id) {
  return makeRotator(id, id, "UT Pediatrics", "PGY-2", [{ start: "2026-05-01", end: "2026-05-31" }]);
}

function stateWith(ip = [], op = []) {
  return {
    version: 2,
    activeBlockId: "b",
    serviceBlocks: [BLOCK],
    rotators: [rotator("a"), rotator("b"), rotator("c"), rotator("d"), rotator("e")],
    attendings: [],
    inpatientAssignments: ip.map((rid) => ({ date: DATE, rotatorId: rid, role: "Resident" })),
    outpatientSessions: op.map((rid) => ({ date: DATE, period: "AM", clinic: "", rotatorId: rid })),
    clinicAssignments: [],
    rules: {},
    notes: []
  };
}

function renderSched(state) {
  return render(h(InpatientSchedule, { state, block: BLOCK, conflicts: [], setNotice: vi.fn() }));
}

function cell(container) {
  return container.querySelector(".ip-sched-heat-cell");
}

describe("InpatientSchedule heatmap", () => {
  it("counts a double-booked ('both') rotator as inpatient (B2)", () => {
    // 4 pure-inpatient + 1 both(IP+OP) = 5 on inpatient → surplus
    const { container } = renderSched(stateWith(["a", "b", "c", "d", "e"], ["e"]));
    const c = cell(container);
    expect(c.textContent).toContain("5 IP");
    expect(c.className).toContain("ip-sched-tone-surplus");
  });

  it("applies the critical tone at 1 inpatient", () => {
    const { container } = renderSched(stateWith(["a"]));
    const c = cell(container);
    expect(c.textContent).toContain("1 IP");
    expect(c.className).toContain("ip-sched-tone-critical");
  });

  it("applies the full tone at exactly 4 inpatient", () => {
    const { container } = renderSched(stateWith(["a", "b", "c", "d"]));
    const c = cell(container);
    expect(c.textContent).toContain("4 IP");
    expect(c.className).toContain("ip-sched-tone-full");
  });
});
