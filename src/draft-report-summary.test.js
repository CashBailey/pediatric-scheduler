import { describe, expect, it } from "vitest";
import { summarizeDraftChecks } from "./App.jsx";

// summarizeDraftChecks collapses a raw A3 draft-report check list into the
// lines the Planning Grid report panel renders: the many per-day ip-below-min
// checks fold into one summary line; everything else passes through; errors
// sort ahead of warnings.
describe("summarizeDraftChecks — draft-report panel line collapsing", () => {
  it("collapses multiple ip-below-min checks into a single error line with the day count", () => {
    const checks = [
      { id: "ip-below-min", severity: "error", date: "2026-05-04", message: "x" },
      { id: "ip-below-min", severity: "error", date: "2026-05-05", message: "y" }
    ];
    const lines = summarizeDraftChecks(checks);
    const belowMin = lines.filter((l) => l.message.includes("below minimum inpatient staffing"));
    expect(belowMin).toHaveLength(1);
    expect(belowMin[0].severity).toBe("error");
    expect(belowMin[0].message).toContain("2 days");
  });

  it("uses singular wording for a single below-min day", () => {
    const lines = summarizeDraftChecks([
      { id: "ip-below-min", severity: "error", date: "2026-05-04", message: "x" }
    ]);
    expect(lines[0].message).toContain("1 day below");
  });

  it("passes non-ip-below-min checks through verbatim (severity + message)", () => {
    const checks = [{ id: "fellow-no-inpatient", severity: "warning", message: "No fellow on IP." }];
    expect(summarizeDraftChecks(checks)).toEqual([{ severity: "warning", message: "No fellow on IP." }]);
  });

  it("orders errors before warnings", () => {
    const checks = [
      { id: "methodist-no-start", severity: "warning", message: "W" },
      { id: "ip-below-min", severity: "error", date: "2026-05-04", message: "E" }
    ];
    const lines = summarizeDraftChecks(checks);
    expect(lines[0].severity).toBe("error");
    expect(lines[lines.length - 1].severity).toBe("warning");
  });

  it("returns an empty array for no checks", () => {
    expect(summarizeDraftChecks([])).toEqual([]);
  });
});
