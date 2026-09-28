import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { PlanningGridPage } from "./App.jsx";
import { createInitialState, dateRange, makeRotator } from "../shared/scheduler/scheduler.js";

afterEach(cleanup);

const BLOCK = {
  id: "block-may-2026",
  name: "May 2026 Pediatric Neurology",
  startDate: "2026-05-04",
  endDate: "2026-05-08",
  status: "Draft",
  generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
  holidays: []
};

function staffRowsState() {
  const base = createInitialState();
  const fellowAssignments = dateRange(BLOCK.startDate, BLOCK.endDate).map((date) => ({
    id: `ip-fellow-${date}`,
    date,
    rotatorId: "rot-fellow",
    role: "Fellow",
    source: "Manual"
  }));
  return {
    ...base,
    activeBlockId: BLOCK.id,
    serviceBlocks: [BLOCK],
    rotators: [
      makeRotator("rot-resident", "Bob Resident", "UT Pediatrics", "PGY-2", [
        { start: BLOCK.startDate, end: BLOCK.endDate }
      ]),
      makeRotator("rot-fellow", "Fiona Fellow", "UT Pediatrics", "Fellow", [
        { start: BLOCK.startDate, end: BLOCK.endDate }
      ])
    ],
    inpatientAssignments: fellowAssignments,
    outpatientSessions: [
      {
        id: "op-resident-stone-am",
        date: "2026-05-05",
        period: "AM",
        clinic: "Continuity Clinic",
        provider: "Dr. Stone",
        rotatorId: "rot-resident",
        status: "Scheduled"
      }
    ]
  };
}

function renderGrid(state = staffRowsState()) {
  return render(
    React.createElement(PlanningGridPage, {
      state,
      block: state.serviceBlocks[0],
      updateState: () => {}
    })
  );
}

function renderedBodyRowNames(container) {
  // Strip the decorative pinned-fellow ★ (F1) so assertions compare names only.
  return [...container.querySelectorAll("tbody tr.planning-row th.planning-rowhead")].map(
    (th) => th.textContent.trim().replace(/^★\s*/, "")
  );
}

function headerDates(container) {
  return [...container.querySelectorAll("th.planning-datehead")].map(
    (th) => (th.getAttribute("title") || "").split(" — ")[0]
  );
}

function opTotalForDate(container, date) {
  const index = headerDates(container).indexOf(date);
  const cells = [...container.querySelectorAll("tr.planning-total-op td.planning-total-cell")];
  return cells[index]?.textContent.trim();
}

describe("Planning Grid — Staff rows", () => {
  it("defaults on and pins fellows plus read-only attending projections above regular rows", () => {
    const { container, getByLabelText } = renderGrid();

    const toggle = getByLabelText("Staff rows");
    expect(toggle.checked).toBe(true);

    expect(renderedBodyRowNames(container)).toEqual([
      "Fiona Fellow",
      "Dr. Stone",
      "Bob Resident"
    ]);

    // F1 — the fellow row carries a pinned ★; the resident does not.
    const fellowHead = [...container.querySelectorAll("tbody tr.planning-row th.planning-rowhead")]
      .find((th) => th.textContent.includes("Fiona Fellow"));
    const residentHead = [...container.querySelectorAll("tbody tr.planning-row th.planning-rowhead")]
      .find((th) => th.textContent.includes("Bob Resident"));
    expect(fellowHead.querySelector(".planning-fellow-star")).not.toBeNull();
    expect(residentHead.querySelector(".planning-fellow-star")).toBeNull();

    const attendingRows = container.querySelectorAll('tr[data-staff-row="attending"]');
    expect(attendingRows).toHaveLength(1);
    const attendingCell = attendingRows[0].querySelector('td[data-date="2026-05-05"]');
    expect(attendingCell.classList.contains("planning-cell-outpatient")).toBe(true);
    expect(attendingCell.classList.contains("planning-cell-staff-readonly")).toBe(true);
    expect(attendingCell.getAttribute("title")).toContain("AM Continuity Clinic");
    expect(opTotalForDate(container, "2026-05-05")).toBe("1");
  });

  it("projects attending rows from nested outpatient details", () => {
    const state = staffRowsState();
    state.outpatientSessions = [
      ...state.outpatientSessions,
      {
        id: "op-resident-detail-pm",
        date: "2026-05-06",
        period: "PM",
        clinic: "Parent Clinic",
        provider: "",
        rotatorId: "rot-resident",
        status: "Scheduled",
        details: [
          { clinic: "Resident Continuity", attending: "Dr. Detail" }
        ]
      }
    ];

    const { container } = renderGrid(state);
    const names = renderedBodyRowNames(container);
    expect(names).toContain("Dr. Detail");

    const detailRow = [...container.querySelectorAll('tr[data-staff-row="attending"]')]
      .find((row) => row.querySelector("th")?.textContent.trim() === "Dr. Detail");
    const detailCell = detailRow.querySelector('td[data-date="2026-05-06"]');
    expect(detailCell.classList.contains("planning-cell-staff-readonly")).toBe(true);
    expect(detailCell.getAttribute("title")).toContain("PM Resident Continuity with Dr. Detail");
    expect(opTotalForDate(container, "2026-05-06")).toBe("1");
  });

  it("hides synthetic attending rows and returns fellows to normal grouping when disabled", () => {
    const { container, getByLabelText } = renderGrid();

    fireEvent.click(getByLabelText("Staff rows"));

    const names = renderedBodyRowNames(container);
    expect(names).toEqual(["Bob Resident", "Fiona Fellow"]);
    expect(new Set(names).size).toBe(names.length);
    expect(container.querySelectorAll('tr[data-staff-row="attending"]')).toHaveLength(0);
  });
});
