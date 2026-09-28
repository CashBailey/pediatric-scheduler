import { describe, it, expect } from "vitest";
import { makeRotator, migrateLoadedState, createInitialState } from "./scheduler.js";
import {
  serviceTypeForRotatorDate,
  getServiceAssignments,
  assignService,
  assignServiceRange
} from "./service-assignments.js";
import { inpatientHeatmapTone } from "./heatmap.js";
import {
  expandClinicOccurrences,
  getClinicAssignments,
  eligibleOutpatientRotatorsForDate
} from "./clinic-selectors.js";
import {
  validateClinicAssignment,
  assignClinic,
  unassignClinic,
  detectClinicAssignmentConflicts,
  CLINIC_REASONS
} from "./clinic-validation.js";

// 2026-05-04 is a Monday (Memorial Day 2026 = Mon 05-25; weekends 05-09/05-10).
const BLOCK = { id: "b1", startDate: "2026-05-04", endDate: "2026-05-15", holidays: [] };
const MON = "2026-05-04";
const TUE = "2026-05-05";
const WED = "2026-05-06";

function stateWith(overrides = {}) {
  return {
    version: 2,
    activeBlockId: "b1",
    serviceBlocks: [BLOCK],
    rotators: [
      makeRotator("op1", "Op One", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }]),
      makeRotator("ip1", "Ip One", "Methodist", "PGY-3", [{ start: "2026-05-04", end: "2026-05-31" }])
    ],
    attendings: [],
    inpatientAssignments: [],
    outpatientSessions: [],
    clinicAssignments: [],
    ...overrides
  };
}

describe("serviceTypeForRotatorDate (B1 — exact buildPlanningGrid precedence)", () => {
  it("returns 'absent' when rotator not active that day", () => {
    const s = stateWith();
    expect(serviceTypeForRotatorDate(s, "op1", "2026-04-01")).toBe("absent");
  });
  it("returns 'unassigned' for active, available, no records", () => {
    expect(serviceTypeForRotatorDate(stateWith(), "op1", MON)).toBe("unassigned");
  });
  it("returns 'inpatient' for a real inpatient role", () => {
    const s = stateWith({ inpatientAssignments: [{ date: MON, rotatorId: "ip1", role: "Resident" }] });
    expect(serviceTypeForRotatorDate(s, "ip1", MON)).toBe("inpatient");
  });
  it("returns 'outpatient' for an outpatient session", () => {
    const s = stateWith({ outpatientSessions: [{ date: MON, period: "AM", clinic: "", rotatorId: "op1" }] });
    expect(serviceTypeForRotatorDate(s, "op1", MON)).toBe("outpatient");
  });
  it("returns 'both' when a real IP record AND an OP session coexist", () => {
    const s = stateWith({
      inpatientAssignments: [{ date: MON, rotatorId: "op1", role: "Resident" }],
      outpatientSessions: [{ date: MON, period: "AM", clinic: "", rotatorId: "op1" }]
    });
    expect(serviceTypeForRotatorDate(s, "op1", MON)).toBe("both");
  });
  it("returns 'off' for marked-off role with no IP/OP", () => {
    const s = stateWith({ inpatientAssignments: [{ date: MON, rotatorId: "ip1", role: "Off" }] });
    expect(serviceTypeForRotatorDate(s, "ip1", MON)).toBe("off");
  });
  it("returns 'off' for dayOff with no IP/OP", () => {
    const s = stateWith();
    s.rotators[0].dayOff = ["Monday"];
    expect(serviceTypeForRotatorDate(s, "op1", MON)).toBe("off");
  });
  // The three B1 divergence cases — unavailable/markedOff are SUPPRESSED by a real record.
  it("B1: dayOff Monday + inpatient record → 'inpatient' (not 'off')", () => {
    const s = stateWith({ inpatientAssignments: [{ date: MON, rotatorId: "op1", role: "Resident" }] });
    s.rotators[0].dayOff = ["Monday"];
    expect(serviceTypeForRotatorDate(s, "op1", MON)).toBe("inpatient");
  });
  it("B1: marked-off role + outpatient session → 'outpatient' (Off ignored)", () => {
    const s = stateWith({
      inpatientAssignments: [{ date: MON, rotatorId: "op1", role: "Off" }],
      outpatientSessions: [{ date: MON, period: "AM", clinic: "", rotatorId: "op1" }]
    });
    expect(serviceTypeForRotatorDate(s, "op1", MON)).toBe("outpatient");
  });
  it("B1: marked-off role + real inpatient role → 'inpatient'", () => {
    const s = stateWith({
      inpatientAssignments: [
        { date: MON, rotatorId: "op1", role: "Off" },
        { date: MON, rotatorId: "op1", role: "Resident" }
      ]
    });
    expect(serviceTypeForRotatorDate(s, "op1", MON)).toBe("inpatient");
  });
});

