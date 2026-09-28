import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { App } from "./App.jsx";
import { _flushBackendSyncForTests } from "./storage.js";
import { createInitialState, makeRotator, serializeState } from "../shared/scheduler/scheduler.js";

const STORAGE_KEY = "pedi-scheduler-react-state";

afterEach(() => {
  cleanup();
  _flushBackendSyncForTests();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function rosterState({ withPreferenceMismatch = false } = {}) {
  const base = createInitialState(new Date("2026-07-01T12:00:00"));
  const block = {
    ...base.serviceBlocks[0],
    startDate: "2026-07-01",
    endDate: "2026-07-31"
  };
  const rotator = {
    ...makeRotator("rot-maya", "Maya Lopez", "Methodist", "PGY-3", [
      { start: "2026-07-01", end: "2026-07-31", defaultPhase: withPreferenceMismatch ? "outpatient" : undefined }
    ]),
    dayOff: ["Monday"],
    unavailableRanges: [{ start: "2026-07-10", end: "2026-07-12" }]
  };
  return {
    ...base,
    activeBlockId: block.id,
    serviceBlocks: [block],
    rotators: [rotator],
    inpatientAssignments: withPreferenceMismatch
      ? [{ id: "ip-mismatch", date: "2026-07-03", rotatorId: rotator.id, role: "Team senior" }]
      : []
  };
}

function renderRoster(state = rosterState()) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  localStorage.setItem(STORAGE_KEY, serializeState(state));
  const result = render(React.createElement(App));
  fireEvent.click(result.getByRole("button", { name: "Rotators" }));
  return result;
}

describe("Roster profile collapse", () => {
  it("collapses rotator profiles by default with a useful read-only summary", () => {
    const { getAllByText, getByRole, getByText, queryByRole } = renderRoster();

    expect(getByText(/Maya Lopez/)).toBeTruthy();
    expect(getAllByText(/Methodist/).length).toBeGreaterThan(0);
    expect(getAllByText(/PGY-3/).length).toBeGreaterThan(0);
    expect(getByText(/2026-07-01 to 2026-07-31/)).toBeTruthy();
    expect(getByText(/Tuesday PM/)).toBeTruthy();
    expect(getByText(/Monday/)).toBeTruthy();
    expect(getByRole("button", { name: /Expand Maya Lopez profile/i })).toBeTruthy();
    expect(queryByRole("button", { name: /Remove rotator/i })).toBeNull();
  });

  it("expands a collapsed profile and preserves the existing editor controls", () => {
    const { getAllByLabelText, getByRole, getByText } = renderRoster();

    fireEvent.click(getByRole("button", { name: /Expand Maya Lopez profile/i }));

    expect(getByRole("button", { name: /Collapse Maya Lopez profile/i })).toBeTruthy();
    expect(getByRole("button", { name: /Remove rotator/i })).toBeTruthy();
    expect(getAllByLabelText("Full name").map((input) => input.value)).toContain("Maya Lopez");
    expect(getByText(/Day off each week/i)).toBeTruthy();
    expect(getByText(/Time off/i)).toBeTruthy();
  });

  it("shows preference-vs-actual differences in collapsed and expanded profiles", () => {
    const { getByRole, getByText } = renderRoster(rosterState({ withPreferenceMismatch: true }));

    expect(getByText(/Actual differs/i)).toBeTruthy();
    expect(getByText(/preferred OP -> actual IP/i)).toBeTruthy();

    fireEvent.click(getByRole("button", { name: /Expand Maya Lopez profile/i }));

    expect(getByText(/Actual differs from profile/i)).toBeTruthy();
    expect(getByText(/preferred OP -> actual IP/i)).toBeTruthy();
  });
});
