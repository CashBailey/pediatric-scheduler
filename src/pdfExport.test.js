import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRotator } from "../shared/scheduler/scheduler.js";
import { expandClinicOccurrences } from "../shared/scheduler/clinic-selectors.js";
import { assignClinic } from "../shared/scheduler/clinic-validation.js";
import { buildInpatientPdf, buildOutpatientPdf } from "./pdfExport.js";

const pdfMocks = vi.hoisted(() => {
  const instances = [];
  const autoTableCalls = [];

  class MockDoc {
    constructor(options) {
      this.options = options;
      this.operations = [];
      this.currentPage = 1;
      this.pageCount = 1;
      this.lastAutoTable = { finalY: 72 };
      this.internal = {
        pageSize: {
          getWidth: () => 792,
          getHeight: () => 612
        },
        getNumberOfPages: () => this.pageCount
      };
      instances.push(this);
    }

    addPage() {
      this.pageCount += 1;
      this.currentPage = this.pageCount;
      this.operations.push({ type: "addPage", page: this.currentPage });
    }

    setPage(page) {
      this.currentPage = page;
      this.operations.push({ type: "setPage", page });
    }

    setFontSize(size) {
      this.operations.push({ type: "setFontSize", size, page: this.currentPage });
    }

    setFont(...args) {
      this.operations.push({ type: "setFont", args, page: this.currentPage });
    }

    setTextColor(...args) {
      this.operations.push({ type: "setTextColor", args, page: this.currentPage });
    }

    setDrawColor(...args) {
      this.operations.push({ type: "setDrawColor", args, page: this.currentPage });
    }

    setFillColor(...args) {
      this.operations.push({ type: "setFillColor", args, page: this.currentPage });
    }

    setLineWidth(width) {
      this.operations.push({ type: "setLineWidth", width, page: this.currentPage });
    }

    text(value, x, y, options) {
      this.operations.push({ type: "text", value, x, y, options, page: this.currentPage });
    }

    rect(x, y, width, height, style) {
      this.operations.push({ type: "rect", x, y, width, height, style, page: this.currentPage });
    }

    roundedRect(x, y, width, height, rx, ry, style) {
      this.operations.push({ type: "roundedRect", x, y, width, height, rx, ry, style, page: this.currentPage });
    }

    line(x1, y1, x2, y2) {
      this.operations.push({ type: "line", x1, y1, x2, y2, page: this.currentPage });
    }

    splitTextToSize(value) {
      return String(value).split("\n");
    }

    output(type) {
      this.operations.push({ type: "output", value: type, page: this.currentPage });
      return new Blob(["mock-pdf"], { type: "application/pdf" });
    }
  }

  return { instances, autoTableCalls, MockDoc };
});

vi.mock("jspdf", () => ({ jsPDF: pdfMocks.MockDoc }));
vi.mock("jspdf-autotable", () => ({
  default: (doc, options) => {
    pdfMocks.autoTableCalls.push({ doc, options, page: doc.currentPage });
    doc.lastAutoTable = { finalY: (options.startY || 0) + 48 };
  }
}));

afterEach(() => {
  pdfMocks.instances.length = 0;
  pdfMocks.autoTableCalls.length = 0;
});

function block() {
  return {
    id: "block-may-2026",
    name: "May 2026 Pediatric Neurology",
    startDate: "2026-05-04",
    endDate: "2026-05-10",
    status: "Draft",
    generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
    holidays: []
  };
}

function stateForPdf() {
  const b = block();
  const maya = makeRotator("rot-maya", "Maya Lopez", "Methodist", "PGY-3", [
    { start: b.startDate, end: b.endDate }
  ]);
  maya.dayOff = ["Monday"];
  maya.unavailableRanges = [{ start: "2026-05-06", end: "2026-05-06", label: "Vacation" }];

  const ari = makeRotator("rot-ari", "Drew Quinn", "UT Pediatrics", "PGY-2", [
    { start: b.startDate, end: b.endDate }
  ]);
  const sam = makeRotator("rot-sam", "Sam Carter", "Other", "Fellow", [
    { start: b.startDate, end: b.endDate }
  ]);
  const profileOnly = makeRotator("rot-profile-only", "Profile Only", "UT Pediatrics", "PGY-2", [
    { start: b.startDate, end: b.endDate }
  ]);
  profileOnly.continuityClinic = "Tuesday PM";

  return {
    version: 2,
    activeBlockId: b.id,
    serviceBlocks: [b],
    sources: [],
    rotators: [maya, ari, sam, profileOnly],
    attendings: [],
    expectedSourcePrograms: [],
    inpatientAssignments: [
      { id: "ip-1", date: "2026-05-04", rotatorId: "rot-maya", role: "Team senior", source: "Manual" },
      { id: "ip-2", date: "2026-05-06", rotatorId: "rot-ari", role: "Resident", source: "Manual" },
      { id: "ip-3", date: "2026-05-07", rotatorId: "rot-sam", role: "Fellow", source: "Manual" },
      { id: "ip-off", date: "2026-05-05", rotatorId: "rot-profile-only", role: "Off", source: "Range-Assigned" }
    ],
    outpatientSessions: [
      { id: "op-1", date: "2026-05-04", period: "AM", clinic: "Continuity Clinic", provider: "Dr. Green", rotatorId: "rot-maya", status: "Scheduled" },
      { id: "op-2", date: "2026-05-04", period: "PM", clinic: "Resident Clinic", provider: "Dr. Shah", rotatorId: "rot-ari", status: "Scheduled" },
      { id: "op-weekend", date: "2026-05-09", period: "AM", clinic: "Weekend Clinic", provider: "Dr. Saturday", rotatorId: "rot-sam", status: "Scheduled" }
    ],
    rules: {},
    notes: []
  };
}

