// Regression guard for the import-preview column offset Coordinator reported
// (2026-05-27). The preview <thead> declared 6 columns (Name/Program/Level/
// Start/End/Clinic) while each body row renders 5 cells — the date range is
// one combined cell (formatRotatorDates). The extra header shifted every value
// right of Level one column left: the date range showed under "Start",
// continuity clinic under "End", and "Clinic" read empty. The committed roster
// was always correct; only this preview was misaligned.
//
// These tests lock the structural invariant (header count === body cell count)
// and the exact per-cell alignment, so adding/removing a column on one side
// without the other fails loudly. Uses React.createElement (no JSX) so the file
// stays a plain *.test.js matched by vite.config's include glob.
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { ImportConfirm } from "./App.jsx";

afterEach(cleanup);

// A grouped-by-rotator-style template parse: header row + one data row whose
// continuity clinic is "Tuesday PM" (the value Coordinator saw land in the wrong
// column).
function makePending() {
  return {
    isMatrix: false,
    rows: [],
    warnings: [],
    templateParse: {
      headers: ["Name", "Program", "Level", "Start", "End", "Continuity Clinic"],
      dataRows: [
        ["Alejandra Possu, MD", "UT Adult Neuro", "PGY-2", "2026-09-25", "2026-10-01", "Tuesday PM"],
        // Second rotator with a DIFFERENT continuity value — guards against a
        // regression where the preview/parse globally batches one value onto
        // everyone (the second layer of Coordinator's report). NOTE: this only
        // proves applyColumnMapping is per-row; whether mergeRotators collapses
        // a single rotator's multi-row continuity values is a separate concern.
        ["Amir Ali, MD", "UT Adult Neuro", "PGY-3", "2026-10-02", "2026-10-08", "Wednesday AM"]
      ],
      detectedMapping: { fullName: 0, program: 1, level: 2, startDate: 3, endDate: 4, continuityClinic: 5 },
      headerRowIndex: 0
    }
  };
}

function renderPreview() {
  return render(
    React.createElement(ImportConfirm, {
      pending: makePending(),
      existingCount: 0,
      existingRotators: [],
      onCancel: () => {},
      onConfirm: () => {}
    })
  );
}

describe("import preview table alignment", () => {
  it("renders the same number of header columns as body cells", () => {
    const { container } = renderPreview();
    const table = container.querySelector("table");
    const headerCount = table.querySelectorAll("thead th").length;
    const firstRow = table.querySelector("tbody tr");
    const cellCount = firstRow.querySelectorAll("td").length;
    expect(headerCount).toBe(cellCount);
  });

  it("places the date range and continuity clinic under the correct headers", () => {
    const { container } = renderPreview();
    const table = container.querySelector("table");
    const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    const cells = [...table.querySelector("tbody tr").querySelectorAll("td")].map((td) => td.textContent.trim());

    const datesIdx = headers.indexOf("Dates");
    const clinicIdx = headers.indexOf("Clinic");
    expect(datesIdx).toBeGreaterThanOrEqual(0);
    expect(clinicIdx).toBeGreaterThanOrEqual(0);
    // The combined date range sits under "Dates", not split/shifted into Start.
    expect(cells[datesIdx]).toBe("2026-09-25 to 2026-10-01");
    // Continuity clinic sits under "Clinic", not bled into an "End" column.
    expect(cells[clinicIdx]).toBe("Tuesday PM");
  });

  it("keeps each rotator's own continuity value (not globally batched)", () => {
    const { container } = renderPreview();
    const table = container.querySelector("table");
    const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    const clinicIdx = headers.indexOf("Clinic");
    const rowClinics = [...table.querySelectorAll("tbody tr")].map(
      (tr) => tr.querySelectorAll("td")[clinicIdx].textContent.trim()
    );
    expect(rowClinics).toEqual(["Tuesday PM", "Wednesday AM"]);
  });
});
