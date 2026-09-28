import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRotator } from "../shared/scheduler/scheduler.js";
import { buildClinicPosterPdf, buildInpatientPosterPdf } from "./clinicPosterPdf.js";

// Reuse the lightweight jsPDF mock shape from pdfExport.test.js: record every
// text() call and addPage() so we can assert content + page count without a
// real PDF backend.
const pdfMocks = vi.hoisted(() => {
  const instances = [];
  class MockDoc {
    constructor() {
      this.ops = [];
      this.pageCount = 1;
      this.currentPage = 1;
      this.internal = {
        pageSize: { getWidth: () => 792, getHeight: () => 612 },
        getNumberOfPages: () => this.pageCount
      };
      instances.push(this);
    }
    addPage() { this.pageCount += 1; this.currentPage = this.pageCount; }
    setPage(p) { this.currentPage = p; }
    setFontSize() {}
    setFont() {}
    setTextColor() {}
    setDrawColor() {}
    setFillColor() {}
    setLineWidth() {}
    setLineDashPattern() {}
    circle() {}
    rect() {}
    roundedRect() {}
    line() {}
    getTextWidth(s) { return String(s).length * 4; }
    splitTextToSize(v) { return String(v).split("\n"); }
    text(value, x, y) { this.ops.push({ value: String(value), x, y, page: this.currentPage }); }
    output() { return new Blob(["mock"], { type: "application/pdf" }); }
  }
  return { instances, MockDoc };
});

vi.mock("jspdf", () => ({ jsPDF: pdfMocks.MockDoc }));

afterEach(() => { pdfMocks.instances.length = 0; });

function latest() { return pdfMocks.instances.at(-1); }
function allText() { return latest().ops.map((o) => o.value).join("\n"); }

// Two full Mon–Fri weeks.
function block() {
  return { id: "b", name: "May Block", startDate: "2026-05-04", endDate: "2026-05-15" };
}

function state() {
  const casey = makeRotator("rot-casey", "Casey Moore", "UT Pediatrics", "PGY-2", [
    { start: "2026-05-04", end: "2026-05-15" }
  ]);
  const fellow = makeRotator("rot-fellow", "Eduardo Somoza", "Other", "Fellow", [
    { start: "2026-05-04", end: "2026-05-15" }
  ]);
  return {
    rotators: [casey, fellow],
    attendings: [],
    inpatientAssignments: [
      { id: "ip-1", date: "2026-05-04", rotatorId: "rot-fellow", role: "Fellow", source: "Manual" }
    ],
    outpatientSessions: [
      { id: "op-1", date: "2026-05-04", period: "AM", clinic: "Epilepsy Clinic", provider: "Dr. Alder", rotatorId: "rot-casey", status: "Scheduled" },
      { id: "op-wknd", date: "2026-05-09", period: "AM", clinic: "Weekend Clinic", provider: "Dr. Sat", rotatorId: "rot-casey", status: "Scheduled" }
    ],
    clinicAssignments: [],
    posterSettings: {
      programName: "Pediatric Neurology Residency",
      chief: "Dr. Chief",
      notes: ["Arrive early."],
      locations: [{ name: "Main Campus", address: "123 Way" }],
      tagline: "Thanks team!"
    }
  };
}

describe("buildClinicPosterPdf", () => {
  it("returns a Blob and renders the poster header + content", () => {
    const result = buildClinicPosterPdf(state(), block());
    expect(result).toBeInstanceOf(Blob);
    const text = allText();
    expect(text).toContain("OUTPATIENT CLINIC SCHEDULE");
    expect(text).toContain("Epilepsy Clinic");
    expect(text).toContain("Dr. Alder");
    expect(text).toMatch(/Casey Moore/);
    expect(text).toContain("Dr. Chief"); // editable chief metadata
    expect(text).toContain("Thanks team!"); // tagline footer
  });

  it("renders one page per week when no week is selected (whole-block view)", () => {
    buildClinicPosterPdf(state(), block());
    expect(latest().pageCount).toBe(2);
  });

  it("renders a single page when one week is selected", () => {
    buildClinicPosterPdf(state(), block(), { weekIndex: 1 });
    expect(latest().pageCount).toBe(1);
  });

  it("never surfaces weekend clinics on the poster", () => {
    buildClinicPosterPdf(state(), block());
    expect(allText()).not.toContain("Weekend Clinic");
  });

  it("degrades gracefully with no block", () => {
    const result = buildClinicPosterPdf(state(), null);
    expect(result).toBeInstanceOf(Blob);
    expect(allText()).toContain("No active block selected");
  });
});

describe("buildInpatientPosterPdf", () => {
  it("renders an inpatient poster with the on-service count", () => {
    const result = buildInpatientPosterPdf(state(), block());
    expect(result).toBeInstanceOf(Blob);
    const text = allText();
    expect(text).toContain("INPATIENT SCHEDULE");
    expect(text).toContain("on inpatient");
    expect(text).toContain("Eduardo Somoza"); // the inpatient fellow appears
  });
});
