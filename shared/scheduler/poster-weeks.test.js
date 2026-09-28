import { describe, it, expect } from "vitest";
import { makeRotator } from "./scheduler.js";
import { buildPosterWeeks } from "./poster-weeks.js";

// Two full Mon–Fri weeks: 2026-05-04 (Mon) .. 2026-05-15 (Fri).
function block() {
  return { id: "b", name: "May", startDate: "2026-05-04", endDate: "2026-05-15" };
}

function baseState() {
  const casey = makeRotator("rot-casey", "Casey Moore", "UT Pediatrics", "PGY-2", [
    { start: "2026-05-04", end: "2026-05-15" }
  ]);
  return {
    rotators: [casey],
    attendings: [],
    inpatientAssignments: [],
    // A real-clinic outpatient session synthesizes both an occurrence and an
    // assignment (legacy path), so this one record exercises card + rotator.
    outpatientSessions: [
      { id: "op-1", date: "2026-05-04", period: "AM", clinic: "Epilepsy Clinic", provider: "Dr. Alder", rotatorId: "rot-casey", status: "Scheduled" },
      // A weekend real-clinic session that must NOT appear (weekday-only).
      { id: "op-wknd", date: "2026-05-09", period: "AM", clinic: "Weekend Clinic", provider: "Dr. Sat", rotatorId: "rot-casey", status: "Scheduled" }
    ],
    clinicAssignments: []
  };
}

describe("buildPosterWeeks", () => {
  it("splits the block into Monday-anchored weeks", () => {
    const weeks = buildPosterWeeks(baseState(), block());
    expect(weeks).toHaveLength(2);
    expect(weeks[0].label).toBe("Week 1");
    expect(weeks[0].startDate).toBe("2026-05-04");
    expect(weeks[0].endDate).toBe("2026-05-08");
    expect(weeks[1].startDate).toBe("2026-05-11");
  });

  it("each week has exactly five weekday days, no weekends", () => {
    const weeks = buildPosterWeeks(baseState(), block());
    for (const wk of weeks) {
      expect(wk.days).toHaveLength(5);
      expect(wk.days.map((d) => d.weekday)).toEqual([
        "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"
      ]);
    }
  });

  it("places a real-clinic session as a card with category and rotator", () => {
    const weeks = buildPosterWeeks(baseState(), block());
    const monday = weeks[0].days[0];
    expect(monday.date).toBe("2026-05-04");
    expect(monday.AM).toHaveLength(1);
    const card = monday.AM[0];
    expect(card.clinicName).toBe("Epilepsy Clinic");
    expect(card.attendingName).toBe("Dr. Alder");
    expect(card.category.key).toBe("epilepsy");
    expect(card.rotatorNames).toContain("Casey Moore");
  });

  it("never surfaces weekend clinics", () => {
    const weeks = buildPosterWeeks(baseState(), block());
    const allCards = weeks.flatMap((w) => w.days.flatMap((d) => [...d.AM, ...d.PM]));
    expect(allCards.some((c) => c.clinicName === "Weekend Clinic")).toBe(false);
  });

  it("lists outpatient rotators for the week", () => {
    const weeks = buildPosterWeeks(baseState(), block());
    const names = weeks[0].rotators.map((r) => r.name);
    expect(names).toContain("Casey Moore");
    expect(weeks[0].rotators[0].type).toBe("OP");
  });

  it("degrades gracefully on an empty block", () => {
    expect(buildPosterWeeks(baseState(), null)).toEqual([]);
    expect(buildPosterWeeks(null, block())).toEqual([]);
    const empty = { rotators: [], attendings: [], inpatientAssignments: [], outpatientSessions: [], clinicAssignments: [] };
    const weeks = buildPosterWeeks(empty, block());
    expect(weeks).toHaveLength(2);
    expect(weeks[0].days[0].AM).toEqual([]);
    expect(weeks[0].rotators).toEqual([]);
  });
});
