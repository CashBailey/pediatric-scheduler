// App-level navigation smoke test (2026-05-28 redesign). Renders the WHOLE App
// and visits every one of the 12 top-level destinations, asserting each mounts
// without crashing and shows page-specific content. This is the verification
// that matches the acceptance criteria phrased as "User can open X from the
// main menu", and (via the legacy-payload variant) the real "existing schedules
// continue to load" check.
import { afterEach, describe, it, expect, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { App } from "./App.jsx";
import { _flushBackendSyncForTests } from "./storage.js";
import { makeRotator, serializeState, PAGES } from "../shared/scheduler/scheduler.js";

const h = React.createElement;
const STORAGE_KEY = "pedi-scheduler-react-state";

afterEach(() => {
  cleanup();
  _flushBackendSyncForTests();
  localStorage.clear();
});

// 2026-05-04 is a Monday; block spans two weeks so Clinics has Mondays.
function richState() {
  const block = {
    id: "b", name: "May 2026", startDate: "2026-05-04", endDate: "2026-05-15",
    status: "Draft",
    generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
    holidays: []
  };
  return {
    version: 2,
    activeBlockId: "b",
    serviceBlocks: [block],
    sources: [],
    rotators: [
      makeRotator("op1", "Drew Quinn", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }]),
      makeRotator("ip1", "Maya Lopez", "Methodist", "PGY-3", [{ start: "2026-05-04", end: "2026-05-31" }]),
      makeRotator("fel1", "Sam Carter", "Other", "Fellow", [{ start: "2026-05-04", end: "2026-05-31" }])
    ],
    attendings: [
      { name: "Alder", recurringClinics: [{ weekday: "Monday", session: "AM", clinicName: "General Neuro", capacity: 2 }], oneOffDates: [] }
    ],
    expectedSourcePrograms: [],
    inpatientAssignments: [{ date: "2026-05-04", rotatorId: "ip1", role: "Resident" }],
    outpatientSessions: [{ date: "2026-05-04", period: "AM", clinic: "", rotatorId: "op1" }],
    clinicAssignments: [],
    rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
    notes: []
  };
}

function renderApp(state) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  localStorage.setItem(STORAGE_KEY, serializeState(state));
  return render(h(App));
}

// Per-page sentinel that proves the destination actually rendered its content.
const SENTINELS = {
  Dashboard: (c) => within(c).getAllByText("Dashboard").length > 0,
  Configuration: (c) => within(c).getAllByText(/Attendings|Expected Sources/).length > 0,
  Rotators: (c) => within(c).getAllByText(/Drew Quinn|Maya Lopez/).length > 0,
  Sources: (c) => within(c).getAllByText("Source Intake").length > 0,
  Attendings: (c) => within(c).getAllByText("Alder").length > 0,
  Fellows: (c) => within(c).getAllByText("Sam Carter").length > 0,
  Clinics: (c) => c.querySelector('[class*="clinics-"]') !== null,
  "Planning Grid": (c) => within(c).getAllByText(/Drew Quinn|Maya Lopez/).length > 0,
  "Inpatient Schedule": (c) => c.querySelector(".ip-sched-heatmap") !== null,
  "Outpatient Schedule": (c) => c.querySelector(".op-sched") !== null,
  Reports: (c) => c.querySelector(".section-tablist") !== null,
  Settings: (c) => c.querySelector(".section-tablist") !== null
};

describe("App navigation across all 12 destinations", () => {
  it("the sidebar lists exactly the 12 redesign destinations", () => {
    const { container } = renderApp(richState());
    const nav = container.querySelector(".nav-list");
    for (const label of PAGES) {
      expect(within(nav).getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("every destination mounts without crashing and shows its content", () => {
    const { container } = renderApp(richState());
    const nav = container.querySelector(".nav-list");
    for (const label of PAGES) {
      fireEvent.click(within(nav).getByRole("button", { name: label }));
      // topbar h1 reflects the active page
      expect(container.querySelector("h1").textContent).toBe(label);
      // page-specific content rendered
      const workspace = container.querySelector(".workspace");
      expect(SENTINELS[label](workspace), `sentinel failed for ${label}`).toBe(true);
    }
  });

  it("loads a legacy payload (no clinicAssignments) and navigates all pages", () => {
    const legacy = richState();
    delete legacy.clinicAssignments; // simulate a schedule saved before the redesign
    const { container } = renderApp(legacy);
    const nav = container.querySelector(".nav-list");
    for (const label of PAGES) {
      fireEvent.click(within(nav).getByRole("button", { name: label }));
      expect(container.querySelector("h1").textContent).toBe(label);
    }
  });
});
