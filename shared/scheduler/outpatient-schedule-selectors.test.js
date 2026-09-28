import { describe, it, expect } from "vitest";
import { makeRotator } from "./scheduler.js";
import { assignClinic } from "./clinic-validation.js";
import { expandClinicOccurrences } from "./clinic-selectors.js";
import {
  outpatientItineraryByRotator,
  uncoveredClinicOccurrences,
  unassignedOutpatientRotatorsByDate,
  buildOutpatientScheduleView
} from "./outpatient-schedule-selectors.js";

const BLOCK = { id: "b", startDate: "2026-05-04", endDate: "2026-05-04", holidays: [] }; // single Monday
const MON = "2026-05-04";

function baseState() {
  return {
    version: 2,
    activeBlockId: "b",
    serviceBlocks: [BLOCK],
    rotators: [
      makeRotator("op1", "Drew Quinn", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }]),
      makeRotator("op2", "Bea Lin", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }])
    ],
    attendings: [
      { name: "Alder", recurringClinics: [{ weekday: "Monday", session: "AM", clinicName: "General Neuro", capacity: 2 }], oneOffDates: [] }
    ],
    inpatientAssignments: [],
    // both rotators are outpatient on Monday
    outpatientSessions: [
      { date: MON, period: "AM", clinic: "", rotatorId: "op1" },
      { date: MON, period: "AM", clinic: "", rotatorId: "op2" }
    ],
    clinicAssignments: [],
    rules: {},
    notes: []
  };
}

function occId(state) {
  return expandClinicOccurrences(state, { startDate: MON, endDate: MON }).find((o) => o.source === "recurring").id;
}

describe("outpatient schedule selectors", () => {
  it("uncovered + unassigned before any clinic placement", () => {
    const s = baseState();
    expect(uncoveredClinicOccurrences(s, BLOCK)).toHaveLength(1); // Alder AM is empty
    const unassigned = unassignedOutpatientRotatorsByDate(s, BLOCK);
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0].rotators.map((r) => r.rotatorId).sort()).toEqual(["op1", "op2"]);
  });

  it("itinerary reflects a clinic assignment and clears unassigned/uncovered", () => {
    let s = baseState();
    const id = occId(s);
    s = assignClinic(s, { clinicOccurrenceId: id, rotatorId: "op1", date: MON, session: "AM" }).state;

    const itin = outpatientItineraryByRotator(s, BLOCK);
    const ari = itin.find((r) => r.rotatorId === "op1");
    expect(ari.stops).toHaveLength(1);
    expect(ari.stops[0]).toMatchObject({ date: MON, session: "AM", clinicName: "General Neuro", attendingName: "Alder" });

    // Alder AM now covered; op2 still unassigned.
    expect(uncoveredClinicOccurrences(s, BLOCK)).toHaveLength(0);
    const unassigned = unassignedOutpatientRotatorsByDate(s, BLOCK);
    expect(unassigned[0].rotators.map((r) => r.rotatorId)).toEqual(["op2"]);
  });

  it("buildOutpatientScheduleView aggregates all sections", () => {
    const view = buildOutpatientScheduleView(baseState(), BLOCK);
    expect(view).toHaveProperty("byDateSession");
    expect(view).toHaveProperty("byRotator");
    expect(view).toHaveProperty("unassigned");
    expect(view).toHaveProperty("uncovered");
    expect(view).toHaveProperty("conflicts");
    expect(view.byDateSession[0].AM).toHaveLength(1); // Alder AM occurrence
  });
});
