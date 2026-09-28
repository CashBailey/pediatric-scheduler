// Co-located vitest specs for shared/scheduler/derived-views.js.
// These functions were extracted from src/App.jsx in Phase 3.2 of the
// frontend/backend refactor. They previously had no direct test
// coverage (only indirect coverage via App.jsx render paths) — these
// tests close that gap.

import { describe, expect, it } from "vitest";
import {
  classifyAssignmentRole,
  classifySession,
  groupPlanningRowsBySection,
  inpatientDayData,
  matchesAny,
  outpatientDayData,
  parseClinicMeta,
  preferenceVsActualSummary,
  rotatorsActiveInBlock
} from "./derived-views.js";
import { createInitialState, makeRotator, migrateLoadedState } from "./scheduler.js";

describe("matchesAny", () => {
  it("returns true when any pattern is a case-insensitive substring", () => {
    expect(matchesAny("CME Conference", ["cme"])).toBe(true);
    expect(matchesAny("Stay-Tuned Block", ["stay tuned", "stay-tuned"])).toBe(true);
  });

  it("returns false on no match", () => {
    expect(matchesAny("Regular Clinic", ["cme", "tbd"])).toBe(false);
  });

  it("tolerates null/undefined value", () => {
    expect(matchesAny(null, ["x"])).toBe(false);
    expect(matchesAny(undefined, ["x"])).toBe(false);
  });
});

describe("classifySession", () => {
  it("returns stay-tuned for TBD-shaped sessions", () => {
    expect(classifySession({ clinic: "TBD", provider: "" })).toBe("stay-tuned");
    expect(classifySession({ clinic: "Stay tuned", provider: "" })).toBe("stay-tuned");
  });

  it("returns cme when provider says CME", () => {
    expect(classifySession({ clinic: "", provider: "CME Conference" })).toBe("cme");
  });

  it("returns no-clinic when the clinic field says so", () => {
    expect(classifySession({ clinic: "No Clinic", provider: "" })).toBe("no-clinic");
    expect(classifySession({ clinic: "closed", provider: "" })).toBe("no-clinic");
  });

  it("returns students-off when text mentions students off", () => {
    expect(classifySession({ clinic: "Students off", provider: "" })).toBe("students-off");
    expect(classifySession({ clinic: "Medical Students Off", provider: "" })).toBe("students-off");
  });

  it("returns scheduled for normal sessions", () => {
    expect(classifySession({ clinic: "Continuity Clinic", provider: "Alder" })).toBe("scheduled");
  });

  it("first-match-wins (stay-tuned beats cme)", () => {
    expect(classifySession({ clinic: "TBD CME", provider: "" })).toBe("stay-tuned");
  });
});

describe("parseClinicMeta", () => {
  it("returns trimmed name with null count and location on plain input", () => {
    expect(parseClinicMeta("Continuity Clinic")).toEqual({
      name: "Continuity Clinic",
      count: null,
      location: null
    });
  });

  it("extracts a parenthetical patient count", () => {
    const result = parseClinicMeta("Continuity Clinic (12)");
    expect(result.count).toBe(12);
    expect(result.name).toBe("Continuity Clinic");
  });

  it("extracts '12pts'-form patient count", () => {
    const result = parseClinicMeta("Continuity 12pts");
    expect(result.count).toBe(12);
    expect(result.name).toBe("Continuity");
  });

  it("extracts @location format", () => {
    const result = parseClinicMeta("Continuity @South Campus");
    expect(result.location).toBe("South Campus");
    expect(result.name).toBe("Continuity");
  });

  it("extracts parenthetical location at end (non-numeric)", () => {
    const result = parseClinicMeta("Continuity Clinic (West Campus)");
    expect(result.location).toBe("West Campus");
    expect(result.name).toBe("Continuity Clinic");
  });

  it("falls back to 'Clinic' if the cleaned name is empty", () => {
    expect(parseClinicMeta("(12)").name).toBe("Clinic");
  });

  it("returns empty name on null/undefined input (early-return path)", () => {
    // The 'Clinic' fallback only fires when input was non-empty but got
    // consumed by count/location extraction. Null/undefined hit the
    // early-return branch first, before that fallback runs.
    expect(parseClinicMeta(null).name).toBe("");
    expect(parseClinicMeta(undefined).name).toBe("");
  });
});