function latestDoc() {
  return pdfMocks.instances.at(-1);
}

function textValues(doc) {
  return doc.operations.filter((op) => op.type === "text").map((op) => String(op.value));
}

function autoTableText() {
  return pdfMocks.autoTableCalls
    .flatMap((call) => [call.options.head, call.options.body])
    .flat(3)
    .filter(Boolean)
    .map(String)
    .join("\n");
}

describe("PDF calendar exports", () => {
  it("renders inpatient as a calendar grid using actual inpatient assignments, not an autoTable roster", () => {
    const state = stateForPdf();
    const result = buildInpatientPdf(state, block());
    const doc = latestDoc();
    const text = textValues(doc).join("\n");

    expect(result).toBeInstanceOf(Blob);
    expect(doc.operations.filter((op) => op.type === "rect" && op.page === 1).length).toBeGreaterThanOrEqual(7);
    expect(text).toContain("Maya Lopez");
    expect(text).toContain("Team senior");
    expect(text).toContain("Drew Quinn");
    expect(text).toContain("Resident");
    expect(text).toContain("Sam Carter");
    expect(text).toContain("Fellow");
    expect(text).not.toContain("Profile Only");
    expect(text).not.toContain("Off");
    expect(text).not.toMatch(/day off|vacation|not on service/i);
    expect(autoTableText()).not.toMatch(/day off|vacation|not on service|Profile Only|Tuesday PM/i);
    expect(
      pdfMocks.autoTableCalls.some((call) => call.options.head?.[0]?.join("|") === "Date|Day|Provider|Role")
    ).toBe(false);
  });

  it("renders outpatient as a weekday AM/PM clinic calendar using actual sessions, not a list table", () => {
    const state = stateForPdf();
    const result = buildOutpatientPdf(state, block());
    const doc = latestDoc();
    const text = textValues(doc).join("\n");

    expect(result).toBeInstanceOf(Blob);
    expect(doc.operations.filter((op) => op.type === "rect" && op.page === 1).length).toBeGreaterThanOrEqual(5);
    expect(text).toContain("AM");
    expect(text).toContain("PM");
    expect(text).toContain("Continuity Clinic");
    expect(text).toContain("Dr. Green");
    expect(text).toContain("Maya Lopez");
    expect(text).toContain("Resident Clinic");
    expect(text).toContain("Drew Quinn");
    expect(text).not.toContain("Weekend Clinic");
    expect(text).not.toMatch(/medical students|fellow clinic|not in a clinic|day off|vacation/i);
    expect(autoTableText()).not.toMatch(/medical students|fellow clinic|not in a clinic|day off|vacation|Profile Only|Tuesday PM/i);
    expect(
      pdfMocks.autoTableCalls.some((call) => call.options.head?.[0]?.join("|") === "Date|Day|AM/PM|Clinic|Provider|Rotator")
    ).toBe(false);
  });

  it("includes Clinics-tab clinic assignments (2026-05-28 redesign) without surfacing weekends", () => {
    // Alder has a recurring Monday-AM clinic; place Ari into it on Mon 5/4.
    let state = stateForPdf();
    state = {
      ...state,
      attendings: [{ name: "Alder", recurringClinics: [{ weekday: "Monday", session: "AM", clinicName: "TSC Genetics", capacity: 2 }], oneOffDates: [] }],
      outpatientSessions: [{ id: "op-mon", date: "2026-05-04", period: "AM", clinic: "", rotatorId: "rot-ari", status: "Scheduled" }],
      clinicAssignments: []
    };
    const occ = expandClinicOccurrences(state, { startDate: "2026-05-04", endDate: "2026-05-10" })
      .find((o) => o.source === "recurring" && o.clinicName === "TSC Genetics");
    state = assignClinic(state, { clinicOccurrenceId: occ.id, rotatorId: "rot-ari", date: "2026-05-04", session: "AM" }).state;

    buildOutpatientPdf(state, block());
    const tableText = autoTableText();
    expect(tableText).toMatch(/TSC Genetics/); // the clinic assignment appears
    expect(tableText).toMatch(/Drew Quinn/);
    expect(tableText).not.toMatch(/Weekend Clinic/); // weekday-only, no weekend bleed
    // the dedicated clinic-assignments table exists
    expect(
      pdfMocks.autoTableCalls.some((call) => call.options.head?.[0]?.join("|") === "Rotator|Date|Day|AM/PM|Clinic|Attending")
    ).toBe(true);
  });
});