describe("getServiceAssignments / assignService wrappers", () => {
  it("derives assignments and skips absent/unassigned", () => {
    const s = stateWith({ inpatientAssignments: [{ date: MON, rotatorId: "ip1", role: "Resident" }] });
    const list = getServiceAssignments(s, BLOCK);
    expect(list).toEqual([{ rotatorId: "ip1", date: MON, serviceType: "inpatient" }]);
  });
  it("assignService(inpatient) writes a legacy inpatient record", () => {
    const next = assignService(stateWith(), BLOCK, { rotatorId: "ip1", date: MON, serviceType: "inpatient" });
    expect(serviceTypeForRotatorDate(next, "ip1", MON)).toBe("inpatient");
  });
  it("assignServiceRange(outpatient) marks the range outpatient", () => {
    const next = assignServiceRange(stateWith(), BLOCK, {
      rotatorId: "op1", startDate: MON, endDate: TUE, serviceType: "outpatient"
    });
    expect(serviceTypeForRotatorDate(next, "op1", MON)).toBe("outpatient");
    expect(serviceTypeForRotatorDate(next, "op1", TUE)).toBe("outpatient");
  });
  it("assignService('unassigned') clears records", () => {
    const s = stateWith({ inpatientAssignments: [{ date: MON, rotatorId: "ip1", role: "Resident" }] });
    const next = assignService(s, BLOCK, { rotatorId: "ip1", date: MON, serviceType: "unassigned" });
    expect(serviceTypeForRotatorDate(next, "ip1", MON)).toBe("unassigned");
  });
});

describe("inpatientHeatmapTone thresholds (plan §7)", () => {
  it.each([
    [0, "critical"],
    [1, "critical"],
    [2, "below"],
    [3, "below"],
    [4, "full"],
    [5, "surplus"],
    [9, "surplus"]
  ])("count %i → %s", (count, tone) => {
    expect(inpatientHeatmapTone(count)).toBe(tone);
  });
});