describe("groupPlanningRowsBySection", () => {
  const makeRow = (name, statuses) => ({
    rotator: { displayName: name },
    cells: statuses.map((status) => ({ status }))
  });

  it("buckets a row with any unassigned cell as 'needs'", () => {
    const rows = [makeRow("A", ["inpatient", "unassigned", "outpatient"])];
    expect(groupPlanningRowsBySection(rows).needs).toHaveLength(1);
  });

  it("buckets a row with both inpatient and outpatient (no unassigned) as 'mixed'", () => {
    const rows = [makeRow("A", ["inpatient", "outpatient", "off"])];
    expect(groupPlanningRowsBySection(rows).mixed).toHaveLength(1);
  });

  it("buckets a 'both'-only row as 'mixed'", () => {
    const rows = [makeRow("A", ["both", "both"])];
    expect(groupPlanningRowsBySection(rows).mixed).toHaveLength(1);
  });

  it("buckets a row with only inpatient cells as 'fullyIp'", () => {
    const rows = [makeRow("A", ["inpatient", "inpatient", "off"])];
    expect(groupPlanningRowsBySection(rows).fullyIp).toHaveLength(1);
  });

  it("buckets a row with only outpatient cells as 'fullyOp'", () => {
    const rows = [makeRow("A", ["outpatient", "outpatient"])];
    expect(groupPlanningRowsBySection(rows).fullyOp).toHaveLength(1);
  });

  it("buckets a row that is never present as 'unavailable'", () => {
    const rows = [makeRow("A", ["absent", "absent", "absent"])];
    expect(groupPlanningRowsBySection(rows).unavailable).toHaveLength(1);
  });

  it("ignores offCalendar (weekend/holiday) unassigned cells when grouping (#6 regression)", () => {
    // An outpatient rotator whose only unassigned cells are weekends/holidays
    // is 'fullyOp', NOT 'needs' — those days can't hold outpatient and no one
    // is individually expected to cover them. Before weekends rendered as
    // cells, this was handled by an upstream date mask; now the cell flag is.
    const row = {
      rotator: { displayName: "Weekend-Free Olive" },
      cells: [
        { status: "outpatient" },
        { status: "outpatient" },
        { status: "unassigned", offCalendar: true }, // Saturday
        { status: "unassigned", offCalendar: true } // Sunday
      ]
    };
    const buckets = groupPlanningRowsBySection([row]);
    expect(buckets.fullyOp).toHaveLength(1);
    expect(buckets.needs).toHaveLength(0);
  });

  it("still buckets a working-day (non-offCalendar) unassigned gap as 'needs'", () => {
    const row = {
      rotator: { displayName: "Gap" },
      cells: [
        { status: "outpatient" },
        { status: "unassigned" }, // working-day gap, offCalendar falsy
        { status: "unassigned", offCalendar: true } // weekend, ignored
      ]
    };
    expect(groupPlanningRowsBySection([row]).needs).toHaveLength(1);
  });

  it("sorts each bucket alphabetically by displayName (case-insensitive)", () => {
    const rows = [
      makeRow("Charlie", ["inpatient"]),
      makeRow("alice", ["inpatient"]),
      makeRow("Bob", ["inpatient"])
    ];
    const buckets = groupPlanningRowsBySection(rows);
    expect(buckets.fullyIp.map((r) => r.rotator.displayName)).toEqual(["alice", "Bob", "Charlie"]);
  });

  it("returns all 5 buckets even when empty", () => {
    const buckets = groupPlanningRowsBySection([]);
    expect(Object.keys(buckets).sort()).toEqual(
      ["fullyIp", "fullyOp", "mixed", "needs", "unavailable"].sort()
    );
  });
});

describe("classifyAssignmentRole", () => {
  it("buckets AM pull-out variants", () => {
    expect(classifyAssignmentRole("AM clinic pull-out")).toBe("am-pullout");
    expect(classifyAssignmentRole("am pullout")).toBe("am-pullout");
    expect(classifyAssignmentRole("AM clinic")).toBe("am-pullout");
  });

  it("buckets PM pull-out variants", () => {
    expect(classifyAssignmentRole("PM clinic pull-out")).toBe("pm-pullout");
    expect(classifyAssignmentRole("pm clinic")).toBe("pm-pullout");
  });

  it("recognizes team senior", () => {
    expect(classifyAssignmentRole("team senior")).toBe("team-senior");
    expect(classifyAssignmentRole("senior")).toBe("team-senior");
  });

  it("recognizes fellow / academic / off", () => {
    expect(classifyAssignmentRole("fellow")).toBe("fellow");
    expect(classifyAssignmentRole("academic half-day")).toBe("academic");
    expect(classifyAssignmentRole("Off")).toBe("off");
    expect(classifyAssignmentRole("off-service")).toBe("off");
  });

  it("falls back to 'on' for unrecognized roles", () => {
    expect(classifyAssignmentRole("Resident")).toBe("on");
    expect(classifyAssignmentRole("")).toBe("on");
    expect(classifyAssignmentRole(null)).toBe("on");
  });
});

