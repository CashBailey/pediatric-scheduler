import { afterEach, describe, it, expect, vi } from "vitest";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { makeRotator } from "../shared/scheduler/scheduler.js";
import { ClinicsView } from "./components/clinics/ClinicsView.jsx";

const h = React.createElement;
// 2026-05-04 is a Monday.
const BLOCK = { id: "b", startDate: "2026-05-04", endDate: "2026-05-15", holidays: [] };

afterEach(cleanup);

function baseState(overrides = {}) {
  return {
    version: 2,
    activeBlockId: "b",
    serviceBlocks: [BLOCK],
    rotators: [makeRotator("op1", "Drew Quinn", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }])],
    attendings: [
      { name: "Alder", recurringClinics: [{ weekday: "Monday", session: "AM", clinicName: "General Neuro", capacity: 2 }], oneOffDates: [] }
    ],
    inpatientAssignments: [],
    outpatientSessions: [{ date: "2026-05-04", period: "AM", clinic: "", rotatorId: "op1" }],
    clinicAssignments: [],
    rules: {},
    notes: [],
    ...overrides
  };
}

describe("ClinicsView", () => {
  it("renders generated clinic occurrences and the eligible outpatient rotator", () => {
    const { container } = render(
      h(ClinicsView, { state: baseState(), block: BLOCK, updateState: vi.fn(), setNotice: vi.fn() })
    );
    expect(container.textContent).toContain("General Neuro");
    expect(container.textContent).toContain("Alder");
    expect(container.textContent).toContain("Drew Quinn");
  });

  it("shows an empty-state when there are no clinic occurrences", () => {
    const { container } = render(
      h(ClinicsView, { state: baseState({ attendings: [], outpatientSessions: [] }), block: BLOCK, updateState: vi.fn(), setNotice: vi.fn() })
    );
    expect(container.querySelector(".clinics-empty")).toBeTruthy();
  });
});
