// C2 — Planning Grid Inpatient/Outpatient filter tabs (regression restore).
// The view filter decides which completion-state sections are visible per tab.
import { describe, it, expect } from "vitest";
import { planningSectionVisibleInView, PLANNING_VIEW_TABS } from "./App.jsx";

describe("C2 — Planning Grid view filter (planningSectionVisibleInView)", () => {
  const ALL = ["needs", "mixed", "fullyIp", "fullyOp", "unavailable"];

  it("master view shows every section", () => {
    for (const id of ALL) {
      expect(planningSectionVisibleInView(id, "master")).toBe(true);
    }
  });

  it("inpatient view shows only rotators on inpatient (mixed + fullyIp)", () => {
    expect(planningSectionVisibleInView("fullyIp", "inpatient")).toBe(true);
    expect(planningSectionVisibleInView("mixed", "inpatient")).toBe(true);
    expect(planningSectionVisibleInView("fullyOp", "inpatient")).toBe(false);
    expect(planningSectionVisibleInView("needs", "inpatient")).toBe(false);
    expect(planningSectionVisibleInView("unavailable", "inpatient")).toBe(false);
  });

  it("outpatient view shows only rotators on outpatient (mixed + fullyOp)", () => {
    expect(planningSectionVisibleInView("fullyOp", "outpatient")).toBe(true);
    expect(planningSectionVisibleInView("mixed", "outpatient")).toBe(true);
    expect(planningSectionVisibleInView("fullyIp", "outpatient")).toBe(false);
    expect(planningSectionVisibleInView("needs", "outpatient")).toBe(false);
    expect(planningSectionVisibleInView("unavailable", "outpatient")).toBe(false);
  });

  it("a Mixed rotator (does both IP and OP) appears in BOTH service views", () => {
    expect(planningSectionVisibleInView("mixed", "inpatient")).toBe(true);
    expect(planningSectionVisibleInView("mixed", "outpatient")).toBe(true);
  });

  it("exposes exactly the three planning view tabs", () => {
    expect(PLANNING_VIEW_TABS.map((t) => t.id)).toEqual(["master", "inpatient", "outpatient"]);
  });
});