describe("inpatientDayData", () => {
  function makeBlock() {
    const state = migrateLoadedState(createInitialState());
    const block = state.serviceBlocks[0];
    return { state, block };
  }

  it("returns empty buckets for a date with no assignments", () => {
    const { state, block } = makeBlock();
    const data = inpatientDayData(state, block.startDate, {});
    expect(data.on).toEqual([]);
    expect(data.senior).toEqual([]);
    expect(data.fellow).toEqual([]);
    expect(data.off).toEqual([]);
    expect(data.dayConflicts).toEqual([]);
  });

  it("buckets a resident assignment as 'on'", () => {
    const { state, block } = makeBlock();
    const rotator = makeRotator("r1", "Test Resident", "UT Pediatrics", "PGY-2", [
      { start: block.startDate, end: block.endDate }
    ]);
    const date = block.startDate;
    const augmented = {
      ...state,
      rotators: [rotator],
      inpatientAssignments: [
        { id: "in-1", date, rotatorId: "r1", role: "Resident", source: "Manual" }
      ]
    };
    const data = inpatientDayData(augmented, date, {});
    expect(data.on).toHaveLength(1);
    expect(data.on[0].rotator.id).toBe("r1");
  });

  it("buckets AM clinic pull-out into amPullout", () => {
    const { state, block } = makeBlock();
    const rotator = makeRotator("r1", "Pullout Rotator", "UT Pediatrics", "PGY-2", [
      { start: block.startDate, end: block.endDate }
    ]);
    const date = block.startDate;
    const augmented = {
      ...state,
      rotators: [rotator],
      inpatientAssignments: [
        { id: "in-1", date, rotatorId: "r1", role: "AM clinic pull-out", source: "Manual" }
      ]
    };
    const data = inpatientDayData(augmented, date, {});
    expect(data.amPullout).toHaveLength(1);
    expect(data.on).toHaveLength(0);
  });

  it("flags weekend correctly", () => {
    const { state } = makeBlock();
    // Saturday 2026-05-23
    const saturday = "2026-05-23";
    const augmented = {
      ...state,
      serviceBlocks: [{
        ...state.serviceBlocks[0],
        startDate: "2026-05-20",
        endDate: "2026-05-25"
      }]
    };
    const data = inpatientDayData(augmented, saturday, {});
    expect(data.isWeekend).toBe(true);
  });

  it("attaches day-specific conflicts from conflictsByDate", () => {
    const { state, block } = makeBlock();
    const date = block.startDate;
    const conflictsByDate = {
      [date]: [{ id: "c1", severity: "Critical", date, title: "x", detail: "y" }]
    };
    const data = inpatientDayData(state, date, conflictsByDate);
    expect(data.dayConflicts).toHaveLength(1);
    expect(data.dayConflicts[0].id).toBe("c1");
  });
});

