import { afterEach, describe, it, expect, vi } from "vitest";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { makeRotator } from "../shared/scheduler/scheduler.js";
import { assignClinic } from "../shared/scheduler/clinic-validation.js";
import { expandClinicOccurrences } from "../shared/scheduler/clinic-selectors.js";
import { OutpatientSchedule } from "./components/outpatient/OutpatientSchedule.jsx";

const h = React.createElement;
const MON = "2026-05-04";
const BLOCK = { id: "b", startDate: MON, endDate: MON, holidays: [] };

afterEach(cleanup);

function baseState() {
  return {
    version: 2,
    activeBlockId: "b",
    serviceBlocks: [BLOCK],
    rotators: [makeRotator("op1", "Drew Quinn", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }])],
    attendings: [{ name: "Alder", recurringClinics: [{ weekday: "Monday", session: "AM", clinicName: "General Neuro", capacity: 2 }], oneOffDates: [] }],
    inpatientAssignments: [],
    outpatientSessions: [{ date: MON, period: "AM", clinic: "", rotatorId: "op1" }],
    clinicAssignments: [],
    rules: {},
    notes: []
  };
}

describe("OutpatientSchedule (read-only final view)", () => {
  it("surfaces uncovered clinics and unassigned outpatient rotators as warnings", () => {
    const { container } = render(h(OutpatientSchedule, { state: baseState(), block: BLOCK, setNotice: vi.fn() }));
    expect(container.querySelector(".op-sched-warnings")).toBeTruthy();
    expect(container.textContent).toContain("Drew Quinn"); // unassigned outpatient
    expect(container.textContent).toContain("General Neuro"); // uncovered clinic
  });

  it("shows the rotator's clinic destination after assignment", () => {
    let s = baseState();
    const id = expandClinicOccurrences(s, { startDate: MON, endDate: MON }).find((o) => o.source === "recurring").id;
    s = assignClinic(s, { clinicOccurrenceId: id, rotatorId: "op1", date: MON, session: "AM" }).state;
    const { container } = render(h(OutpatientSchedule, { state: s, block: BLOCK, setNotice: vi.fn() }));
    // by-rotator itinerary shows the destination
    expect(container.textContent).toContain("Alder");
    expect(container.textContent).toMatch(/General Neuro/);
  });

  it("renders an empty-state with no block", () => {
    const { container } = render(h(OutpatientSchedule, { state: baseState(), block: null, setNotice: vi.fn() }));
    expect(container.querySelector(".op-sched-empty")).toBeTruthy();
  });
});