describe("expandClinicOccurrences", () => {
  it("expands a recurring weekday clinic on matching weekdays only", () => {
    const s = stateWith({
      attendings: [{ name: "Alder", recurringClinics: [{ weekday: "Monday", session: "AM", clinicName: "General Neuro", capacity: 2, allowedRoles: ["Resident"] }], oneOffDates: [] }]
    });
    const occ = expandClinicOccurrences(s, { startDate: "2026-05-04", endDate: "2026-05-15" });
    const dates = occ.map((o) => o.date).sort();
    expect(dates).toEqual(["2026-05-04", "2026-05-11"]); // the two Mondays
    expect(occ[0].session).toBe("AM");
    expect(occ[0].capacity).toBe(2);
    expect(occ[0].allowedRoles).toEqual(["Resident"]);
  });
  it("supports legacy {weekday, period} alias and defaults capacity to null (unlimited)", () => {
    const s = stateWith({
      attendings: [{ name: "Dogwood", recurringClinics: [{ weekday: "Tuesday", period: "PM" }], oneOffDates: [] }]
    });
    const occ = expandClinicOccurrences(s, { startDate: "2026-05-04", endDate: "2026-05-15" });
    expect(occ.every((o) => o.session === "PM")).toBe(true);
    expect(occ[0].capacity).toBe(null);
    expect(occ[0].allowedRoles).toEqual([]);
  });
  it("one-off clinic appears only on its exact date", () => {
    const s = stateWith({
      attendings: [{ name: "Cedar", recurringClinics: [], oneOffDates: [{ date: WED, period: "AM", clinicName: "TSC", allowedRoles: ["Fellow", "Resident"] }] }]
    });
    const occ = expandClinicOccurrences(s, { startDate: "2026-05-04", endDate: "2026-05-15" });
    expect(occ).toHaveLength(1);
    expect(occ[0].date).toBe(WED);
    expect(occ[0].source).toBe("one-off");
    expect(occ[0].allowedRoles).toEqual(["Resident", "Fellow"]);
  });
  it("skips recurring clinics with active === false", () => {
    const s = stateWith({
      attendings: [{ name: "Elm", recurringClinics: [{ weekday: "Monday", session: "AM", active: false }], oneOffDates: [] }]
    });
    expect(expandClinicOccurrences(s, { startDate: "2026-05-04", endDate: "2026-05-15" })).toHaveLength(0);
  });
  it("B3: two clinics same attending/weekday/session get distinct occurrence ids", () => {
    const s = stateWith({
      attendings: [{
        name: "Alder",
        recurringClinics: [
          { weekday: "Monday", session: "AM", clinicName: "General Neuro" },
          { weekday: "Monday", session: "AM", clinicName: "TSC Clinic" }
        ],
        oneOffDates: []
      }]
    });
    const occ = expandClinicOccurrences(s, { startDate: MON, endDate: MON });
    expect(occ).toHaveLength(2);
    expect(new Set(occ.map((o) => o.id)).size).toBe(2);
  });
  it("B4: synthesizes a legacy occurrence from a real-clinic outpatient session", () => {
    const s = stateWith({
      outpatientSessions: [{ date: MON, period: "AM", clinic: "Continuity Clinic", provider: "Green", rotatorId: "op1" }]
    });
    const occ = expandClinicOccurrences(s, { startDate: MON, endDate: MON });
    expect(occ).toHaveLength(1);
    expect(occ[0].source).toBe("legacy");
    expect(occ[0].clinicName).toBe("Continuity Clinic");
  });
  it("B4: does NOT synthesize for placeholder-clinic sessions", () => {
    const s = stateWith({
      outpatientSessions: [{ date: MON, period: "AM", clinic: "Outpatient (clinic TBD)", rotatorId: "op1" }]
    });
    expect(expandClinicOccurrences(s, { startDate: MON, endDate: MON })).toHaveLength(0);
  });
  it("C1: does NOT synthesize a phantom clinic for the Methodist OP placeholder", () => {
    // applyMethodistAutoAssign writes clinic "Methodist Outpatient" with an EMPTY
    // provider; that must not become a Clinics-page occurrence (phantom + white bar).
    const s = stateWith({
      outpatientSessions: [{ date: MON, period: "AM", clinic: "Methodist Outpatient", provider: "", rotatorId: "op1" }]
    });
    expect(expandClinicOccurrences(s, { startDate: MON, endDate: MON })).toHaveLength(0);
    expect(getClinicAssignments(s, { startDate: MON, endDate: MON }).filter((a) => a.source === "legacy")).toHaveLength(0);
  });
});

describe("eligibleOutpatientRotatorsForDate", () => {
  it("includes outpatient, excludes inpatient/off/unavailable/absent/both", () => {
    const s = stateWith({
      rotators: [
        makeRotator("op", "OP", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }]),
        makeRotator("ip", "IP", "Methodist", "PGY-3", [{ start: "2026-05-04", end: "2026-05-31" }]),
        makeRotator("offd", "OFF", "Other", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }]),
        makeRotator("both", "BOTH", "Other", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }]),
        makeRotator("absent", "ABS", "Other", "PGY-2", [{ start: "2026-06-01", end: "2026-06-30" }])
      ],
      outpatientSessions: [
        { date: MON, period: "AM", clinic: "", rotatorId: "op" },
        { date: MON, period: "AM", clinic: "", rotatorId: "both" }
      ],
      inpatientAssignments: [
        { date: MON, rotatorId: "ip", role: "Resident" },
        { date: MON, rotatorId: "offd", role: "Off" },
        { date: MON, rotatorId: "both", role: "Resident" }
      ]
    });
    const ids = eligibleOutpatientRotatorsForDate(s, MON).map((r) => r.id);
    expect(ids).toEqual(["op"]);
  });
});