describe("outpatientDayData", () => {
  function makeBlock() {
    const state = migrateLoadedState(createInitialState());
    const block = state.serviceBlocks[0];
    return { state, block };
  }

  it("returns empty session arrays when no sessions on the date", () => {
    const { state, block } = makeBlock();
    const data = outpatientDayData(state, block.startDate, {});
    expect(data.sessions.AM).toEqual([]);
    expect(data.sessions.PM).toEqual([]);
    expect(data.students).toEqual([]);
    expect(data.fellows).toEqual([]);
  });

  it("buckets sessions into AM and PM", () => {
    const { state, block } = makeBlock();
    const rotator = makeRotator("r1", "Outpt Rotator", "UT Pediatrics", "PGY-2", [
      { start: block.startDate, end: block.endDate }
    ]);
    const date = block.startDate;
    const augmented = {
      ...state,
      rotators: [rotator],
      outpatientSessions: [
        { id: "s1", date, period: "AM", clinic: "Continuity", provider: "Alder", rotatorId: "r1", status: "Scheduled" },
        { id: "s2", date, period: "PM", clinic: "Continuity", provider: "Alder", rotatorId: "r1", status: "Scheduled" }
      ]
    };
    const data = outpatientDayData(augmented, date, {});
    expect(data.sessions.AM).toHaveLength(1);
    expect(data.sessions.PM).toHaveLength(1);
  });

  it("renders a legacy flat outpatient session as one synthetic detail row", () => {
    const { state, block } = makeBlock();
    const rotator = makeRotator("r1", "Outpt Rotator", "UT Pediatrics", "PGY-2", [
      { start: block.startDate, end: block.endDate }
    ]);
    const date = block.startDate;
    const augmented = {
      ...state,
      rotators: [rotator],
      outpatientSessions: [
        { id: "s1", date, period: "AM", clinic: "Continuity (8) @South Campus", provider: "Alder", rotatorId: "r1", status: "Scheduled" }
      ]
    };
    const data = outpatientDayData(augmented, date, {});
    expect(data.sessions.AM).toHaveLength(1);
    expect(data.sessions.AM[0]).toMatchObject({
      id: "s1",
      sessionId: "s1",
      clinicName: "Continuity",
      provider: "Alder",
      count: 8,
      location: "South Campus",
      detail: {
        clinic: "Continuity (8) @South Campus",
        attending: "Alder",
        synthetic: true
      }
    });
  });

  it("expands nested outpatient details under the same parent OP session", () => {
    const { state, block } = makeBlock();
    const rotator = makeRotator("r1", "Outpt Rotator", "UT Pediatrics", "PGY-2", [
      { start: block.startDate, end: block.endDate }
    ]);
    const date = block.startDate;
    const augmented = {
      ...state,
      rotators: [rotator],
      outpatientSessions: [
        {
          id: "s1",
          date,
          period: "AM",
          clinic: "Outpatient (clinic TBD)",
          provider: "",
          rotatorId: "r1",
          status: "Scheduled",
          details: [
            { clinic: "Resident Continuity", attending: "Alder" },
            { task: "Inbox follow-up", notes: "after clinic" }
          ]
        }
      ]
    };
    const data = outpatientDayData(augmented, date, {});
    expect(data.sessions.AM).toHaveLength(2);
    expect(data.sessions.AM.map((s) => s.sessionId)).toEqual(["s1", "s1"]);
    expect(data.sessions.AM.map((s) => s.clinicName)).toEqual(["Resident Continuity", "Inbox follow-up"]);
    expect(data.sessions.AM[1]).toMatchObject({
      id: "s1::detail-2",
      task: "Inbox follow-up",
      notes: "after clinic",
      detail: { synthetic: false }
    });
  });

  it("flags students-off when any session matches the pattern", () => {
    const { state, block } = makeBlock();
    const date = block.startDate;
    const augmented = {
      ...state,
      outpatientSessions: [
        { id: "s1", date, period: "AM", clinic: "Students off today", provider: "", status: "Scheduled" }
      ]
    };
    const data = outpatientDayData(augmented, date, {});
    expect(data.studentsOff).toBe(true);
  });
});

describe("rotatorsActiveInBlock (block-filter)", () => {
  const block = { id: "block-1", startDate: "2026-05-04", endDate: "2026-05-31" };

  it("returns empty when state has no rotators", () => {
    expect(rotatorsActiveInBlock({ rotators: [] }, block)).toEqual([]);
  });

  it("returns empty when block is missing", () => {
    const state = { rotators: [makeRotator("r1", "X", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }])] };
    expect(rotatorsActiveInBlock(state, null)).toEqual([]);
  });

  it("includes a rotator whose segment fully overlaps the block", () => {
    const r = makeRotator("r1", "Full Overlap", "UT Pediatrics", "PGY-2", [
      { start: "2026-05-04", end: "2026-05-31" }
    ]);
    expect(rotatorsActiveInBlock({ rotators: [r] }, block)).toEqual([r]);
  });

  it("includes a rotator with a one-day partial overlap (Coordinator's case)", () => {
    const r = makeRotator("r1", "One Day", "UT Pediatrics", "PGY-2", [
      { start: "2026-05-31", end: "2026-06-15" }
    ]);
    // 2026-05-31 is the last day of the block — single day of overlap.
    expect(rotatorsActiveInBlock({ rotators: [r] }, block)).toEqual([r]);
  });

  it("excludes a rotator whose segments fall entirely outside the block", () => {
    const r = makeRotator("r1", "Future", "UT Pediatrics", "PGY-2", [
      { start: "2026-06-01", end: "2026-06-30" }
    ]);
    expect(rotatorsActiveInBlock({ rotators: [r] }, block)).toEqual([]);
  });

  it("excludes a rotator with no segments at all", () => {
    const r = makeRotator("r1", "No Dates", "UT Pediatrics", "PGY-2", []);
    expect(rotatorsActiveInBlock({ rotators: [r] }, block)).toEqual([]);
  });

  it("includes a rotator with multiple segments where any overlaps", () => {
    const r = makeRotator("r1", "Multi", "UT Pediatrics", "PGY-2", [
      { start: "2025-12-01", end: "2025-12-31" }, // before
      { start: "2026-05-20", end: "2026-05-25" }, // overlap
      { start: "2026-07-01", end: "2026-07-15" }  // after
    ]);
    expect(rotatorsActiveInBlock({ rotators: [r] }, block)).toEqual([r]);
  });
});