describe("validateClinicAssignment + assignClinic/unassignClinic", () => {
  function clinicState() {
    return stateWith({
      attendings: [{ name: "Alder", recurringClinics: [{ weekday: "Monday", session: "AM", clinicName: "General Neuro", capacity: 1 }], oneOffDates: [] }],
      outpatientSessions: [{ date: MON, period: "AM", clinic: "", rotatorId: "op1" }]
    });
  }
  function occId(s) {
    return expandClinicOccurrences(s, { startDate: MON, endDate: MON })[0].id;
  }

  it("accepts an eligible outpatient rotator", () => {
    const s = clinicState();
    const v = validateClinicAssignment(s, { clinicOccurrenceId: occId(s), rotatorId: "op1", date: MON, session: "AM" });
    expect(v.ok).toBe(true);
  });
  it("rejects a non-outpatient rotator", () => {
    const s = clinicState();
    const v = validateClinicAssignment(s, { clinicOccurrenceId: occId(s), rotatorId: "ip1", date: MON, session: "AM" });
    expect(v).toMatchObject({ ok: false, reason: CLINIC_REASONS.NOT_OUTPATIENT });
  });
  it("enforces optional clinic allowedRoles policy", () => {
    const student = makeRotator("student1", "Student One", "UT Med Student", "MS3", [{ start: "2026-05-04", end: "2026-05-31" }]);
    let s = stateWith({
      rotators: [
        makeRotator("op1", "Op One", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }]),
        student
      ],
      attendings: [{ name: "Alder", recurringClinics: [{ weekday: "Monday", session: "AM", clinicName: "General Neuro", allowedRoles: ["Resident"] }], oneOffDates: [] }],
      outpatientSessions: [
        { date: MON, period: "AM", clinic: "", rotatorId: "op1" },
        { date: MON, period: "AM", clinic: "", rotatorId: "student1" }
      ]
    });
    const id = occId(s);
    expect(validateClinicAssignment(s, { clinicOccurrenceId: id, rotatorId: "op1", date: MON, session: "AM" })).toMatchObject({ ok: true });
    expect(validateClinicAssignment(s, { clinicOccurrenceId: id, rotatorId: "student1", date: MON, session: "AM" })).toMatchObject({
      ok: false,
      reason: CLINIC_REASONS.ROLE_NOT_ALLOWED
    });

    s = {
      ...s,
      attendings: [{ name: "Alder", recurringClinics: [{ weekday: "Monday", session: "AM", clinicName: "General Neuro", allowedRoles: [] }], oneOffDates: [] }]
    };
    expect(validateClinicAssignment(s, { clinicOccurrenceId: id, rotatorId: "student1", date: MON, session: "AM" })).toMatchObject({ ok: true });
  });
  it("rejects a stale occurrence id", () => {
    const s = clinicState();
    const v = validateClinicAssignment(s, { clinicOccurrenceId: "nope", rotatorId: "op1", date: MON, session: "AM" });
    expect(v).toMatchObject({ ok: false, reason: CLINIC_REASONS.OCCURRENCE_MISSING });
  });
  it("blocks a second clinic in the same AM/PM session", () => {
    // Two AM occurrences; assign op1 to the first, then attempt the second.
    let s = stateWith({
      attendings: [{
        name: "Alder",
        recurringClinics: [
          { weekday: "Monday", session: "AM", clinicName: "General Neuro" },
          { weekday: "Monday", session: "AM", clinicName: "TSC" }
        ],
        oneOffDates: []
      }],
      outpatientSessions: [{ date: MON, period: "AM", clinic: "", rotatorId: "op1" }]
    });
    const occs = expandClinicOccurrences(s, { startDate: MON, endDate: MON });
    s = assignClinic(s, { clinicOccurrenceId: occs[0].id, rotatorId: "op1", date: MON, session: "AM" }).state;
    const v = validateClinicAssignment(s, { clinicOccurrenceId: occs[1].id, rotatorId: "op1", date: MON, session: "AM" });
    expect(v).toMatchObject({ ok: false, reason: CLINIC_REASONS.ALREADY_IN_SESSION });
  });
  it("blocks over-capacity assignments", () => {
    let s = clinicState();
    // add a second outpatient rotator
    s.rotators.push(makeRotator("op2", "Op Two", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }]));
    s.outpatientSessions.push({ date: MON, period: "AM", clinic: "", rotatorId: "op2" });
    const id = occId(s);
    s = assignClinic(s, { clinicOccurrenceId: id, rotatorId: "op1", date: MON, session: "AM" }).state; // capacity 1
    const v = validateClinicAssignment(s, { clinicOccurrenceId: id, rotatorId: "op2", date: MON, session: "AM" });
    expect(v).toMatchObject({ ok: false, reason: CLINIC_REASONS.OVER_CAPACITY });
  });
  it("assignClinic then unassignClinic round-trips", () => {
    const s = clinicState();
    const id = occId(s);
    const assigned = assignClinic(s, { clinicOccurrenceId: id, rotatorId: "op1", date: MON, session: "AM" });
    expect(assigned.ok).toBe(true);
    expect(getClinicAssignments(assigned.state, { startDate: MON, endDate: MON }).some((a) => a.rotatorId === "op1" && a.source === "manual")).toBe(true);
    const removed = unassignClinic(assigned.state, { clinicOccurrenceId: id, rotatorId: "op1" });
    expect(removed.clinicAssignments).toHaveLength(0);
  });
  it("re-assigning to the same occurrence is idempotent", () => {
    const s = clinicState();
    const id = occId(s);
    const once = assignClinic(s, { clinicOccurrenceId: id, rotatorId: "op1", date: MON, session: "AM" }).state;
    const twice = assignClinic(once, { clinicOccurrenceId: id, rotatorId: "op1", date: MON, session: "AM" });
    expect(twice.ok).toBe(true);
    expect(twice.state.clinicAssignments).toHaveLength(1);
  });
});