describe("preferenceVsActualSummary", () => {
  const block = { id: "block-1", startDate: "2026-05-04", endDate: "2026-05-10", holidays: [] };

  function makeState({ segments, inpatientAssignments = [], outpatientSessions = [] }) {
    const rotator = makeRotator("r1", "Profiled Rotator", "UT Pediatrics", "PGY-2", []);
    rotator.segments = segments;
    return {
      rotator,
      state: {
        rotators: [rotator],
        inpatientAssignments,
        outpatientSessions
      }
    };
  }

  it("compacts consecutive dates where actual inpatient overrides an outpatient profile preference", () => {
    const { state, rotator } = makeState({
      segments: [{ start: "2026-05-04", end: "2026-05-10", defaultPhase: "outpatient" }],
      inpatientAssignments: [
        { id: "ip-1", date: "2026-05-05", rotatorId: "r1", role: "Resident" },
        { id: "ip-2", date: "2026-05-06", rotatorId: "r1", role: "Resident" },
        { id: "ip-3", date: "2026-05-07", rotatorId: "r1", role: "Resident" }
      ],
      outpatientSessions: [
        { id: "op-1", date: "2026-05-08", period: "AM", rotatorId: "r1" }
      ]
    });

    expect(preferenceVsActualSummary(state, rotator, block).ranges).toEqual([
      {
        rotatorId: "r1",
        startDate: "2026-05-05",
        endDate: "2026-05-07",
        preference: "outpatient",
        actual: "inpatient",
        days: 3
      }
    ]);
  });

  it("splits non-contiguous differences even when preference and actual phases match", () => {
    const { state, rotator } = makeState({
      segments: [{ start: "2026-05-04", end: "2026-05-10", defaultPhase: "inpatient" }],
      outpatientSessions: [
        { id: "op-1", date: "2026-05-04", period: "AM", rotatorId: "r1" },
        { id: "op-2", date: "2026-05-06", period: "PM", rotatorId: "r1" }
      ]
    });

    expect(preferenceVsActualSummary(state, rotator, block).ranges).toEqual([
      {
        rotatorId: "r1",
        startDate: "2026-05-04",
        endDate: "2026-05-04",
        preference: "inpatient",
        actual: "outpatient",
        days: 1
      },
      {
        rotatorId: "r1",
        startDate: "2026-05-06",
        endDate: "2026-05-06",
        preference: "inpatient",
        actual: "outpatient",
        days: 1
      }
    ]);
  });

  it("reports explicit off and both assignments without treating blank dates as differences", () => {
    const { state, rotator } = makeState({
      segments: [{ start: "2026-05-04", end: "2026-05-10", defaultPhase: "outpatient" }],
      inpatientAssignments: [
        { id: "off-1", date: "2026-05-04", rotatorId: "r1", role: "Off" },
        { id: "ip-1", date: "2026-05-06", rotatorId: "r1", role: "Resident" }
      ],
      outpatientSessions: [
        { id: "op-1", date: "2026-05-06", period: "AM", rotatorId: "r1" }
      ]
    });

    expect(preferenceVsActualSummary(state, rotator, block).ranges).toEqual([
      {
        rotatorId: "r1",
        startDate: "2026-05-04",
        endDate: "2026-05-04",
        preference: "outpatient",
        actual: "off",
        days: 1
      },
      {
        rotatorId: "r1",
        startDate: "2026-05-06",
        endDate: "2026-05-06",
        preference: "outpatient",
        actual: "both",
        days: 1
      }
    ]);
  });

  it("clips comparison to the supplied range and ignores segments with no defaultPhase", () => {
    const { state, rotator } = makeState({
      segments: [
        { start: "2026-05-01", end: "2026-05-04", defaultPhase: "outpatient" },
        { start: "2026-05-05", end: "2026-05-07" }
      ],
      inpatientAssignments: [
        { id: "ip-1", date: "2026-05-03", rotatorId: "r1", role: "Resident" },
        { id: "ip-2", date: "2026-05-04", rotatorId: "r1", role: "Resident" },
        { id: "ip-3", date: "2026-05-06", rotatorId: "r1", role: "Resident" }
      ]
    });

    expect(preferenceVsActualSummary(state, rotator, block).ranges).toEqual([
      {
        rotatorId: "r1",
        startDate: "2026-05-04",
        endDate: "2026-05-04",
        preference: "outpatient",
        actual: "inpatient",
        days: 1
      }
    ]);
  });
});