describe("detectClinicAssignmentConflicts", () => {
  it("flags over-capacity from synthesized legacy data", () => {
    // two rotators in the same real legacy clinic, capacity null → no cap, no conflict
    const s = stateWith({
      rotators: [
        makeRotator("a", "A", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }]),
        makeRotator("b", "B", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }])
      ],
      outpatientSessions: [
        { date: MON, period: "AM", clinic: "Continuity Clinic", provider: "Green", rotatorId: "a" },
        { date: MON, period: "AM", clinic: "Continuity Clinic", provider: "Green", rotatorId: "b" }
      ]
    });
    expect(detectClinicAssignmentConflicts(s, BLOCK)).toHaveLength(0);
  });
  it("flags persisted clinic assignments that violate a later role policy", () => {
    const student = makeRotator("student1", "Student One", "UT Med Student", "MS3", [{ start: "2026-05-04", end: "2026-05-31" }]);
    const s = stateWith({
      rotators: [student],
      attendings: [{ name: "Alder", recurringClinics: [{ weekday: "Monday", session: "AM", clinicName: "General Neuro", allowedRoles: ["Resident"] }], oneOffDates: [] }],
      outpatientSessions: [{ date: MON, period: "AM", clinic: "", rotatorId: "student1" }],
      clinicAssignments: [{
        id: "clinic-assign-role",
        clinicOccurrenceId: "clinic-occurrence::alder::0-monday-AM-general-neuro::2026-05-04::AM",
        rotatorId: "student1",
        date: MON,
        session: "AM",
        source: "manual"
      }]
    });

    expect(detectClinicAssignmentConflicts(s, BLOCK)).toContainEqual(expect.objectContaining({
      type: "clinic-role-mismatch",
      rotatorId: "student1",
      actualRole: "Student",
      allowedRoles: ["Resident"]
    }));
  });
});

describe("migration backfills clinicAssignments additively", () => {
  it("createInitialState includes clinicAssignments: []", () => {
    expect(createInitialState(new Date("2026-05-04T00:00:00"))).toMatchObject({ clinicAssignments: [] });
  });
  it("migrateLoadedState backfills clinicAssignments on legacy state", () => {
    const legacy = stateWith();
    delete legacy.clinicAssignments;
    expect(migrateLoadedState(legacy).clinicAssignments).toEqual([]);
  });
  it("migrateLoadedState leaves attendings/outpatientSessions untouched", () => {
    const legacy = stateWith({
      attendings: [{ name: "X", recurringClinics: [{ weekday: "Monday", period: "AM" }], oneOffDates: [] }]
    });
    delete legacy.clinicAssignments;
    const next = migrateLoadedState(legacy);
    expect(next.attendings).toEqual(legacy.attendings);
  });
});
