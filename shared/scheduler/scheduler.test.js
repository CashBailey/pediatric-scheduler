import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {
  activeRotatorsOn,
  addRotator,
  clampDateToBlock,
  dedupeRotatorsByName,
  extendBlockEnd,
  OP_PLACEHOLDER_CLINIC,
  METHODIST_OP_CLINIC,
  applyMethodistAutoAssign,
  applyPreassignments,
  buildExportPackage,
  applyRangeAssignment,
  assessRangeAssignment,
  attendingsAvailableOn,
  buildPlanningGrid,
  continuityClinicsForDate,
  continuityPeriodsForWeekday,
  coverageForDate,
  defaultCoverageCount,
  setBlockCoverage,
  suggestCoverageFromGrid,
  createInitialState,
  dateRange,
  applyDrop,
  detectConflicts,
  focusTargetForConflict,
  expandRotatorDatesInBlock,
  fillOutpatientTarget,
  generateDailyReport,
  generateExportManifest,
  generateLegend,
  getRotatorPhase,
  getRotatorSegmentPhase,
  inferSchoolType,
  isPediatricNeurologyFellow,
  isRotatorActiveOn,
  isRotatorUnavailable,
  makeRotator,
  migrateLoadedState,
  PAGES,
  parseContinuityClinic,
  parseContinuityClinicSlots,
  formatContinuityClinicSlots,
  parseState,
  previewRangeAssignment,
  proposeSchedule,
  removeRotator,
  removeRotators,
  validateDrop,
  scheduleInpatientAssignment,
  scheduleOutpatientSession,
  updateRotator,
  weekdayName
} from "./scheduler.js";
import rotatorSchema from "../contracts/v1/rotator.js";
import { loadSchedulerState } from "../../src/storage.js";
import {
  PROGRAM_RULE_DESCRIPTIONS,
  applyProgramRules,
  classifyRotatorSchoolType
} from "./program-rules.js";
import { createDemoState } from "./test-fixtures.js";

describe("scheduler domain state", () => {
  it("starts with an empty workspace ready for the user to populate", () => {
    const state = createInitialState();

    expect(state.serviceBlocks).toHaveLength(1);
    expect(state.serviceBlocks[0].name).toBe("New rotation block");
    expect(state.rotators).toHaveLength(0);
    expect(state.inpatientAssignments).toHaveLength(0);
    expect(state.outpatientSessions).toHaveLength(0);
    expect(state.sources).toHaveLength(0);
    expect(state.rules.maxConsecutiveInpatientDays).toBe(6);
  });

  it("adds rotators immutably", () => {
    const state = createInitialState();
    const next = addRotator(state, {
      fullName: "Coordinator Test",
      program: "UT Pediatrics",
      level: "PGY-2",
      startDate: "2026-05-04",
      endDate: "2026-05-31"
    });

    expect(next).not.toBe(state);
    expect(next.rotators).toHaveLength(state.rotators.length + 1);
    const added = next.rotators.at(-1);
    expect(added.displayName).toBe("Coordinator Test");
    // addRotator should fold the legacy {startDate,endDate} input shape
    // into the new segments array so the rest of the app can rely on it.
    expect(added.segments).toEqual([{ start: "2026-05-04", end: "2026-05-31" }]);
    expect(added.schoolType).toBe("ut-peds");
    expect("startDate" in added).toBe(false);
    expect("endDate" in added).toBe(false);
  });

  it("distinguishes Pediatric Neurology fellows from Psychiatry trainees", () => {
    const samantha = {
      program: "UT Pediatrics",
      level: "PGY-3",
      role: "Fellow"
    };
    const kai = {
      program: "UT Psychiatry",
      level: "PGY-5",
      role: "Fellow"
    };
    expect(isPediatricNeurologyFellow(samantha)).toBe(true);
    expect(isPediatricNeurologyFellow(kai)).toBe(false);
  });

  it("preserves segment.defaultPhase when adding a rotator from segmented input", () => {
    const state = createInitialState();
    const next = addRotator(state, {
      fullName: "Default Phase Test",
      program: "UT Pediatrics",
      level: "PGY-2",
      segments: [
        { start: "2026-05-04", end: "2026-05-10", defaultPhase: "outpatient" }
      ]
    });

    expect(next.rotators.at(-1).segments).toEqual([
      { start: "2026-05-04", end: "2026-05-10", defaultPhase: "outpatient" }
    ]);
  });

  it("normalizes day-off weekdays and unavailable ranges on rotator add/update", () => {
    const state = createInitialState();
    const addedState = addRotator(state, {
      fullName: "Availability Test",
      program: "UT Pediatrics",
      level: "PGY-2",
      startDate: "2026-05-04",
      endDate: "2026-05-31",
      dayOff: ["Friday", "Nonesday", "Monday", "Monday"],
      unavailableRanges: [
        { start: "2026-05-07", end: "2026-05-08", label: " Conference " },
        { start: "2026-05-15", end: "2026-05-13", label: "Backwards" },
        { start: "2026-02-31", end: "2026-02-31", label: "Impossible" },
        { start: "2026-05-20", end: "2026-05-20", label: 123 }
      ]
    });
    const added = addedState.rotators.at(-1);

    expect(added.dayOff).toEqual(["Monday", "Friday"]);
    expect(added.unavailableRanges).toEqual([
      { start: "2026-05-07", end: "2026-05-08", label: "Conference" },
      { start: "2026-05-20", end: "2026-05-20" }
    ]);

    const updatedState = updateRotator(addedState, added.id, {
      dayOff: ["Sunday", "Nope"],
      unavailableRanges: [
        { start: "2026-05-25", end: "2026-05-26", label: "Vacation" },
        { start: "bad", end: "2026-05-26", label: "Bad" }
      ]
    });
    expect(updatedState.rotators.at(-1).dayOff).toEqual(["Sunday"]);
    expect(updatedState.rotators.at(-1).unavailableRanges).toEqual([
      { start: "2026-05-25", end: "2026-05-26", label: "Vacation" }
    ]);

    const clearedState = updateRotator(updatedState, added.id, {
      dayOff: [],
      unavailableRanges: []
    });
    expect(clearedState.rotators.at(-1).dayOff).toEqual([]);
    expect(clearedState.rotators.at(-1).unavailableRanges).toEqual([]);
  });

  it("keeps segment.defaultPhase when duplicate rotators are merged by name", () => {
    const block = {
      id: "b",
      name: "Merge test",
      startDate: "2026-05-04",
      endDate: "2026-05-31",
      status: "Draft",
      generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
      holidays: []
    };
    const first = makeRotator("rot-1", "Merge Person", "UT Pediatrics", "PGY-2", [
      { start: "2026-05-04", end: "2026-05-10", defaultPhase: "outpatient" }
    ]);
    const second = makeRotator("rot-2", "Merge Person", "UT Pediatrics", "PGY-2", [
      { start: "2026-05-11", end: "2026-05-17", defaultPhase: "inpatient" }
    ]);
    const state = {
      version: 2,
      activeBlockId: "b",
      serviceBlocks: [block],
      sources: [],
      rotators: [first, second],
      attendings: [],
      expectedSourcePrograms: [],
      inpatientAssignments: [],
      outpatientSessions: [],
      clinicAssignments: [
        { id: "clinic-1", clinicOccurrenceId: "occ-1", rotatorId: "rot-2", date: "2026-05-12", session: "AM", source: "Manual" }
      ],
      rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
      notes: []
    };

    const result = dedupeRotatorsByName(state);

    expect(result.state.rotators).toHaveLength(1);
    expect(result.state.rotators[0].segments).toEqual([
      { start: "2026-05-04", end: "2026-05-10", defaultPhase: "outpatient" },
      { start: "2026-05-11", end: "2026-05-17", defaultPhase: "inpatient" }
    ]);
    expect(result.state.clinicAssignments[0].rotatorId).toBe("rot-1");
  });

  it("rotator.v1 accepts optional segment.defaultPhase so profile preferences can persist", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(rotatorSchema);
    const rotator = {
      ...makeRotator("r1", "Default Phase Contract", "UT Pediatrics", "PGY-2", []),
      segments: [
        { start: "2026-05-04", end: "2026-05-17", defaultPhase: "outpatient" }
      ]
    };

    expect(validate(rotator), JSON.stringify(validate.errors)).toBe(true);
  });

  it("detects inpatient and outpatient double-booking conflicts", () => {
    let state = createDemoState();
    const rotatorId = state.rotators[0].id;
    state = scheduleInpatientAssignment(state, {
      date: "2026-05-11",
      rotatorId,
      role: "Team senior"
    });
    state = scheduleOutpatientSession(state, {
      date: "2026-05-11",
      period: "AM",
      clinic: "Continuity Clinic",
      provider: "Dr. Test",
      rotatorId
    });

    const conflicts = detectConflicts(state);

    expect(conflicts.some((conflict) => conflict.type === "double-booked")).toBe(true);
  });

  it("A3/rule 8: flags an outpatient session scheduled on a weekend, not a weekday", () => {
    const rotatorId = createDemoState().rotators[0].id;
    // 2026-05-09 is a Saturday — outpatient clinics are closed on weekends.
    const weekendState = scheduleOutpatientSession(createDemoState(), {
      date: "2026-05-09", period: "AM", clinic: "Continuity Clinic", provider: "Dr. Test", rotatorId
    });
    const weekend = detectConflicts(weekendState).find(
      (c) => c.type === "outpatient-weekend" && c.date === "2026-05-09"
    );
    expect(weekend).toBeTruthy();
    expect(weekend.severity).toBe("Warning");
    // A weekday clinic (Wed 2026-05-06) must NOT trip the weekend check.
    const weekdayState = scheduleOutpatientSession(createDemoState(), {
      date: "2026-05-06", period: "AM", clinic: "Continuity Clinic", provider: "Dr. Test", rotatorId
    });
    expect(detectConflicts(weekdayState).some((c) => c.type === "outpatient-weekend")).toBe(false);
  });

  it("parses continuity-clinic free-text into a structured weekday/period", () => {
    expect(parseContinuityClinic("Tuesday PM")).toEqual({ weekday: "Tuesday", period: "PM" });
    expect(parseContinuityClinic("tue am")).toEqual({ weekday: "Tuesday", period: "AM" });
    expect(parseContinuityClinic("PM Thursday")).toEqual({ weekday: "Thursday", period: "PM" });
    expect(parseContinuityClinic("Monday afternoon")).toEqual({ weekday: "Monday", period: "PM" });
    expect(parseContinuityClinic("")).toBeNull();
    expect(parseContinuityClinic("Tuesday")).toBeNull();
    expect(parseContinuityClinic("nonsense")).toBeNull();
    expect(parseContinuityClinic(null)).toBeNull();
  });

  it("surfaces continuity-clinic coverage gaps for a given date", () => {
    const state = createDemoState();
    // 2026-05-12 is a Tuesday; seeded Noah/Maya have Tuesday PM clinic.
    const tuesday = continuityClinicsForDate(state, "2026-05-12");
    expect(tuesday.AM).toHaveLength(0);
    expect(tuesday.PM.map((r) => r.displayName).sort()).toEqual(["Maya Lopez", "Noah Patel"]);

    // 2026-05-13 is a Wednesday with no continuity-clinic providers.
    const wednesday = continuityClinicsForDate(state, "2026-05-13");
    expect(wednesday.AM).toHaveLength(0);
    expect(wednesday.PM).toHaveLength(0);
  });

  it("parseContinuityClinic stays single-slot (returns the FIRST slot only)", () => {
    // Back-compat: the legacy single-slot parser is UNCHANGED. It treats
    // the comma as a token separator and stops at the first weekday+period.
    expect(parseContinuityClinic("Tuesday PM, Thursday AM")).toEqual({ weekday: "Tuesday", period: "PM" });
  });

  it("parseContinuityClinicSlots parses ALL slots (comma- and 'and'-separated)", () => {
    expect(parseContinuityClinicSlots("Tuesday PM, Thursday AM")).toEqual([
      { weekday: "Tuesday", period: "PM" },
      { weekday: "Thursday", period: "AM" }
    ]);
    expect(parseContinuityClinicSlots("Monday AM and Friday PM")).toEqual([
      { weekday: "Monday", period: "AM" },
      { weekday: "Friday", period: "PM" }
    ]);
    expect(parseContinuityClinicSlots("Tuesday PM")).toEqual([{ weekday: "Tuesday", period: "PM" }]);
    expect(parseContinuityClinicSlots("")).toEqual([]);
    expect(parseContinuityClinicSlots(null)).toEqual([]);
  });

  it("parseContinuityClinicSlots dedupes (by weekday|period) and is order-stable", () => {
    expect(parseContinuityClinicSlots("Tuesday PM, Tuesday PM, Thursday AM")).toEqual([
      { weekday: "Tuesday", period: "PM" },
      { weekday: "Thursday", period: "AM" }
    ]);
    // Unparseable chunks are dropped, valid order preserved.
    expect(parseContinuityClinicSlots("Thursday AM, nonsense, Tuesday PM")).toEqual([
      { weekday: "Thursday", period: "AM" },
      { weekday: "Tuesday", period: "PM" }
    ]);
  });

  it("continuityPeriodsForWeekday returns every blocked period for that weekday", () => {
    expect(continuityPeriodsForWeekday("Tuesday AM, Tuesday PM, Thursday AM", "Tuesday")).toEqual(new Set(["AM", "PM"]));
    expect(continuityPeriodsForWeekday("Tuesday AM, Tuesday PM, Thursday AM", "Thursday")).toEqual(new Set(["AM"]));
    expect(continuityPeriodsForWeekday("Tuesday AM, Tuesday PM, Thursday AM", "Friday")).toEqual(new Set());
  });

  it("formatContinuityClinicSlots round-trips canonical strings", () => {
    const canonical = "Tuesday PM, Thursday AM";
    expect(formatContinuityClinicSlots(parseContinuityClinicSlots(canonical))).toBe(canonical);
    expect(formatContinuityClinicSlots([])).toBe("");
    // parse(format(x)) deep-equals x for valid x
    const x = [{ weekday: "Monday", period: "AM" }, { weekday: "Friday", period: "PM" }];
    expect(parseContinuityClinicSlots(formatContinuityClinicSlots(x))).toEqual(x);
  });

  it("continuityClinicsForDate considers ALL slots, not just the first", () => {
    const block = { id: "b", name: "B", startDate: "2026-05-04", endDate: "2026-05-31", status: "Draft", generate: {}, holidays: [] };
    const rotator = makeRotator("r1", "Multi Slot", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }]);
    rotator.continuityClinic = "Tuesday PM, Thursday AM";
    const state = { version: 2, activeBlockId: "b", serviceBlocks: [block], sources: [], rotators: [rotator], attendings: [], expectedSourcePrograms: [], inpatientAssignments: [], outpatientSessions: [], rules: {}, notes: [] };

    // 2026-05-12 Tuesday → PM bucket (would already pass with the first slot).
    const tue = continuityClinicsForDate(state, "2026-05-12");
    expect(tue.PM.map((r) => r.id)).toEqual(["r1"]);
    // 2026-05-14 Thursday → AM bucket (the SECOND slot — old code missed it).
    const thu = continuityClinicsForDate(state, "2026-05-14");
    expect(thu.AM.map((r) => r.id)).toEqual(["r1"]);
    expect(thu.PM).toHaveLength(0);
  });

  it("detectConflicts flags a SECOND continuity slot (inpatient lands on Thursday)", () => {
    const block = { id: "b", name: "B", startDate: "2026-05-04", endDate: "2026-05-31", status: "Draft", generate: {}, holidays: [] };
    const rotator = makeRotator("r1", "Multi Slot", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }]);
    rotator.continuityClinic = "Tuesday PM, Thursday AM";
    let state = { version: 2, activeBlockId: "b", serviceBlocks: [block], sources: [], rotators: [rotator], attendings: [], expectedSourcePrograms: [], inpatientAssignments: [], outpatientSessions: [], rules: {}, notes: [] };
    // 2026-05-14 is a Thursday — matches the second slot.
    state = scheduleInpatientAssignment(state, { date: "2026-05-14", rotatorId: "r1", role: "Resident" });
    const cc = detectConflicts(state).find((c) => c.type === "continuity-clinic-conflict" && c.date === "2026-05-14");
    expect(cc).toBeTruthy();
  });

  it("does not flag inpatient continuity when a matching first-class half-day fact explains the pull-out", () => {
    const block = { id: "b", name: "B", startDate: "2026-05-04", endDate: "2026-05-31", status: "Draft", generate: {}, holidays: [] };
    const rotator = makeRotator("r1", "Period Aware", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }]);
    rotator.continuityClinic = "Tuesday PM";
    let state = {
      version: 2,
      activeBlockId: "b",
      serviceBlocks: [block],
      sources: [],
      rotators: [rotator],
      attendings: [],
      expectedSourcePrograms: [],
      inpatientAssignments: [],
      outpatientSessions: [],
      halfDayFacts: [{
        id: "half-2026-05-12-pm-r1-clinic",
        date: "2026-05-12",
        period: "PM",
        rotatorId: "r1",
        kind: "inpatient-annotation",
        status: "IP",
        label: "PM Clinic",
        source: "Coordinator DOCX inpatient roster"
      }],
      rules: {},
      notes: []
    };
    state = scheduleInpatientAssignment(state, { date: "2026-05-12", rotatorId: "r1", role: "Resident" });
    const conflicts = detectConflicts(state).filter((c) => c.type === "continuity-clinic-conflict" && c.date === "2026-05-12");
    expect(conflicts).toHaveLength(0);
  });

  it("still flags inpatient continuity when half-day evidence is for the wrong period", () => {
    const block = { id: "b", name: "B", startDate: "2026-05-04", endDate: "2026-05-31", status: "Draft", generate: {}, holidays: [] };
    const rotator = makeRotator("r1", "Wrong Period", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-31" }]);
    rotator.continuityClinic = "Tuesday PM";
    let state = {
      version: 2,
      activeBlockId: "b",
      serviceBlocks: [block],
      sources: [],
      rotators: [rotator],
      attendings: [],
      expectedSourcePrograms: [],
      inpatientAssignments: [],
      outpatientSessions: [],
      halfDayFacts: [{
        id: "half-2026-05-12-am-r1-clinic",
        date: "2026-05-12",
        period: "AM",
        rotatorId: "r1",
        kind: "inpatient-annotation",
        status: "IP",
        label: "AM Clinic",
        source: "Coordinator DOCX inpatient roster"
      }],
      rules: {},
      notes: []
    };
    state = scheduleInpatientAssignment(state, { date: "2026-05-12", rotatorId: "r1", role: "Resident" });
    const cc = detectConflicts(state).find((c) => c.type === "continuity-clinic-conflict" && c.date === "2026-05-12");
    expect(cc).toBeTruthy();
  });

  it("defaults new rotators to no day-off and no time-off ranges", () => {
    const state = createDemoState();
    for (const rotator of state.rotators) {
      expect(Array.isArray(rotator.dayOff)).toBe(true);
      expect(Array.isArray(rotator.unavailableRanges)).toBe(true);
      expect(rotator.dayOff).toHaveLength(0);
      expect(rotator.unavailableRanges).toHaveLength(0);
    }
  });

  it("flags an inpatient assignment that falls on a rotator's day off or time-off range", () => {
    let state = createDemoState();
    const rotatorId = state.rotators[0].id;

    // 2026-05-11 is a Monday. Mark Monday as their day off.
    expect(weekdayName("2026-05-11")).toBe("Monday");
    state = updateRotator(state, rotatorId, { dayOff: ["Monday"] });
    state = scheduleInpatientAssignment(state, {
      date: "2026-05-11",
      rotatorId,
      role: "Team senior"
    });

    let conflicts = detectConflicts(state);
    expect(conflicts.some((c) => c.type === "rotator-unavailable" && c.date === "2026-05-11")).toBe(true);

    // Also flag a range-based absence on a separate day.
    state = updateRotator(state, rotatorId, {
      dayOff: [],
      unavailableRanges: [{ start: "2026-05-10", end: "2026-05-12" }]
    });
    conflicts = detectConflicts(state);
    expect(conflicts.some((c) => c.type === "rotator-unavailable")).toBe(true);

    const rotator = state.rotators.find((r) => r.id === rotatorId);
    expect(isRotatorUnavailable(rotator, "2026-05-11")?.reason).toBe("range");
    expect(isRotatorUnavailable(rotator, "2026-05-20")).toBe(null);
  });

  it("also flags outpatient sessions scheduled on a rotator's day off or time-off range", () => {
    let state = createDemoState();
    const rotatorId = state.rotators[0].id;

    // 2026-05-12 is a Tuesday. Mark Tuesday as the rotator's day off.
    state = updateRotator(state, rotatorId, { dayOff: ["Tuesday"] });
    state = scheduleOutpatientSession(state, {
      date: "2026-05-12",
      period: "AM",
      clinic: "Continuity Clinic",
      provider: "Dr. Test",
      rotatorId
    });

    const conflicts = detectConflicts(state);
    const outpatientConflict = conflicts.find(
      (c) => c.type === "rotator-unavailable" && c.date === "2026-05-12"
    );
    expect(outpatientConflict).toBeTruthy();
    expect(outpatientConflict.detail).toContain("AM");
    expect(outpatientConflict.detail).toContain("Continuity Clinic");
  });

  it("generates a copyable daily report and export manifest locally", () => {
    const state = {
      ...createDemoState(),
      expectedSourcePrograms: ["UT Pediatrics", "Missing Program"],
      sources: [
        {
          id: "source-1",
          fileName: "roster.csv",
          fileType: "csv",
          program: "UT Pediatrics",
          status: "Reviewed",
          importedAt: "2026-07-05",
          importedRotatorCount: 1,
          importWarnings: ["Row 2: missing level."],
          parsedRows: [{ Name: "Drew Quinn" }]
        }
      ]
    };

    expect(generateDailyReport(state, "2026-05-11")).toContain("Daily Team Report");
    expect(generateExportManifest(state).files.map((file) => file.name)).toEqual([
      "manifest.json",
      "roster.json",
      "roster.csv",
      "inpatient-calendar.json",
      "inpatient-calendar.csv",
      "outpatient-calendar.json",
      "outpatient-calendar.csv",
      "daily-reports.txt",
      "legend.json",
      "legend.csv",
      "conflicts.json",
      "conflicts.csv",
      "source-import-summary.json",
      "source-import-summary.csv",
      "schedule-package.json"
    ]);
    const pack = buildExportPackage({
      ...state,
      inpatientAssignments: [
        ...state.inpatientAssignments,
        { id: "ip-off-export", date: "2026-05-05", rotatorId: "rot-ari", role: "Off", source: "Range-Assigned" }
      ]
    });
    expect(pack.inpatientCalendar.length).toBeGreaterThan(0);
    expect(pack.outpatientCalendar.length).toBeGreaterThan(0);
    expect(pack.outpatientCalendar.some((day) =>
      day.clinicAssignments.some((assignment) => assignment.source === "legacy")
    )).toBe(true);
    expect(pack.legend.entries.length).toBeGreaterThan(0);
    expect(pack.sourceSummary.expectedPrograms).toEqual([
      { program: "UT Pediatrics", status: "present" },
      { program: "Missing Program", status: "missing" }
    ]);
    expect(pack.sourceSummary.sources[0].importWarningCount).toBe(1);
    expect(pack.manifest.files.find((file) => file.key === "rosterCsv").format).toBe("csv");
    expect(pack.rosterCsv).toContain("fullName");
    expect(pack.rosterCsv).toContain("Drew Quinn");
    expect(pack.inpatientCalendarCsv).toContain("date,assignmentId,rotatorId,rotatorName,role,source");
    expect(pack.inpatientCalendar.some((day) =>
      day.assignments.some((assignment) => assignment.id === "ip-off-export" || assignment.role === "Off")
    )).toBe(false);
    expect(pack.inpatientCalendarCsv).not.toContain("ip-off-export");
    expect(pack.outpatientCalendarCsv).toContain("kind");
    expect(pack.outpatientCalendarCsv).toContain("legacy");
    expect(pack.legendCsv).toContain("displayLabel");
    expect(pack.conflicts.length).toBeGreaterThan(0);
    expect(pack.manifest.files.find((file) => file.key === "conflictsCsv")).toMatchObject({
      name: "conflicts.csv",
      format: "csv",
      rows: pack.conflicts.length
    });
    expect(pack.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "double-booked",
        date: "2026-05-06",
        rotatorId: "rot-utpeds-1",
        title: "Drew Quinn is double-booked"
      })
    ]));
    expect(pack.conflictsCsv).toContain("id,type,severity,title,detail,date,rotatorId,status,assignment,period");
    expect(pack.conflictsCsv).toContain("conflict-double-2026-05-06-rot-utpeds-1,double-booked,Critical,Drew Quinn is double-booked");
    expect(pack.sourceSummaryCsv).toContain("expectedProgram");
    expect(pack.sourceSummaryCsv).toContain("Missing Program");
    expect(pack.sourceSummaryCsv).toContain("importWarningCount");
    expect(pack.sourceSummaryCsv).toContain("roster.csv,csv,UT Pediatrics,Reviewed,2026-07-05,1,1,1");
    expect(pack.manifest.files.find((file) => file.key === "sourceSummary").rows).toBe(3);
  });

  it("preserves prior rotators when a second rotator is scheduled in the same inpatient role on the same day", () => {
    // Regression: scheduleInpatientAssignment used to filter by (date, role)
    // alone, silently wiping a previously-scheduled rotator any time another
    // got the same role on the same day. Pedi neuro routinely has more than
    // one resident on inpatient simultaneously.
    let state = createDemoState();
    const [a, b] = state.rotators;
    state = scheduleInpatientAssignment(state, { date: "2026-05-07", rotatorId: a.id, role: "Resident" });
    state = scheduleInpatientAssignment(state, { date: "2026-05-07", rotatorId: b.id, role: "Resident" });

    const onThatDay = state.inpatientAssignments.filter((item) => item.date === "2026-05-07");
    expect(onThatDay).toHaveLength(2);
    expect(onThatDay.map((item) => item.rotatorId).sort()).toEqual([a.id, b.id].sort());
    // Re-scheduling the same (rotator, role, date) still upserts to one record.
    state = scheduleInpatientAssignment(state, { date: "2026-05-07", rotatorId: a.id, role: "Resident" });
    expect(state.inpatientAssignments.filter((item) => item.date === "2026-05-07")).toHaveLength(2);
  });

  it("preserves prior rotators when a second rotator is scheduled in the same outpatient slot", () => {
    // Regression: scheduleOutpatientSession used to filter by (date, period)
    // alone. The InpatientPage/OutpatientPage flows in App.jsx loop this
    // function across selected rotators — without rotator-scoped dedupe all
    // but the last rotator were silently dropped from every multi-rotator
    // save.
    let state = createDemoState();
    const [a, b] = state.rotators;
    const args = { date: "2026-05-12", period: "AM", clinic: "Continuity Clinic", provider: "Dr. Test" };
    state = scheduleOutpatientSession(state, { ...args, rotatorId: a.id });
    state = scheduleOutpatientSession(state, { ...args, rotatorId: b.id });

    const inSlot = state.outpatientSessions.filter(
      (item) => item.date === args.date && item.period === args.period
    );
    expect(inSlot).toHaveLength(2);
    expect(inSlot.map((item) => item.rotatorId).sort()).toEqual([a.id, b.id].sort());
    // Re-scheduling the same (rotator, period, date) still upserts.
    state = scheduleOutpatientSession(state, { ...args, rotatorId: a.id });
    expect(state.outpatientSessions.filter(
      (item) => item.date === args.date && item.period === args.period
    )).toHaveLength(2);
  });

  it("preserves normalized nested outpatient details on the parent OP session", () => {
    let state = createDemoState();
    const [rotator] = state.rotators;
    state = scheduleOutpatientSession(state, {
      date: "2026-05-12",
      period: "AM",
      clinic: "Outpatient (clinic TBD)",
      provider: "",
      rotatorId: rotator.id,
      details: [
        { clinic: "  Resident   Continuity ", attending: " Alder " },
        { task: "Inbox follow-up", notes: " after clinic " },
        { clinic: " " }
      ]
    });

    const saved = state.outpatientSessions.find(
      (item) => item.rotatorId === rotator.id && item.date === "2026-05-12" && item.period === "AM"
    );
    expect(saved).toMatchObject({
      details: [
        { clinic: "Resident Continuity", attending: "Alder", task: "", notes: "" },
        { clinic: "", attending: "", task: "Inbox follow-up", notes: "after clinic" }
      ]
    });
  });

  it("dateRange returns the literal calendar dates regardless of host timezone", () => {
    // Regression: the previous implementation built `new Date("...T00:00:00")`
    // (local-midnight) then `toISOString()` (UTC), so any timezone east of
    // UTC dropped one calendar day from every returned date. The fix uses
    // Date.UTC throughout so the answer matches the literal input strings.
    expect(dateRange("2026-05-04", "2026-05-04")).toEqual(["2026-05-04"]);
    const week = dateRange("2026-05-04", "2026-05-10");
    expect(week).toHaveLength(7);
    expect(week[0]).toBe("2026-05-04");
    expect(week.at(-1)).toBe("2026-05-10");
    // crosses DST boundary in many timezones
    const dstWeek = dateRange("2026-03-08", "2026-03-09");
    expect(dstWeek).toEqual(["2026-03-08", "2026-03-09"]);
  });

  it("applyRangeAssignment writes the rotator's own role when args.role is omitted", () => {
    // Regression: range-assign used to hardcode role="Resident", mislabeling
    // fellows and students. Aligns with applyMethodistAutoAssign and
    // applyPreassignments which already used rotator.role.
    let state = createInitialState();
    state = addRotator(state, {
      fullName: "Sam Fellow",
      program: "UT Pediatrics",
      level: "Fellow",
      startDate: state.serviceBlocks[0].startDate,
      endDate: state.serviceBlocks[0].endDate
    });
    const block = state.serviceBlocks[0];
    const rotatorId = state.rotators[0].id;
    const next = applyRangeAssignment(state, block, {
      rotatorId,
      startDate: block.startDate,
      endDate: block.startDate,
      phase: "inpatient"
      // role intentionally omitted
    });
    const recorded = next.inpatientAssignments.find((a) => a.rotatorId === rotatorId);
    expect(recorded?.role).toBe("Fellow");
  });

  it("applyRangeAssignment repaints an existing assignment on a profile-unavailable day", () => {
    // Coordinator 2026-07-29 #5: a day already carrying an IP record stays
    // paintable even when dayOff marks it unavailable — painting OP clears
    // the IP side. A brand-new assignment on that day is still skipped.
    let state = createInitialState();
    state = addRotator(state, {
      fullName: "Kai Doe",
      program: "Other",
      level: "PGY-2",
      startDate: state.serviceBlocks[0].startDate,
      endDate: state.serviceBlocks[0].endDate
    });
    const block = state.serviceBlocks[0];
    const rotatorId = state.rotators[0].id;
    // block start is a Monday in the fixtures? Compute the weekday name of a
    // known in-block date instead of assuming: use the first weekday date.
    const paintDate = block.startDate;
    const weekday = new Date(paintDate + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    state = {
      ...state,
      rotators: state.rotators.map((r) =>
        r.id === rotatorId ? { ...r, dayOff: [weekday] } : r
      ),
      inpatientAssignments: [
        { id: "stale-ip", date: paintDate, rotatorId, role: "Resident", source: "Manual" }
      ]
    };

    const next = applyRangeAssignment(state, block, {
      rotatorId,
      startDate: paintDate,
      endDate: paintDate,
      phase: "outpatient"
    });
    expect(next).not.toBe(state);
    expect(next.inpatientAssignments.filter((a) => a.rotatorId === rotatorId && a.date === paintDate)).toHaveLength(0);
    expect(next.outpatientSessions.some((s2) => s2.rotatorId === rotatorId && s2.date === paintDate)).toBe(true);

    // No existing record: the unavailable day is still skipped (identity no-op).
    const bare = { ...state, inpatientAssignments: [] };
    const noop = applyRangeAssignment(bare, block, {
      rotatorId,
      startDate: paintDate,
      endDate: paintDate,
      phase: "outpatient"
    });
    expect(noop).toBe(bare);
  });

  it("recovers gracefully when a persisted backup carries attendings:null", () => {
    // Regression: migrateLoadedState's "rebuild defaults" branch used to
    // spread strings as if they were profile objects, throwing TypeError,
    // which loadSchedulerState's try/catch swallowed by returning a fresh
    // initial state — silently wiping the user's saved roster and blocks.
    const seed = createInitialState();
    const corrupt = JSON.stringify({ ...seed, attendings: null });
    let migrated;
    expect(() => { migrated = migrateLoadedState(JSON.parse(corrupt)); }).not.toThrow();
    expect(Array.isArray(migrated.attendings)).toBe(true);
    expect(migrated.attendings.length).toBeGreaterThan(0);
    for (const profile of migrated.attendings) {
      expect(typeof profile.name).toBe("string");
      expect(profile.name.length).toBeGreaterThan(0);
      expect(Array.isArray(profile.recurringClinics)).toBe(true);
      expect(Array.isArray(profile.oneOffDates)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Multi-segment rotator support (spec sections 7.2, 7.3, 13.5) — owned by ST-A.
// ---------------------------------------------------------------------------

describe("rotator segments and overlap helpers", () => {
  it("makeRotator builds a rotator with the new segments + schoolType shape", () => {
    const rotator = makeRotator("rot-x", "Test Rotator", "Methodist", "PGY-3", [
      { start: "2026-05-04", end: "2026-05-17" }
    ]);
    expect(rotator.segments).toEqual([{ start: "2026-05-04", end: "2026-05-17" }]);
    expect(rotator.schoolType).toBe("methodist");
    expect("startDate" in rotator).toBe(false);
    expect("endDate" in rotator).toBe(false);
  });

  it("makeRotator with no segments yields an empty array, not undefined", () => {
    const rotator = makeRotator("rot-y", "Empty", "UT Pediatrics", "PGY-2");
    expect(rotator.segments).toEqual([]);
    expect(rotator.schoolType).toBe("ut-peds");
  });

  it("makeRotator silently drops segment entries missing start or end", () => {
    const rotator = makeRotator("rot-z", "Partial", "Other", "Fellow", [
      { start: "2026-05-04", end: "2026-05-10" },
      { start: "", end: "2026-05-15" },
      { start: "2026-05-20", end: "" },
      null
    ]);
    expect(rotator.segments).toEqual([{ start: "2026-05-04", end: "2026-05-10" }]);
  });

  it("inferSchoolType maps every known program and falls back to other", () => {
    expect(inferSchoolType("Methodist")).toBe("methodist");
    expect(inferSchoolType("UT Adult Neuro")).toBe("ut-adult");
    expect(inferSchoolType("UT Pediatrics")).toBe("ut-peds");
    expect(inferSchoolType("UT Med Student")).toBe("ut-student");
    expect(inferSchoolType("UT Psychiatry")).toBe("ut-psychiatry");
    expect(inferSchoolType("Other")).toBe("other");
    expect(inferSchoolType("Bristol Neurology")).toBe("other");
    expect(inferSchoolType("")).toBe("other");
    expect(inferSchoolType(undefined)).toBe("other");
  });

  it("isRotatorActiveOn returns true only for dates inside a segment", () => {
    const rotator = makeRotator("rot-multi", "Multi", "Methodist", "PGY-3", [
      { start: "2026-05-01", end: "2026-05-07" },
      { start: "2026-05-24", end: "2026-05-31" }
    ]);
    expect(isRotatorActiveOn(rotator, "2026-05-04")).toBe(true);
    expect(isRotatorActiveOn(rotator, "2026-05-07")).toBe(true);
    expect(isRotatorActiveOn(rotator, "2026-05-08")).toBe(false);
    expect(isRotatorActiveOn(rotator, "2026-05-23")).toBe(false);
    expect(isRotatorActiveOn(rotator, "2026-05-24")).toBe(true);
    expect(isRotatorActiveOn(rotator, "2026-05-31")).toBe(true);
    expect(isRotatorActiveOn(rotator, "2026-06-01")).toBe(false);
  });

  it("isRotatorActiveOn is safe when segments are missing, empty, or malformed", () => {
    expect(isRotatorActiveOn(null, "2026-05-04")).toBe(false);
    expect(isRotatorActiveOn({}, "2026-05-04")).toBe(false);
    expect(isRotatorActiveOn({ segments: [] }, "2026-05-04")).toBe(false);
    expect(isRotatorActiveOn({ segments: [{ start: "", end: "" }] }, "2026-05-04")).toBe(false);
    expect(isRotatorActiveOn({ segments: [{ start: "2026-05-04", end: "2026-05-04" }] }, "")).toBe(false);
  });

  it("expandRotatorDatesInBlock returns only dates inside both block and a segment", () => {
    const rotator = makeRotator("rot-q", "Q", "UT Pediatrics", "PGY-2", [
      { start: "2026-05-01", end: "2026-05-07" },
      { start: "2026-05-15", end: "2026-05-31" }
    ]);
    const block = { startDate: "2026-05-04", endDate: "2026-05-20" };
    const dates = expandRotatorDatesInBlock(rotator, block);
    // First segment overlap: May 4-7 (4 days). Second segment overlap: May 15-20 (6 days).
    expect(dates).toEqual([
      "2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07",
      "2026-05-15", "2026-05-16", "2026-05-17", "2026-05-18", "2026-05-19", "2026-05-20"
    ]);
  });

  it("expandRotatorDatesInBlock returns [] when block window or rotator misses", () => {
    expect(expandRotatorDatesInBlock(null, {})).toEqual([]);
    expect(expandRotatorDatesInBlock({}, null)).toEqual([]);
    expect(expandRotatorDatesInBlock(
      makeRotator("r", "R", "Other", "Fellow", [{ start: "2026-06-01", end: "2026-06-30" }]),
      { startDate: "2026-05-04", endDate: "2026-05-31" }
    )).toEqual([]);
  });

  it("activeRotatorsOn excludes rotators with no segment covering the date", () => {
    const state = createDemoState();
    // The student segment is 2026-05-11..2026-05-24; on May 4 they should be excluded.
    const may4 = activeRotatorsOn(state, "2026-05-04").map((r) => r.displayName).sort();
    expect(may4).toEqual(["Drew Quinn", "Maya Lopez", "Noah Patel", "Sam Carter"]);

    // On May 12 the student is active.
    const may12 = activeRotatorsOn(state, "2026-05-12").map((r) => r.displayName).sort();
    expect(may12).toContain("Elena Ruiz");

    // Outside any rotator's segments the result is empty.
    expect(activeRotatorsOn(state, "2030-01-01")).toEqual([]);
    expect(activeRotatorsOn({}, "2026-05-12")).toEqual([]);
  });

  it("continuityClinicsForDate respects multi-segment rotators (no false positives outside segments)", () => {
    const state = createDemoState();
    // Noah Patel's segment ends 2026-05-17. 2026-05-19 is a Tuesday with Maya only.
    expect(weekdayName("2026-05-19")).toBe("Tuesday");
    const tuesday = continuityClinicsForDate(state, "2026-05-19");
    expect(tuesday.PM.map((r) => r.displayName).sort()).toEqual(["Maya Lopez"]);
  });
});

describe("storage migration of legacy rotator shape", () => {
  function legacyRotator(extra = {}) {
    return {
      id: "rot-legacy",
      fullName: "Legacy Rotator",
      displayName: "Legacy Rotator",
      program: "Methodist",
      level: "PGY-3",
      role: "Resident",
      startDate: "2026-05-04",
      endDate: "2026-05-31",
      continuityClinic: "Tuesday PM",
      dayOff: [],
      unavailableRanges: [],
      ...extra
    };
  }

  function wrap(rotators) {
    return {
      version: 1,
      activeBlockId: "block-x",
      serviceBlocks: [{
        id: "block-x",
        name: "X",
        startDate: "2026-05-04",
        endDate: "2026-05-31",
        status: "Draft",
        generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
        holidays: []
      }],
      sources: [],
      rotators,
      attendings: [],
      expectedSourcePrograms: [],
      inpatientAssignments: [],
      outpatientSessions: [],
      halfDayFacts: [],
      clinicAssignments: [],
      posterSettings: {
        programName: "Pediatric Neurology Residency",
        chief: "",
        notes: [
          "Please arrive 15 minutes before clinic starts.",
          "Check Epic for patient lists and clinic location details.",
          "Notify the chief of any schedule conflicts as soon as possible.",
          "This schedule is subject to change."
        ],
        locations: [{ name: "Main Campus", address: "" }],
        tagline: "Thank you for all you do for our patients!"
      },
      rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
      notes: []
    };
  }

  it("upgrades legacy startDate/endDate into a single segment", () => {
    const migrated = migrateLoadedState(wrap([legacyRotator()]));
    const r = migrated.rotators[0];
    expect(r.segments).toEqual([{ start: "2026-05-04", end: "2026-05-31" }]);
    expect("startDate" in r).toBe(false);
    expect("endDate" in r).toBe(false);
    expect(r.schoolType).toBe("methodist");
  });

  it("legacy rotator missing one endpoint migrates to empty segments and discards partial fields", () => {
    const half = legacyRotator({ startDate: "2026-05-04", endDate: "" });
    const migrated = migrateLoadedState(wrap([half]));
    expect(migrated.rotators[0].segments).toEqual([]);
    expect("startDate" in migrated.rotators[0]).toBe(false);
    expect("endDate" in migrated.rotators[0]).toBe(false);
  });

  it("migration is idempotent — running twice gives the same shape", () => {
    const once = migrateLoadedState(wrap([legacyRotator()]));
    const twice = migrateLoadedState(once);
    expect(twice.rotators).toEqual(once.rotators);
  });

  it("repairs persisted Psychiatry rows and their linked Fellow assignments", () => {
    const stored = wrap([{
      id: "rot-kai",
      fullName: "Kai Doe",
      displayName: "Kai Doe",
      program: "UT Psychiatry",
      level: "PGY-5",
      role: "Fellow",
      segments: [{ start: "2026-05-04", end: "2026-05-31" }],
      schoolType: "ut-psychiatry",
      continuityClinic: "",
      dayOff: [],
      unavailableRanges: []
    }]);
    stored.inpatientAssignments = [{
      id: "keep-this-id",
      date: "2026-05-04",
      rotatorId: "rot-kai",
      role: "Fellow",
      source: "Auto-Draft"
    }];

    const migrated = migrateLoadedState(stored);
    expect(migrated.rotators[0]).toMatchObject({ role: "Resident", level: "PGY-5" });
    expect(migrated.inpatientAssignments[0]).toMatchObject({ id: "keep-this-id", role: "Resident" });
    expect(migrateLoadedState(migrated)).toBe(migrated);
  });

  it("state already on the new schema is returned unchanged (referential identity preserved when nothing changes)", () => {
    const newShape = wrap([
      {
        id: "rot-new",
        fullName: "Already New",
        displayName: "Already New",
        program: "UT Pediatrics",
        level: "PGY-2",
        role: "Resident",
        segments: [{ start: "2026-05-04", end: "2026-05-31" }],
        schoolType: "ut-peds",
        continuityClinic: "",
        dayOff: [],
        unavailableRanges: []
      }
    ]);
    const out = migrateLoadedState(newShape);
    expect(out).toBe(newShape);
  });

  it("parseState runs the migration so a legacy backup file loads cleanly", () => {
    const legacyBackup = JSON.stringify(wrap([legacyRotator()]));
    const state = parseState(legacyBackup);
    expect(state.rotators[0].segments).toEqual([{ start: "2026-05-04", end: "2026-05-31" }]);
    expect(state.rotators[0].schoolType).toBe("methodist");
    expect("startDate" in state.rotators[0]).toBe(false);
  });

  it("legacy rotator with unknown program migrates schoolType to other", () => {
    const unknown = legacyRotator({ program: "Surgery", schoolType: undefined });
    const migrated = migrateLoadedState(wrap([unknown]));
    expect(migrated.rotators[0].schoolType).toBe("other");
  });

  it("loadSchedulerState migrates a legacy localStorage payload end-to-end", () => {
    const legacyJson = JSON.stringify(wrap([legacyRotator()]));
    const fakeStorage = {
      _data: { "pedi-scheduler-react-state": legacyJson },
      getItem(key) { return this._data[key] ?? null; },
      setItem(key, value) { this._data[key] = value; },
      removeItem(key) { delete this._data[key]; }
    };
    const state = loadSchedulerState(fakeStorage);
    expect(state.rotators).toHaveLength(1);
    expect(state.rotators[0].segments).toEqual([{ start: "2026-05-04", end: "2026-05-31" }]);
    expect(state.rotators[0].schoolType).toBe("methodist");
    expect("startDate" in state.rotators[0]).toBe(false);
    expect("endDate" in state.rotators[0]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Coverage gap that let ENG-001 / ENG-002 ship: migrateLoadedState never
// descended into service blocks or `state.rules`, so an OLD saved state could
// load missing `block.holidays` (crashing detectConflicts during render) and
// missing `rules.maxConsecutiveInpatientDays` (silently disabling the cap).
// These tests build pre-field-existence states and prove the migration
// backfills them additively without clobbering user values or extra fields.
describe("storage migration of old service-block / rules shape (ENG-001 / ENG-002)", () => {
  // A complete, valid old-shape state, but with `holidays` and `rules`
  // controllable via overrides so we can simulate states created before
  // those fields existed. Mirrors the canonical shape used elsewhere.
  function oldShapeState({ block = {}, rules, extra = {} } = {}) {
    const serviceBlock = {
      id: "block-old",
      name: "Old Block",
      startDate: "2026-05-04",
      endDate: "2026-05-31",
      status: "Draft",
      generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
      ...block
    };
    const state = {
      version: 1,
      activeBlockId: "block-old",
      serviceBlocks: [serviceBlock],
      sources: [],
      rotators: [
        {
          id: "rot-1",
          fullName: "Old Rotator",
          displayName: "Old Rotator",
          program: "UT Pediatrics",
          level: "PGY-2",
          role: "Resident",
          segments: [{ start: "2026-05-04", end: "2026-05-31" }],
          schoolType: "ut-peds",
          continuityClinic: "",
          dayOff: [],
          unavailableRanges: []
        }
      ],
      attendings: [{ name: "Alder", recurringClinics: [], oneOffDates: [] }],
      expectedSourcePrograms: ["UT Pediatrics"],
      inpatientAssignments: [],
      outpatientSessions: [],
      halfDayFacts: [],
      clinicAssignments: [],
      posterSettings: {
        programName: "Pediatric Neurology Residency",
        chief: "",
        notes: [
          "Please arrive 15 minutes before clinic starts.",
          "Check Epic for patient lists and clinic location details.",
          "Notify the chief of any schedule conflicts as soon as possible.",
          "This schedule is subject to change."
        ],
        locations: [{ name: "Main Campus", address: "" }],
        tagline: "Thank you for all you do for our patients!"
      },
      notes: [],
      ...extra
    };
    if (rules !== undefined) state.rules = rules;
    return state;
  }

  it("backfills missing block.holidays to [] and detectConflicts does not throw", () => {
    // Old block created before `holidays` existed: key absent entirely.
    const state = oldShapeState();
    expect("holidays" in state.serviceBlocks[0]).toBe(false);

    let migrated;
    expect(() => { migrated = migrateLoadedState(state); }).not.toThrow();
    expect(migrated.serviceBlocks[0].holidays).toEqual([]);
    // ENG-001: detectConflicts runs unconditionally during render.
    expect(() => detectConflicts(migrated)).not.toThrow();
  });

  it("adds a full rules object with every default key when rules is absent", () => {
    const state = oldShapeState();
    expect("rules" in state).toBe(false);

    let migrated;
    expect(() => { migrated = migrateLoadedState(state); }).not.toThrow();
    expect(migrated.rules).toEqual({
      maxConsecutiveInpatientDays: 6,
      honorNoClinicHolidays: true
    });
    expect(() => detectConflicts(migrated)).not.toThrow();
  });

  it("backfills only the missing default rule key on a PARTIAL rules object", () => {
    // Has honorNoClinicHolidays but is missing maxConsecutiveInpatientDays
    // (the key whose absence silently disabled the consecutive-day cap).
    const state = oldShapeState({
      rules: { honorNoClinicHolidays: true }
    });
    expect("maxConsecutiveInpatientDays" in state.rules).toBe(false);

    const migrated = migrateLoadedState(state);
    expect(migrated.rules.maxConsecutiveInpatientDays).toBe(6);
    expect(migrated.rules.honorNoClinicHolidays).toBe(true);
  });

  it("preserves a user-set rule value instead of resetting it to the default (HLD-INV-010)", () => {
    const state = oldShapeState({
      rules: { maxConsecutiveInpatientDays: 9 } // user raised the cap; must win
    });
    const migrated = migrateLoadedState(state);
    expect(migrated.rules.maxConsecutiveInpatientDays).toBe(9); // NOT reset to 6
    // The other default is still backfilled.
    expect(migrated.rules.honorNoClinicHolidays).toBe(true);
  });

  it("backfills posterSettings when absent and preserves a user-edited value (poster feature)", () => {
    const state = oldShapeState({ extra: { posterSettings: undefined } });
    delete state.posterSettings; // legacy state predates the field
    expect("posterSettings" in state).toBe(false);

    const migrated = migrateLoadedState(state);
    expect(migrated.posterSettings.programName).toBe("Pediatric Neurology Residency");
    expect(Array.isArray(migrated.posterSettings.notes)).toBe(true);

    // Partial object: a user-edited chief must survive; missing keys backfilled.
    const partial = oldShapeState({ extra: { posterSettings: { chief: "Dr. Custom" } } });
    const migratedPartial = migrateLoadedState(partial);
    expect(migratedPartial.posterSettings.chief).toBe("Dr. Custom");
    expect(migratedPartial.posterSettings.tagline).toBe("Thank you for all you do for our patients!");
  });

  it("preserves unknown/extra top-level and block fields through the migration", () => {
    const state = oldShapeState({
      block: { coverage: { weekday: { ip: { count: 2 } } } }, // extra block field
      extra: { uiPrefs: { theme: "dark" } } // extra top-level field
    });
    const migrated = migrateLoadedState(state);
    // Extra fields survive (we spread the originals, never whitelist-rebuild).
    expect(migrated.uiPrefs).toEqual({ theme: "dark" });
    expect(migrated.serviceBlocks[0].coverage).toEqual({ weekday: { ip: { count: 2 } } });
    // And the backfill still happened alongside the preserved fields.
    expect(migrated.serviceBlocks[0].holidays).toEqual([]);
    expect(migrated.rules.maxConsecutiveInpatientDays).toBe(6);
  });

  it("backfills and normalizes source records into the declared state contract", () => {
    const state = oldShapeState({
      extra: {
        sources: [
          {
            fileName: 123,
            importWarningCount: null,
            importedRotatorCount: -1,
            importWarnings: ["ok", 42],
            parsedRows: "not rows"
          }
        ]
      }
    });

    const migrated = migrateLoadedState(state);
    expect(migrated.sources).toEqual([
      {
        id: "source-123-1",
        fileName: "123",
        importWarnings: ["ok"]
      }
    ]);
  });

  it("is idempotent — backfilling then migrating again yields the same shape", () => {
    // First pass backfills holidays + rules; second pass must not change them.
    const migrated = migrateLoadedState(oldShapeState());
    const twice = migrateLoadedState(migrated);
    expect(twice.serviceBlocks).toEqual(migrated.serviceBlocks);
    expect(twice.rules).toEqual(migrated.rules);
  });

  it("returns the original reference when holidays + rules are already present (no needless rewrite)", () => {
    // Attendings are empty here so the pre-existing attendings-lift branch
    // also no-ops; this isolates the holidays/rules additions and proves they
    // don't flip the `changed` flag when nothing is missing (HLD-INV-011).
    const complete = oldShapeState({
      block: { holidays: [] },
      rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
      extra: { attendings: [] }
    });
    expect(migrateLoadedState(complete)).toBe(complete);
  });
});

// ============================================================================
// Sub-team B — program-specific scheduling rules (spec §9.1–§9.5, §25.3–§25.4)
// ============================================================================

function methodistRotator(overrides = {}) {
  // Use `in` so callers can explicitly pass `undefined` to clear a
  // field (e.g. testing missing rotationStartDate).
  const base = {
    id: overrides.id || "rot-methodist-test",
    fullName: overrides.fullName || "Casey Methodist",
    displayName: overrides.displayName || overrides.fullName || "Casey Methodist",
    program: "Methodist",
    schoolType: "methodist",
    level: overrides.level || "PGY-3",
    role: overrides.role || "Resident",
    segments: overrides.segments || [{ start: "2026-05-20", end: "2026-06-16" }],
    rotationStartDate: "rotationStartDate" in overrides
      ? overrides.rotationStartDate
      : "2026-05-20",
    continuityClinic: "",
    dayOff: [],
    unavailableRanges: []
  };
  return base;
}

function blockOf(name, start, end) {
  return {
    id: `block-${name}`,
    name,
    startDate: start,
    endDate: end,
    status: "Draft",
    generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
    holidays: []
  };
}

describe("getRotatorPhase — Methodist 14/14 phase computation (spec §9.1)", () => {
  it("returns outpatient for days 0..13 of the 28-day rotation", () => {
    const rotator = methodistRotator(); // start 2026-05-20
    expect(getRotatorPhase(rotator, "2026-05-20")).toBe("outpatient"); // day 0
    expect(getRotatorPhase(rotator, "2026-05-21")).toBe("outpatient"); // day 1
    expect(getRotatorPhase(rotator, "2026-06-02")).toBe("outpatient"); // day 13
  });

  it("returns inpatient for days 14..27 (day 14 is the boundary into inpatient)", () => {
    const rotator = methodistRotator();
    expect(getRotatorPhase(rotator, "2026-06-03")).toBe("inpatient"); // day 14
    expect(getRotatorPhase(rotator, "2026-06-10")).toBe("inpatient"); // day 21
    expect(getRotatorPhase(rotator, "2026-06-16")).toBe("inpatient"); // day 27 (last day)
  });

  it("returns null outside the 28-day rotation window", () => {
    const rotator = methodistRotator();
    expect(getRotatorPhase(rotator, "2026-05-19")).toBeNull(); // day -1
    expect(getRotatorPhase(rotator, "2026-06-17")).toBeNull(); // day 28
    expect(getRotatorPhase(rotator, "2026-07-01")).toBeNull();
  });

  it("derives the start from the first scheduled day when rotationStartDate is missing", () => {
    // Coordinator 2026-07-10: the first scheduled day counts as day 1.
    const rotator = methodistRotator({ rotationStartDate: undefined });
    expect(getRotatorPhase(rotator, "2026-05-20")).toBe("outpatient"); // derived day 0
    expect(getRotatorPhase(rotator, "2026-06-03")).toBe("inpatient"); // derived day 14
  });

  it("returns null when neither rotationStartDate nor segments exist", () => {
    const rotator = methodistRotator({ rotationStartDate: undefined, segments: [] });
    expect(getRotatorPhase(rotator, "2026-06-03")).toBeNull();
  });

  it("splits rotations shorter than 28 days in half (26-day block -> 13/13)", () => {
    // Coordinator 2026-07-10: e.g. Blair's 26-day July block is 13 OP / 13 IP,
    // not a truncated 14/14.
    const rotator = methodistRotator({
      rotationStartDate: undefined,
      segments: [{ start: "2026-07-01", end: "2026-07-26" }]
    });
    expect(getRotatorPhase(rotator, "2026-07-01")).toBe("outpatient"); // day 0
    expect(getRotatorPhase(rotator, "2026-07-13")).toBe("outpatient"); // day 12 (last OP day)
    expect(getRotatorPhase(rotator, "2026-07-14")).toBe("inpatient"); // day 13 (boundary)
    expect(getRotatorPhase(rotator, "2026-07-26")).toBe("inpatient"); // day 25 (last day)
    expect(getRotatorPhase(rotator, "2026-07-27")).toBeNull(); // past the rotation
  });

  it("puts the extra day of an odd-length rotation on the first side", () => {
    const rotator = methodistRotator({
      rotationStartDate: undefined,
      segments: [{ start: "2026-07-01", end: "2026-07-27" }] // 27 days -> 14/13
    });
    expect(getRotatorPhase(rotator, "2026-07-14")).toBe("outpatient"); // day 13 (14th OP day)
    expect(getRotatorPhase(rotator, "2026-07-15")).toBe("inpatient"); // day 14 (boundary)
  });

  it("returns null for non-methodist rotators regardless of date", () => {
    const utAdult = {
      id: "x",
      program: "UT Adult Neuro",
      schoolType: "ut-adult",
      rotationStartDate: "2026-05-20",
      segments: [{ start: "2026-05-04", end: "2026-05-17" }]
    };
    expect(getRotatorPhase(utAdult, "2026-05-10")).toBeNull();
    expect(getRotatorPhase(utAdult, "2026-06-03")).toBeNull();
  });

  it("falls back to legacy program field when schoolType is not yet set", () => {
    // Pre-migration rotator: no schoolType, but program === "Methodist".
    const rotator = {
      id: "legacy-methodist",
      program: "Methodist",
      role: "Resident",
      rotationStartDate: "2026-05-20",
      segments: [{ start: "2026-05-20", end: "2026-06-16" }]
    };
    expect(getRotatorPhase(rotator, "2026-05-25")).toBe("outpatient");
    expect(getRotatorPhase(rotator, "2026-06-05")).toBe("inpatient");
  });

  it("handles null/missing inputs gracefully", () => {
    expect(getRotatorPhase(null, "2026-06-03")).toBeNull();
    expect(getRotatorPhase(methodistRotator(), null)).toBeNull();
    expect(getRotatorPhase(methodistRotator(), "")).toBeNull();
  });
});

describe("applyMethodistAutoAssign — spec §9.1 worked example", () => {
  it("matches the spec §9.1 example exactly (Methodist May 20 – June 16, pedi block June 1 – June 30)", () => {
    // Spec text:
    //   Methodist rotation:   May 20 – June 16
    //   Outpatient segment:   May 20 – June 2
    //   Inpatient segment:    June 3 – June 16
    //   Selected service block: June 1 – June 30
    //   Correct visible assignment:
    //     June 1 – June 2: outpatient
    //     June 3 – June 16: inpatient
    const rotator = methodistRotator({
      id: "rot-spec-example",
      // The rotator's segments may be the full rotation or clipped to the
      // block; the rule must work either way. Use the full rotation here.
      segments: [{ start: "2026-05-20", end: "2026-06-16" }],
      rotationStartDate: "2026-05-20"
    });
    const block = blockOf("june-2026", "2026-06-01", "2026-06-30");
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [rotator],
      inpatientAssignments: [],
      outpatientSessions: []
    };

    const next = applyMethodistAutoAssign(state, block);

    const inpatientDates = next.inpatientAssignments
      .filter((item) => item.rotatorId === rotator.id)
      .map((item) => item.date)
      .sort();
    const outpatientDates = [
      ...new Set(
        next.outpatientSessions
          .filter((item) => item.rotatorId === rotator.id)
          .map((item) => item.date)
      )
    ].sort();

    // June 1 – June 2 visible as outpatient.
    expect(outpatientDates).toContain("2026-06-01");
    expect(outpatientDates).toContain("2026-06-02");
    // June 3 – June 16 visible as inpatient (14 inpatient days).
    expect(inpatientDates).toEqual([
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
      "2026-06-15",
      "2026-06-16"
    ]);
    // June 17+ in the block are AFTER rotation ends → no assignment.
    expect(inpatientDates.find((d) => d > "2026-06-16")).toBeUndefined();
    expect(outpatientDates.find((d) => d > "2026-06-16")).toBeUndefined();
    // May 20 – May 31 are outside the block → not visible in this block.
    expect(outpatientDates.find((d) => d < "2026-06-01")).toBeUndefined();
  });

  it("preserves cross-block continuity: rotation straddling two blocks does not reset at the boundary (spec §25.4)", () => {
    // Methodist rotation runs May 20 → June 16. Day 14 (first inpatient
    // day) is June 3. Pedi block A is May 4 – May 31, pedi block B is
    // June 1 – June 30. Applying the rule to each block must yield the
    // SAME phase for each calendar day — the rotator must not "reset"
    // to outpatient on June 1.
    const rotator = methodistRotator({
      id: "rot-cross-block",
      segments: [{ start: "2026-05-20", end: "2026-06-16" }],
      rotationStartDate: "2026-05-20"
    });
    const blockA = blockOf("may-2026", "2026-05-04", "2026-05-31");
    const blockB = blockOf("june-2026", "2026-06-01", "2026-06-30");
    const baseState = {
      ...createInitialState(),
      activeBlockId: blockA.id,
      serviceBlocks: [blockA, blockB],
      rotators: [rotator],
      inpatientAssignments: [],
      outpatientSessions: []
    };

    let state = applyMethodistAutoAssign(baseState, blockA);
    state = applyMethodistAutoAssign(state, blockB);

    const inpatient = state.inpatientAssignments
      .filter((a) => a.rotatorId === rotator.id)
      .map((a) => a.date)
      .sort();
    const outpatient = [
      ...new Set(
        state.outpatientSessions
          .filter((s) => s.rotatorId === rotator.id)
          .map((s) => s.date)
      )
    ].sort();

    // May 20 – June 2 inclusive should be outpatient (14 days).
    // June 3 – June 16 inclusive should be inpatient (14 days).
    // Total visible days in both blocks combined: 28.
    // OP dates exclude Saturdays / Sundays — Methodist outpatient
    // clinics don't run on weekends. 5/23 + 5/24 + 5/30 + 5/31 are
    // dropped from the list relative to the raw rotation calendar.
    expect(outpatient).toEqual([
      "2026-05-20", // Wed
      "2026-05-21", // Thu
      "2026-05-22", // Fri
      "2026-05-25", // Mon
      "2026-05-26", // Tue
      "2026-05-27", // Wed
      "2026-05-28", // Thu
      "2026-05-29", // Fri
      "2026-06-01", // Mon
      "2026-06-02"  // Tue
    ]);
    expect(inpatient).toEqual([
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
      "2026-06-15",
      "2026-06-16"
    ]);

    // Crucially: June 1 (first day of block B) is day 12 = outpatient,
    // NOT day 0 of a fresh phase.
    expect(getRotatorPhase(rotator, "2026-06-01")).toBe("outpatient");
    // And June 3 is inpatient even though it's only the 3rd day of the
    // pedi block.
    expect(getRotatorPhase(rotator, "2026-06-03")).toBe("inpatient");
  });

  it("handles a rotation that spans three pedi blocks (rotation = 28 days, blocks = 2 weeks each)", () => {
    // Synthetic: imagine the institution were running 14-day mini-blocks.
    // Rotation May 20 – June 16. Mini-blocks: May 11–24, May 25–Jun 7, Jun 8–21.
    const rotator = methodistRotator({
      id: "rot-three-blocks",
      segments: [{ start: "2026-05-20", end: "2026-06-16" }],
      rotationStartDate: "2026-05-20"
    });
    const blocks = [
      blockOf("mini-1", "2026-05-11", "2026-05-24"),
      blockOf("mini-2", "2026-05-25", "2026-06-07"),
      blockOf("mini-3", "2026-06-08", "2026-06-21")
    ];
    let state = {
      ...createInitialState(),
      activeBlockId: blocks[0].id,
      serviceBlocks: blocks,
      rotators: [rotator],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    for (const block of blocks) state = applyMethodistAutoAssign(state, block);

    const inpatient = state.inpatientAssignments
      .filter((a) => a.rotatorId === rotator.id)
      .map((a) => a.date)
      .sort();
    const outpatientDates = [
      ...new Set(
        state.outpatientSessions
          .filter((s) => s.rotatorId === rotator.id)
          .map((s) => s.date)
      )
    ];
    // Inpatient still spans all 14 days of the IP half (Sat/Sun
    // included — hospital coverage is 24/7). Outpatient is 10 because
    // 4 Sat/Sun days in the OP half are skipped (no weekend clinics).
    expect(inpatient).toHaveLength(14);
    expect(outpatientDates).toHaveLength(10);
    expect(inpatient[0]).toBe("2026-06-03"); // day 14
    expect(inpatient.at(-1)).toBe("2026-06-16"); // day 27
  });

  it("is idempotent: re-running on the same state does not create duplicates", () => {
    const rotator = methodistRotator();
    const block = blockOf("june-2026", "2026-06-01", "2026-06-30");
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [rotator],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    const once = applyMethodistAutoAssign(state, block);
    const twice = applyMethodistAutoAssign(once, block);
    const thrice = applyMethodistAutoAssign(twice, block);

    expect(twice.inpatientAssignments.length).toBe(once.inpatientAssignments.length);
    expect(twice.outpatientSessions.length).toBe(once.outpatientSessions.length);
    expect(thrice.inpatientAssignments.length).toBe(once.inpatientAssignments.length);
    expect(thrice.outpatientSessions.length).toBe(once.outpatientSessions.length);
  });

  it("preserves manual inpatient assignments and does not overwrite them", () => {
    const rotator = methodistRotator();
    const block = blockOf("june-2026", "2026-06-01", "2026-06-30");
    // Pre-seed a manual inpatient assignment on June 5 (a day the rule
    // would also auto-assign). The manual entry must survive untouched.
    const manualEntry = {
      id: "manual-existing",
      date: "2026-06-05",
      rotatorId: rotator.id,
      role: "Resident",
      source: "Manual",
      note: "manual override"
    };
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [rotator],
      inpatientAssignments: [manualEntry],
      outpatientSessions: []
    };
    const next = applyMethodistAutoAssign(state, block);
    const june5 = next.inpatientAssignments.filter(
      (a) => a.date === "2026-06-05" && a.rotatorId === rotator.id && a.role === "Resident"
    );
    expect(june5).toHaveLength(1);
    expect(june5[0].id).toBe("manual-existing");
    expect(june5[0].source).toBe("Manual");
    expect(june5[0].note).toBe("manual override");
    // Auto-tagged assignments still added on the other inpatient days.
    expect(
      next.inpatientAssignments.some(
        (a) => a.source === "Auto-Methodist" && a.date === "2026-06-04"
      )
    ).toBe(true);
  });

  it("only schedules days where the rotator is active per their segments", () => {
    // Rotator's rotation is May 20 – Jun 16, but they only have a
    // single segment covering June 5 – June 16 (e.g. arrived late).
    const rotator = methodistRotator({
      id: "rot-clipped",
      segments: [{ start: "2026-06-05", end: "2026-06-16" }],
      rotationStartDate: "2026-05-20"
    });
    const block = blockOf("june-2026", "2026-06-01", "2026-06-30");
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [rotator],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    const next = applyMethodistAutoAssign(state, block);
    const dates = next.inpatientAssignments
      .filter((a) => a.rotatorId === rotator.id)
      .map((a) => a.date)
      .sort();
    expect(dates).toEqual([
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
      "2026-06-15",
      "2026-06-16"
    ]);
    // June 1–4 are still inside the rotation's outpatient window AND
    // inside the pedi block, but the rotator isn't active per segments
    // → nothing should be assigned for those days.
    expect(
      next.outpatientSessions.some(
        (s) => s.rotatorId === rotator.id && s.date < "2026-06-05"
      )
    ).toBe(false);
  });

  it("auto-assigns from the derived start when rotationStartDate is missing", () => {
    // Coordinator 2026-07-10: first scheduled day (2026-05-20) counts as day 1,
    // so June 3 onward is the inpatient fortnight inside this block.
    const rotator = methodistRotator({ rotationStartDate: undefined });
    const block = blockOf("june-2026", "2026-06-01", "2026-06-30");
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [rotator],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    const next = applyMethodistAutoAssign(state, block);
    const ipDates = next.inpatientAssignments.map((a) => a.date).sort();
    expect(ipDates[0]).toBe("2026-06-03");
    expect(ipDates[ipDates.length - 1]).toBe("2026-06-16");
    expect(next.outpatientSessions.length).toBeGreaterThan(0); // June 1-2 OP tail
  });

  it("ignores Methodist rotators with no rotationStartDate and no segments", () => {
    const rotator = methodistRotator({ rotationStartDate: undefined, segments: [] });
    const block = blockOf("june-2026", "2026-06-01", "2026-06-30");
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [rotator],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    const next = applyMethodistAutoAssign(state, block);
    expect(next.inpatientAssignments).toHaveLength(0);
    expect(next.outpatientSessions).toHaveLength(0);
  });

  it("ignores non-methodist rotators entirely", () => {
    const utAdult = {
      id: "ut-1",
      fullName: "Sam UT",
      displayName: "Sam UT",
      program: "UT Adult Neuro",
      schoolType: "ut-adult",
      role: "Resident",
      rotationStartDate: "2026-05-20", // present, but irrelevant
      segments: [{ start: "2026-06-01", end: "2026-06-14" }],
      continuityClinic: "",
      dayOff: [],
      unavailableRanges: []
    };
    const block = blockOf("june-2026", "2026-06-01", "2026-06-30");
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [utAdult],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    const next = applyMethodistAutoAssign(state, block);
    expect(next.inpatientAssignments).toHaveLength(0);
    expect(next.outpatientSessions).toHaveLength(0);
  });

  it("returns the original state object unchanged when nothing applies", () => {
    const block = blockOf("june-2026", "2026-06-01", "2026-06-30");
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    const next = applyMethodistAutoAssign(state, block);
    expect(next).toBe(state);
  });

  it("does not auto-book over a rotator's continuity clinic on outpatient days (spec §15.2)", () => {
    // Methodist rotator with "Tuesday PM" continuity clinic and a
    // rotation that puts them in outpatient phase on those Tuesdays.
    // The auto-rule must skip the PM period of those Tuesdays so the
    // continuity-clinic commitment survives untouched and the conflict
    // detector doesn't have to flag it later.
    const rotator = methodistRotator({
      id: "rot-tuesday-clinic",
      rotationStartDate: "2026-05-20" // outpatient through Jun 2
    });
    rotator.continuityClinic = "Tuesday PM";
    const block = blockOf("june-2026", "2026-06-01", "2026-06-30");
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [rotator],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    const next = applyMethodistAutoAssign(state, block);

    // 2026-06-02 is a Tuesday and is in the rotator's outpatient phase
    // (rotation day 13). The AM "Methodist Outpatient" entry should
    // exist; the PM entry must NOT exist (continuity-clinic wins).
    expect(
      next.outpatientSessions.some(
        (s) =>
          s.rotatorId === rotator.id &&
          s.date === "2026-06-02" &&
          s.period === "AM" &&
          s.clinic === METHODIST_OP_CLINIC
      )
    ).toBe(true);
    expect(
      next.outpatientSessions.some(
        (s) =>
          s.rotatorId === rotator.id &&
          s.date === "2026-06-02" &&
          s.period === "PM" &&
          s.clinic === METHODIST_OP_CLINIC
      )
    ).toBe(false);

    // 2026-06-01 is a Monday — both AM and PM should be auto-recorded
    // because there's no continuity-clinic conflict on Mondays.
    const monday = next.outpatientSessions.filter(
      (s) => s.rotatorId === rotator.id && s.date === "2026-06-01"
    );
    expect(monday.map((s) => s.period).sort()).toEqual(["AM", "PM"]);
  });

  it("does not auto-book over a second continuity clinic slot on Methodist outpatient days", () => {
    const rotator = methodistRotator({
      id: "rot-thursday-clinic",
      rotationStartDate: "2026-05-20"
    });
    rotator.continuityClinic = "Tuesday PM, Thursday AM";
    const block = blockOf("may-2026", "2026-05-20", "2026-05-22");
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [rotator],
      inpatientAssignments: [],
      outpatientSessions: []
    };

    const next = applyMethodistAutoAssign(state, block);
    const thursday = next.outpatientSessions
      .filter((s) => s.rotatorId === rotator.id && s.date === "2026-05-21")
      .map((s) => s.period)
      .sort();
    const wednesday = next.outpatientSessions
      .filter((s) => s.rotatorId === rotator.id && s.date === "2026-05-20")
      .map((s) => s.period)
      .sort();

    expect(thursday).toEqual(["PM"]);
    expect(wednesday).toEqual(["AM", "PM"]);
  });

  it("F7: skips inpatient slot when a manual entry uses a different role than rotator.role", () => {
    // Regression: applyMethodistAutoAssign used to dedupe by
    // (date, rotatorId, role). A manual record with role="Team senior"
    // plus rotator.role="Resident" produced two IP records on the same
    // day for the same rotator. Slot-identity dedupe by (date, rotatorId)
    // makes manual entries always win regardless of role.
    const rotator = methodistRotator({ id: "rot-f7" }); // role="Resident"
    const block = blockOf("june-2026", "2026-06-01", "2026-06-30");
    const manual = {
      id: "manual-different-role",
      date: "2026-06-05", // a Methodist IP day in this rotation
      rotatorId: rotator.id,
      role: "Team senior",
      source: "Manual"
    };
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [rotator],
      inpatientAssignments: [manual],
      outpatientSessions: []
    };
    const next = applyMethodistAutoAssign(state, block);
    const june5 = next.inpatientAssignments.filter(
      (a) => a.date === "2026-06-05" && a.rotatorId === rotator.id
    );
    expect(june5).toHaveLength(1);
    expect(june5[0].role).toBe("Team senior");
    expect(june5[0].source).toBe("Manual");
  });

  it("does not write outpatient placeholders on Saturdays or Sundays (no weekend clinics)", () => {
    // Regression: applyMethodistAutoAssign used to write
    // "Methodist Outpatient" AM/PM records for every day in the rotator's
    // outpatient phase including weekends. Outpatient clinics don't run
    // Sat/Sun; the records cluttered the planning grid and bled into the
    // exported schedule PDF. IP records on weekends are still emitted
    // because hospital coverage is 24/7.
    const rotator = methodistRotator({
      id: "rot-weekend",
      segments: [{ start: "2026-06-01", end: "2026-06-30" }],
      rotationStartDate: "2026-06-01" // 6/01-6/14 OP, 6/15-6/28 IP
    });
    const block = blockOf("june-2026", "2026-06-01", "2026-06-30");
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [rotator],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    const next = applyMethodistAutoAssign(state, block);
    // OP weekends (6/06 Sat, 6/07 Sun, 6/13 Sat, 6/14 Sun) must have no records.
    const opWeekends = next.outpatientSessions.filter(
      (s) => s.rotatorId === rotator.id && ["2026-06-06", "2026-06-07", "2026-06-13", "2026-06-14"].includes(s.date)
    );
    expect(opWeekends).toHaveLength(0);
    // IP weekends INSIDE the IP phase (6/20 Sat, 6/21 Sun, 6/27 Sat, 6/28 Sun) must still exist.
    const ipWeekends = next.inpatientAssignments.filter(
      (a) => a.rotatorId === rotator.id && ["2026-06-20", "2026-06-21", "2026-06-27", "2026-06-28"].includes(a.date)
    );
    expect(ipWeekends).toHaveLength(4);
    // Regular weekday OP records still exist.
    const monday = next.outpatientSessions.filter(
      (s) => s.rotatorId === rotator.id && s.date === "2026-06-01"
    );
    expect(monday.length).toBeGreaterThan(0);
  });

  it("does not write outpatient placeholders on no-clinic holidays (clinic is closed)", () => {
    // Regression: applyMethodistAutoAssign skipped weekends for outpatient but
    // NOT no-clinic holidays, so a Methodist rotator in their OP fortnight got
    // a "Methodist Outpatient" placeholder on a weekday holiday — which the
    // conflict detector then flagged (clinic on a noClinic day). The paint path
    // (applyRangeAssignment) already skips noClinic holidays for OP; the seed
    // path must too. Inpatient on a noClinic holiday is still emitted (hospital
    // coverage is 24/7; noClinic suppresses outpatient clinic only).
    const rotator = methodistRotator({
      id: "rot-holiday",
      segments: [{ start: "2026-06-01", end: "2026-06-30" }],
      rotationStartDate: "2026-06-01" // 6/01-6/14 OP, 6/15-6/28 IP
    });
    const block = blockOf("june-2026", "2026-06-01", "2026-06-30");
    // 6/04 Thu is a no-clinic holiday inside the OP fortnight; 6/18 Thu is a
    // no-clinic holiday inside the IP fortnight.
    block.holidays = [
      { date: "2026-06-04", name: "OP-phase holiday", noClinic: true },
      { date: "2026-06-18", name: "IP-phase holiday", noClinic: true }
    ];
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [rotator],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    const next = applyMethodistAutoAssign(state, block);
    // OP no-clinic holiday (6/04) must have NO outpatient records.
    const opHoliday = next.outpatientSessions.filter(
      (s) => s.rotatorId === rotator.id && s.date === "2026-06-04"
    );
    expect(opHoliday).toHaveLength(0);
    // A regular OP weekday (6/02 Tue) still has records (no over-skipping).
    const opWeekday = next.outpatientSessions.filter(
      (s) => s.rotatorId === rotator.id && s.date === "2026-06-02"
    );
    expect(opWeekday.length).toBeGreaterThan(0);
    // IP no-clinic holiday (6/18) still emits the inpatient record (24/7 coverage).
    const ipHoliday = next.inpatientAssignments.filter(
      (a) => a.rotatorId === rotator.id && a.date === "2026-06-18"
    );
    expect(ipHoliday).toHaveLength(1);
  });

  it("F6: no duplicate (date, rotator, period) slots when applyPreassignments + applyMethodistAutoAssign run together", () => {
    // Regression: applyPreassignments writes outpatient sessions with
    // clinic="" while applyMethodistAutoAssign writes clinic="Methodist
    // Outpatient". Their old dedupe keys included the clinic, so running
    // preassign and then Methodist on the same Methodist rotator created
    // a duplicate OP record for every (date, period) the preassign had
    // already filled. Slot-identity dedupe by (date, rotatorId, period)
    // closes the gap.
    const rotator = methodistRotator({
      id: "rot-f6",
      segments: [{ start: "2026-06-01", end: "2026-06-14", defaultPhase: "outpatient" }],
      rotationStartDate: "2026-06-01" // days 0-13 outpatient = 6/01-6/14
    });
    const block = blockOf("june-2026", "2026-06-01", "2026-06-30");
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [rotator],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    const afterPre = applyPreassignments(state, block);
    expect(afterPre.outpatientSessions.length).toBeGreaterThan(0);
    const afterAuto = applyMethodistAutoAssign(afterPre, block);
    // Invariant: every (date, period) the rotator occupies appears exactly once.
    const slotKeys = afterAuto.outpatientSessions
      .filter((s) => s.rotatorId === rotator.id)
      .map((s) => `${s.date}|${s.period}`);
    expect(new Set(slotKeys).size).toBe(slotKeys.length);
    // The slots preassign already filled keep their generic placeholder /
    // source="Auto-Preassigned" — Methodist did NOT overwrite them.
    const monday = afterAuto.outpatientSessions.find(
      (s) => s.rotatorId === rotator.id && s.date === "2026-06-01" && s.period === "AM"
    );
    expect(monday.clinic).toBe(OP_PLACEHOLDER_CLINIC);
    expect(monday.source).toBe("Auto-Preassigned");
  });
});

describe("programRules dispatcher (spec §9.2–§9.5 stubs)", () => {
  it("classifies rotators by schoolType, falling back to the legacy program name", () => {
    expect(classifyRotatorSchoolType({ schoolType: "methodist" })).toBe("methodist");
    expect(classifyRotatorSchoolType({ program: "Methodist" })).toBe("methodist");
    expect(classifyRotatorSchoolType({ program: "UT Adult Neuro" })).toBe("ut-adult");
    expect(classifyRotatorSchoolType({ program: "UT Pediatrics" })).toBe("ut-peds");
    expect(classifyRotatorSchoolType({ program: "UT Med Student" })).toBe("ut-student");
    expect(classifyRotatorSchoolType({ program: "UT Psychiatry" })).toBe("ut-psychiatry");
    expect(classifyRotatorSchoolType({ program: "Other" })).toBe("other");
    expect(classifyRotatorSchoolType(null)).toBe("other");
  });

  it("methodist and length-split branches produce assignments; students stay no-ops", () => {
    const methodist = methodistRotator({ id: "m" });
    const psych = {
      id: "p",
      program: "UT Psychiatry",
      schoolType: "ut-psychiatry",
      role: "Resident",
      segments: [{ start: "2026-06-01", end: "2026-06-30" }],
      continuityClinic: "",
      dayOff: [],
      unavailableRanges: []
    };
    const student = {
      id: "s",
      program: "UT Med Student",
      schoolType: "ut-student",
      role: "Student",
      segments: [{ start: "2026-06-05", end: "2026-06-18" }],
      continuityClinic: "",
      dayOff: [],
      unavailableRanges: []
    };
    const block = blockOf("june-2026", "2026-06-01", "2026-06-30");
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [methodist, psych, student],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    const next = applyProgramRules(state, block);

    // Methodist auto-assignments present.
    expect(
      next.inpatientAssignments.some((a) => a.rotatorId === "m" && a.source === "Auto-Methodist")
    ).toBe(true);
    // Psychiatry gets the rules-3/7 length split (both sides, Auto-Split).
    expect(
      next.inpatientAssignments.some((a) => a.rotatorId === "p" && a.source === "Auto-Split")
    ).toBe(true);
    expect(
      next.outpatientSessions.some((s) => s.rotatorId === "p" && s.source === "Auto-Split")
    ).toBe(true);
    // Students keep their predetermined assignment untouched (spec §9.5).
    expect(next.inpatientAssignments.some((a) => a.rotatorId === "s")).toBe(false);
    expect(next.outpatientSessions.some((s) => s.rotatorId === "s")).toBe(false);
  });

  it("length-split outpatient weeks skip every configured continuity clinic period", () => {
    const block = blockOf("may-2026", "2026-05-04", "2026-05-24");
    const rotator = makeRotator("split-1", "Split Resident", "UT Pediatrics", "PGY-2", [
      { start: "2026-05-04", end: "2026-05-24" }
    ]);
    rotator.continuityClinic = "Tuesday PM, Thursday AM";
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [rotator],
      inpatientAssignments: [],
      outpatientSessions: []
    };

    const next = applyProgramRules(state, block);
    const periodsByDate = (date) => next.outpatientSessions
      .filter((s) => s.rotatorId === "split-1" && s.date === date)
      .map((s) => s.period)
      .sort();

    expect(periodsByDate("2026-05-18")).toEqual(["AM", "PM"]);
    expect(periodsByDate("2026-05-19")).toEqual(["AM"]);
    expect(periodsByDate("2026-05-21")).toEqual(["PM"]);
  });

  it("applyProgramRules is idempotent across school types", () => {
    const block = blockOf("june-2026", "2026-06-01", "2026-06-30");
    const state = {
      ...createInitialState(),
      activeBlockId: block.id,
      serviceBlocks: [block],
      rotators: [methodistRotator({ id: "m" })],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    const once = applyProgramRules(state, block);
    const twice = applyProgramRules(once, block);
    expect(twice.inpatientAssignments.length).toBe(once.inpatientAssignments.length);
    expect(twice.outpatientSessions.length).toBe(once.outpatientSessions.length);
  });

  it("exposes plain-English rule descriptions for every school type (no dev jargon)", () => {
    const types = ["methodist", "ut-adult", "ut-peds", "ut-student", "ut-psychiatry", "other"];
    const banned = ["json", "manifest", "payload", "schema", "config", "cp-sat"];
    for (const type of types) {
      const text = PROGRAM_RULE_DESCRIPTIONS[type];
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(20);
      const lower = text.toLowerCase();
      for (const word of banned) {
        expect(lower).not.toContain(word);
      }
    }
  });
});

describe("rotator legend (ST-D, spec §7.6 §14.5 §16.4)", () => {
  it("exposes the top-level workflow destinations in order (2026-05-28 redesign)", () => {
    // Legend/Conflicts/Rules were consolidated into Reports/Settings; the
    // main menu now follows the workflow stages.
    const expected = [
      "Dashboard",
      "Configuration",
      "Rotators",
      "Sources",
      "Attendings",
      "Fellows",
      "Clinics",
      "Planning Grid",
      "Inpatient Schedule",
      "Outpatient Schedule",
      "Reports",
      "Settings"
    ];
    expect(PAGES).toEqual(expected);
  });

  it("numbers residents sequentially and labels fellows and medical students by role", () => {
    const state = createDemoState();
    const block = state.serviceBlocks[0];
    const legend = generateLegend(state, block);

    // Demo roster: Maya (Methodist PGY-3), Noah (UT Adult PGY-2),
    // Ari (UT Pediatrics PGY-2), Elena (UT Med Student MS-4),
    // Sam (Fellow). All overlap the May 2026 block.
    expect(legend.entries).toHaveLength(5);

    const residentEntries = legend.entries.filter(
      (entry) => entry.number !== "Fellow" && entry.number !== "MS"
    );
    expect(residentEntries.map((entry) => entry.number)).toEqual(["1", "2", "3"]);

    const fellow = legend.entries.find((entry) => entry.displayLabel === "Sam Carter");
    expect(fellow.number).toBe("Fellow");

    const student = legend.entries.find((entry) => entry.displayLabel === "Elena Ruiz");
    expect(student.number).toBe("MS");
  });

  it("includes a human-readable date range and the continuity clinic note", () => {
    const state = createDemoState();
    const block = state.serviceBlocks[0];
    const legend = generateLegend(state, block);

    const noah = legend.entries.find((entry) => entry.displayLabel === "Noah Patel");
    // Noah is on 5/4 to 5/17 in the block.
    expect(noah.dateRange).toMatch(/May 4/);
    expect(noah.dateRange).toMatch(/May 17/);
    expect(noah.continuityClinic).toBe("Tuesday PM");

    const ari = legend.entries.find((entry) => entry.displayLabel === "Drew Quinn");
    expect(ari.continuityClinic).toBe("");
  });

  it("orders entries by earliest active date then by display name", () => {
    const state = createDemoState();
    const block = state.serviceBlocks[0];
    const legend = generateLegend(state, block);

    // 5/4 starters (Maya, Noah, Ari, Sam) come before 5/11 starter (Elena).
    const startsOnFourth = ["Maya Lopez", "Noah Patel", "Drew Quinn", "Sam Carter"];
    const indexOfElena = legend.entries.findIndex((entry) => entry.displayLabel === "Elena Ruiz");
    for (const name of startsOnFourth) {
      const idx = legend.entries.findIndex((entry) => entry.displayLabel === name);
      expect(idx).toBeLessThan(indexOfElena);
    }
  });

  it("returns an empty legend when the block has no active rotators", () => {
    const empty = createInitialState();
    const legend = generateLegend(empty, empty.serviceBlocks[0]);
    expect(legend.entries).toEqual([]);
  });
});

describe("extended conflict detection (ST-D, spec §25.7 §15.3 §15.4)", () => {
  it("flags missing inpatient coverage on every uncovered day incl weekends (contract v2 §1d)", () => {
    const state = createDemoState();
    const conflicts = detectConflicts(state);

    // Demo block has inpatient on 5/4, 5/5, 5/6, 5/11, 5/12. Other
    // weekdays in 5/4–5/31 (e.g. 5/7 Thursday) should be flagged.
    const missingCoverage = conflicts.filter((c) => c.type === "missing-coverage");
    expect(missingCoverage.length).toBeGreaterThan(0);
    expect(missingCoverage.every((c) => c.severity === "Critical")).toBe(true);

    const dates = missingCoverage.map((c) => c.date);
    expect(dates).toContain("2026-05-07");

    // Contract v2 §1d: inpatient demand is now 1 every day, so unstaffed
    // weekends DO flag missing coverage.
    expect(dates).toContain("2026-05-09"); // Saturday — now flagged
    expect(dates).toContain("2026-05-10"); // Sunday — now flagged

    // Should NOT flag a covered weekday.
    expect(dates).not.toContain("2026-05-04"); // Mon, Maya covers
    expect(dates).not.toContain("2026-05-11"); // Mon, Noah covers
  });

  it("flags no-clinic holidays as missing inpatient coverage (contract v2 §1d)", () => {
    const state = createDemoState();
    const conflicts = detectConflicts(state);
    const dates = conflicts.filter((c) => c.type === "missing-coverage").map((c) => c.date);
    // Demo block flags 5/25 Memorial Day as noClinic. noClinic suppresses
    // OUTPATIENT clinic only — inpatient staffing is still required, so an
    // unstaffed holiday now DOES require >=1 inpatient and is flagged.
    expect(dates).toContain("2026-05-25");
  });

  it("flags continuity-clinic conflicts when inpatient assignment lands on the rotator's clinic day", () => {
    let state = createDemoState();
    // Noah has Tuesday PM continuity clinic. 2026-05-12 is a Tuesday.
    state = scheduleInpatientAssignment(state, {
      date: "2026-05-12",
      rotatorId: "rot-utadult-1",
      role: "Resident"
    });

    const conflicts = detectConflicts(state);
    const cc = conflicts.find(
      (c) => c.type === "continuity-clinic-conflict" && c.date === "2026-05-12"
    );
    expect(cc).toBeTruthy();
    expect(cc.severity).toBe("Warning");
    expect(cc.title).toContain("Noah Patel");
    expect(cc.detail).toContain("Tuesday PM");
  });

  it("does not flag a continuity-clinic conflict on a non-matching weekday", () => {
    const state = createDemoState();
    const conflicts = detectConflicts(state);
    // Noah's existing 5/11 (Monday) inpatient assignment must NOT trigger
    // continuity-clinic-conflict (his clinic is Tuesday PM).
    const mondayCc = conflicts.find(
      (c) => c.type === "continuity-clinic-conflict" && c.date === "2026-05-11"
    );
    expect(mondayCc).toBeFalsy();
  });

  it("flags rotators that are on the schedule but not in the generated legend", () => {
    let state = createDemoState();
    // Inject a phantom rotator with no date window — they cannot land in
    // the legend (rotatorActiveOnDate returns false for every date) but
    // they are still referenced by an inpatient assignment in the block.
    state = {
      ...state,
      rotators: [
        ...state.rotators,
        {
          id: "rot-phantom-1",
          fullName: "Phantom Resident",
          displayName: "Phantom Resident",
          program: "Other",
          level: "PGY-1",
          role: "Resident",
          continuityClinic: "",
          dayOff: [],
          unavailableRanges: []
        }
      ]
    };
    state = scheduleInpatientAssignment(state, {
      date: "2026-05-13",
      rotatorId: "rot-phantom-1",
      role: "Resident"
    });

    const conflicts = detectConflicts(state);
    const missing = conflicts.find(
      (c) => c.type === "missing-legend" && c.title.includes("Phantom")
    );
    expect(missing).toBeTruthy();
    expect(missing.severity).toBe("Critical");
  });

  it("does not flag missing-legend for a rotator who is active in the block", () => {
    const state = createDemoState();
    const conflicts = detectConflicts(state);
    // Every assignment in the demo state references an active rotator;
    // the legend should cover all of them.
    expect(conflicts.some((c) => c.type === "missing-legend")).toBe(false);
  });
});

describe("per-segment pre-assignment (Coordinator 2026-05-20 round-5)", () => {
  function basicBlock() {
    return {
      id: "block-pre",
      name: "Pre-assign block",
      startDate: "2026-09-14",
      endDate: "2026-09-25",
      status: "Draft",
      generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
      holidays: []
    };
  }

  function stateWithRotator(segments) {
    const block = basicBlock();
    return {
      version: 2,
      activeBlockId: block.id,
      serviceBlocks: [block],
      sources: [],
      attendings: [],
      expectedSourcePrograms: [],
      rotators: [{
        id: "rot-sarah",
        fullName: "Sarah Promised",
        displayName: "Sarah Promised",
        program: "UT Pediatrics",
        level: "PGY-2",
        role: "Resident",
        segments,
        continuityClinic: "",
        dayOff: [],
        unavailableRanges: [],
        schoolType: "ut-peds"
      }],
      inpatientAssignments: [],
      outpatientSessions: [],
      rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
      notes: []
    };
  }

  it("getRotatorSegmentPhase returns the segment's defaultPhase for a date in range, null otherwise", () => {
    const rotator = {
      segments: [
        { start: "2026-09-14", end: "2026-09-20", defaultPhase: "outpatient" },
        { start: "2026-10-01", end: "2026-10-07" } // no phase
      ]
    };
    expect(getRotatorSegmentPhase(rotator, "2026-09-15")).toBe("outpatient");
    expect(getRotatorSegmentPhase(rotator, "2026-09-21")).toBe(null);
    expect(getRotatorSegmentPhase(rotator, "2026-10-03")).toBe(null);
  });

  it("applyPreassignments auto-fills outpatient placeholder sessions for marked weeks (skips weekends)", () => {
    // Sept 14, 2026 is a Monday → block 14-25 contains weekdays Mon-Fri Sept 14-18 and Mon-Fri Sept 21-25
    const state = stateWithRotator([
      { start: "2026-09-14", end: "2026-09-20", defaultPhase: "outpatient" }
    ]);
    const next = applyPreassignments(state, state.serviceBlocks[0]);
    expect(next).not.toBe(state);
    // 5 weekdays × 2 periods (AM+PM) = 10 outpatient sessions for week 1
    expect(next.outpatientSessions).toHaveLength(10);
    expect(next.outpatientSessions.every((s) => s.source === "Auto-Preassigned")).toBe(true);
    expect(next.outpatientSessions.every((s) => s.clinic === OP_PLACEHOLDER_CLINIC)).toBe(true);
    expect(next.outpatientSessions.some((s) => s.clinic === METHODIST_OP_CLINIC)).toBe(false);
    // No weekend sessions
    expect(next.outpatientSessions.some((s) => s.date === "2026-09-19" || s.date === "2026-09-20")).toBe(false);
    expect(next.inpatientAssignments).toHaveLength(0);
  });

  it("applyPreassignments skips every configured continuity clinic period", () => {
    const state = stateWithRotator([
      { start: "2026-09-14", end: "2026-09-18", defaultPhase: "outpatient" }
    ]);
    state.rotators[0].continuityClinic = "Tuesday PM, Thursday AM";

    const next = applyPreassignments(state, state.serviceBlocks[0]);
    const periodsByDate = (date) => next.outpatientSessions
      .filter((s) => s.date === date)
      .map((s) => s.period)
      .sort();

    expect(periodsByDate("2026-09-15")).toEqual(["AM"]);
    expect(periodsByDate("2026-09-17")).toEqual(["PM"]);
    expect(next.outpatientSessions).toHaveLength(8);
  });

  it("does not write outpatient placeholders on no-clinic holidays (clinic is closed)", () => {
    // Same bug class as the applyMethodistAutoAssign fix: this preassignment OP
    // seeder skipped weekends but NOT noClinic holidays, so a weekday holiday in
    // an outpatient segment got a placeholder the conflict detector then flags.
    // The paint path (applyRangeAssignment) already skips noClinic holidays; the
    // two auto-seed paths must match it.
    const state = stateWithRotator([
      { start: "2026-09-14", end: "2026-09-18", defaultPhase: "outpatient" }
    ]);
    // 9/16 (Wed) is a no-clinic holiday inside the outpatient segment.
    state.serviceBlocks[0].holidays = [
      { date: "2026-09-16", name: "Holiday", noClinic: true }
    ];
    const next = applyPreassignments(state, state.serviceBlocks[0]);
    // No OP records on the no-clinic holiday.
    expect(next.outpatientSessions.some((s) => s.date === "2026-09-16")).toBe(false);
    // Other weekdays still seeded (Mon 9/14 keeps AM+PM).
    expect(next.outpatientSessions.filter((s) => s.date === "2026-09-14")).toHaveLength(2);
    // 5 weekdays (9/14-9/18) minus the 9/16 holiday = 4 weekdays × 2 periods.
    expect(next.outpatientSessions).toHaveLength(8);
  });

  it("is idempotent — running twice produces the same record set, returns same reference on second run", () => {
    const state = stateWithRotator([
      { start: "2026-09-14", end: "2026-09-18", defaultPhase: "inpatient" }
    ]);
    const after1 = applyPreassignments(state, state.serviceBlocks[0]);
    const after2 = applyPreassignments(after1, after1.serviceBlocks[0]);
    expect(after2).toBe(after1);
    expect(after1.inpatientAssignments).toHaveLength(5); // Mon-Fri Sept 14-18
  });

  it("segments without defaultPhase don't create placeholders", () => {
    const state = stateWithRotator([
      { start: "2026-09-14", end: "2026-09-18" } // no phase
    ]);
    const next = applyPreassignments(state, state.serviceBlocks[0]);
    expect(next).toBe(state);
    expect(next.inpatientAssignments).toHaveLength(0);
    expect(next.outpatientSessions).toHaveLength(0);
  });
});

describe("attending profiles (round-6 / 0.10.0)", () => {
  it("migrates legacy string-shaped attendings into profile objects with empty patterns", () => {
    const legacy = {
      version: 2,
      activeBlockId: "b",
      serviceBlocks: [{ id: "b", name: "x", startDate: "2026-05-04", endDate: "2026-05-31", status: "Draft", generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true }, holidays: [] }],
      sources: [],
      rotators: [],
      attendings: ["Alder", "Birch"],
      expectedSourcePrograms: [],
      inpatientAssignments: [],
      outpatientSessions: [],
      rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
      notes: []
    };
    const upgraded = migrateLoadedState(legacy);
    expect(upgraded).not.toBe(legacy);
    expect(upgraded.attendings).toEqual([
      { name: "Alder", recurringClinics: [], oneOffDates: [] },
      { name: "Birch", recurringClinics: [], oneOffDates: [] }
    ]);
  });

  it("attendingsAvailableOn filters by weekday + period (recurring)", () => {
    const state = {
      attendings: [
        { name: "Alder", recurringClinics: [{ weekday: "Tuesday", period: "AM" }], oneOffDates: [] },
        { name: "Gum", recurringClinics: [{ weekday: "Tuesday", period: "PM" }], oneOffDates: [] },
        { name: "Cedar", recurringClinics: [{ weekday: "Thursday", period: "AM" }], oneOffDates: [] }
      ]
    };
    // 2026-05-05 is a Tuesday
    const amOnTue = attendingsAvailableOn(state, "2026-05-05", "AM");
    expect(amOnTue.map((a) => a.name)).toEqual(["Alder"]);
    const pmOnTue = attendingsAvailableOn(state, "2026-05-05", "PM");
    expect(pmOnTue.map((a) => a.name)).toEqual(["Gum"]);
    const anyOnThu = attendingsAvailableOn(state, "2026-05-07", null);
    expect(anyOnThu.map((a) => a.name)).toEqual(["Cedar"]);
  });

  it("attendingsAvailableOn honors one-off clinic dates outside the recurring pattern", () => {
    const state = {
      attendings: [
        { name: "Dogwood", recurringClinics: [], oneOffDates: [{ date: "2026-05-13", period: "AM" }] }
      ]
    };
    // 2026-05-13 is a Wednesday — not in any recurring pattern
    expect(attendingsAvailableOn(state, "2026-05-13", "AM").map((a) => a.name)).toEqual(["Dogwood"]);
    expect(attendingsAvailableOn(state, "2026-05-13", "PM")).toHaveLength(0);
  });
});

describe("buildPlanningGrid — rotator × date matrix", () => {
  // Hand-built mini-state that exercises every cell-classification branch.
  // One rotator, one short block, and a different state for each date so
  // the assertions can name the exact branch being tested.
  function makeGridState() {
    const block = {
      id: "b",
      name: "Grid test",
      startDate: "2026-05-04", // Monday
      endDate: "2026-05-10",   // Sunday
      status: "Draft",
      generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
      holidays: []
    };
    const rotator = makeRotator("rot-1", "Test Person", "UT Pediatrics", "PGY-2", [
      // Segment skips 5/04 so that Monday is "absent" (no segment covers it)
      { start: "2026-05-05", end: "2026-05-10" }
    ]);
    // 5/09 is inside an unavailable range so the rotator reads as "off" that day
    rotator.unavailableRanges = [{ start: "2026-05-09", end: "2026-05-09" }];

    return {
      version: 2,
      activeBlockId: "b",
      serviceBlocks: [block],
      sources: [],
      rotators: [rotator],
      attendings: [],
      expectedSourcePrograms: [],
      inpatientAssignments: [
        // 5/05 — real inpatient
        { id: "a1", date: "2026-05-05", rotatorId: "rot-1", role: "Resident", source: "Manual" },
        // 5/06 — explicit "Off" role marks the day off, does NOT count as IP
        { id: "a2", date: "2026-05-06", rotatorId: "rot-1", role: "Off", source: "Manual" },
        // 5/08 — both IP and OP same day (conflict, must surface as "both")
        { id: "a3", date: "2026-05-08", rotatorId: "rot-1", role: "Resident", source: "Manual" }
      ],
      outpatientSessions: [
        // 5/07 — auto-Methodist style placeholder with empty clinic still reads as OP
        { id: "s1", date: "2026-05-07", period: "AM", clinic: "", provider: "", rotatorId: "rot-1", status: "Scheduled", source: "Auto-Preassigned" },
        // 5/08 — second half of the IP+OP conflict
        { id: "s2", date: "2026-05-08", period: "PM", clinic: "Continuity Clinic", provider: "Dr. X", rotatorId: "rot-1", status: "Scheduled" }
      ],
      rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
      notes: []
    };
  }

  it("classifies every cell branch for a single rotator across the block", () => {
    const state = makeGridState();
    const grid = buildPlanningGrid(state, state.serviceBlocks[0]);

    expect(grid.dates).toEqual([
      "2026-05-04", "2026-05-05", "2026-05-06",
      "2026-05-07", "2026-05-08", "2026-05-09", "2026-05-10"
    ]);

    const cells = grid.rows[0].cells;
    expect(cells.map((c) => c.status)).toEqual([
      "absent",      // 5/04 outside segment
      "inpatient",   // 5/05 manual IP
      "off",         // 5/06 "Off" role marker
      "outpatient",  // 5/07 auto-pre OP placeholder
      "both",        // 5/08 IP+OP conflict
      "off",         // 5/09 unavailable range
      "unassigned"   // 5/10 active, available, no record
    ]);
    // The "marked-off" branch (Off role on a day with no other records)
    // should report its reason so the UI can distinguish it from a
    // weekly day-off or an unavailable range.
    expect(cells[2].reason).toBe("marked-off");
    expect(cells[5].reason).toBe("range");
  });

  it("computes daily totals counting only present rotators", () => {
    const state = makeGridState();
    const grid = buildPlanningGrid(state, state.serviceBlocks[0]);

    // Single-rotator block — each date has at most 1 in any bucket.
    expect(grid.totals.map((t) => ({ date: t.date, ip: t.ip, op: t.op, un: t.unassigned, present: t.present }))).toEqual([
      { date: "2026-05-04", ip: 0, op: 0, un: 0, present: 0 }, // absent
      { date: "2026-05-05", ip: 1, op: 0, un: 0, present: 1 },
      { date: "2026-05-06", ip: 0, op: 0, un: 0, present: 0 }, // off doesn't count
      { date: "2026-05-07", ip: 0, op: 1, un: 0, present: 1 },
      { date: "2026-05-08", ip: 1, op: 1, un: 0, present: 1 }, // both → counts in IP and OP
      { date: "2026-05-09", ip: 0, op: 0, un: 0, present: 0 }, // off
      { date: "2026-05-10", ip: 0, op: 0, un: 1, present: 1 }  // unassigned is the action item
    ]);
  });

  it("returns an empty grid when block or state is missing", () => {
    expect(buildPlanningGrid(null, { startDate: "2026-05-04", endDate: "2026-05-10" })).toEqual({ dates: [], rows: [], totals: [] });
    expect(buildPlanningGrid({ rotators: [] }, null)).toEqual({ dates: [], rows: [], totals: [] });
    expect(buildPlanningGrid({ rotators: [] }, { startDate: "", endDate: "" })).toEqual({ dates: [], rows: [], totals: [] });
  });

  it("aggregates Methodist auto-assign output correctly across multiple rotators", () => {
    // The demo state has both manual IP/OP entries and rotators with full
    // segments — running applyMethodistAutoAssign on top exercises the
    // realistic case where the grid mixes auto + manual records.
    const base = createDemoState();
    const withAuto = applyMethodistAutoAssign(base, base.serviceBlocks[0]);
    const grid = buildPlanningGrid(withAuto, withAuto.serviceBlocks[0]);

    // Same number of rows as rotators, same dates as the block.
    expect(grid.rows).toHaveLength(withAuto.rotators.length);
    expect(grid.dates).toHaveLength(28); // 5/04..5/31 inclusive

    // Every total date count must satisfy: ip + op + unassigned + offCount === presentCount
    // where offCount is implicit (rows minus present). The simpler invariant:
    // present === sum of IP + OP - both + unassigned (because "both" cells count once in IP and once in OP)
    for (const t of grid.totals) {
      expect(t.ip + t.op - t.both + t.unassigned).toBe(t.present);
    }
  });
});

describe("buildPlanningGrid — weekend OFF for outpatient rotators (Coordinator #1)", () => {
  // 2026-05-01 Fri, 05-02 Sat, 05-03 Sun, 05-04 Mon.
  const block = { id: "b1", name: "B", startDate: "2026-05-01", endDate: "2026-05-04", status: "Draft", generate: {}, holidays: [] };
  function gridFor(rotators, extra = (s) => s) {
    let s = createInitialState();
    s = { ...s, serviceBlocks: [block], activeBlockId: "b1", rotators };
    s = extra(s);
    return buildPlanningGrid(s, block);
  }
  const cellOn = (grid, rid, date) =>
    grid.rows.find((r) => r.rotator.id === rid).cells.find((c) => c.date === date);

  it("marks an outpatient-phase rotator OFF on a weekend their segment spans", () => {
    const r = makeRotator("r1", "A", "UT Pediatrics", "PGY-2", [{ start: "2026-05-01", end: "2026-05-04", defaultPhase: "outpatient" }]);
    const grid = gridFor([r]);
    expect(cellOn(grid, "r1", "2026-05-02").status).toBe("off"); // Saturday
    expect(cellOn(grid, "r1", "2026-05-02").reason).toBe("weekend-op");
    expect(cellOn(grid, "r1", "2026-05-03").status).toBe("off"); // Sunday
    // A weekday inside the same outpatient stretch stays open — clinic runs.
    expect(cellOn(grid, "r1", "2026-05-04").status).toBe("unassigned");
  });

  it("does NOT mark an inpatient-phase rotator OFF on the weekend (hospital runs 24/7)", () => {
    const r = makeRotator("r2", "B", "UT Pediatrics", "PGY-2", [{ start: "2026-05-01", end: "2026-05-04", defaultPhase: "inpatient" }]);
    const sat = cellOn(gridFor([r]), "r2", "2026-05-02");
    expect(sat.status).toBe("unassigned");
    expect(sat.offCalendar).toBe(true);
  });

  it("is overridable: a manual weekend assignment wins over the inferred OFF", () => {
    const r = makeRotator("r1", "A", "UT Pediatrics", "PGY-2", [{ start: "2026-05-01", end: "2026-05-04", defaultPhase: "outpatient" }]);
    const grid = gridFor([r], (s) =>
      scheduleInpatientAssignment(s, { date: "2026-05-02", rotatorId: "r1", role: "Resident", source: "Manual" })
    );
    expect(cellOn(grid, "r1", "2026-05-02").status).toBe("inpatient");
  });
});

describe("applyRangeAssignment — planning-grid range writes", () => {
  function makeRangeState() {
    const block = {
      id: "b",
      name: "Range test",
      startDate: "2026-05-04", // Monday
      endDate: "2026-05-17",   // Sunday (two-week block)
      status: "Draft",
      generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
      holidays: []
    };
    const rotator = makeRotator("rot-1", "Range Tester", "UT Pediatrics", "PGY-2", [
      { start: "2026-05-06", end: "2026-05-15" } // segment narrower than block
    ]);
    rotator.unavailableRanges = [{ start: "2026-05-09", end: "2026-05-09" }];
    const other = makeRotator("rot-2", "Other Person", "UT Pediatrics", "PGY-3", [
      { start: "2026-05-04", end: "2026-05-17" }
    ]);
    return {
      version: 2,
      activeBlockId: "b",
      serviceBlocks: [block],
      sources: [],
      rotators: [rotator, other],
      attendings: [],
      expectedSourcePrograms: [],
      inpatientAssignments: [],
      outpatientSessions: [],
      rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
      notes: []
    };
  }

  it("assigns IP across the active subset of a date range", () => {
    const state = makeRangeState();
    const block = state.serviceBlocks[0];
    const next = applyRangeAssignment(state, block, {
      rotatorId: "rot-1",
      startDate: "2026-05-06",
      endDate: "2026-05-10",
      phase: "inpatient"
    });

    // 5/06–5/10 inclusive is 5 days; 5/09 skipped (unavailable) → 4 IP records
    const myIp = next.inpatientAssignments.filter((a) => a.rotatorId === "rot-1");
    expect(myIp).toHaveLength(4);
    expect(myIp.map((a) => a.date).sort()).toEqual([
      "2026-05-06", "2026-05-07", "2026-05-08", "2026-05-10"
    ]);
    expect(myIp.every((a) => a.role === "Resident")).toBe(true);
    expect(myIp.every((a) => a.source === "Range-Assigned")).toBe(true);
    expect(next.outpatientSessions).toHaveLength(0);
  });

  it("writes OP placeholders that the planning grid classifies as outpatient", () => {
    const state = makeRangeState();
    const block = state.serviceBlocks[0];
    const next = applyRangeAssignment(state, block, {
      rotatorId: "rot-1",
      startDate: "2026-05-06",
      endDate: "2026-05-08",
      phase: "outpatient"
    });

    const myOp = next.outpatientSessions.filter((s) => s.rotatorId === "rot-1");
    // Range-OP now writes BOTH AM and PM placeholders per weekday (matches
    // applyMethodistAutoAssign + applyPreassignments). 3 weekdays × 2
    // periods = 6 sessions, each the generic OP placeholder (clinic not
    // specified by the user), blank provider, Scheduled, Range-Assigned.
    expect(myOp).toHaveLength(6);
    const periods = new Set(myOp.map((s) => s.period));
    expect(periods).toEqual(new Set(["AM", "PM"]));
    for (const s of myOp) {
      expect(s.clinic).toBe(OP_PLACEHOLDER_CLINIC);
      expect(s.provider).toBe("");
      expect(s.status).toBe("Scheduled");
      expect(s.source).toBe("Range-Assigned");
    }
    // Grid classifier should see these as outpatient cells.
    const grid = buildPlanningGrid(next, block);
    const row = grid.rows.find((r) => r.rotator.id === "rot-1");
    const cellByDate = Object.fromEntries(row.cells.map((c) => [c.date, c]));
    expect(cellByDate["2026-05-06"].status).toBe("outpatient");
    expect(cellByDate["2026-05-07"].status).toBe("outpatient");
    expect(cellByDate["2026-05-08"].status).toBe("outpatient");
  });

  it("range-assign OP skips every continuity clinic period on matching weekdays", () => {
    const state = makeRangeState();
    const block = state.serviceBlocks[0];
    state.rotators[0].continuityClinic = "Tuesday PM, Thursday AM";

    const next = applyRangeAssignment(state, block, {
      rotatorId: "rot-1",
      startDate: "2026-05-07",
      endDate: "2026-05-07",
      phase: "outpatient"
    });

    const periods = next.outpatientSessions
      .filter((s) => s.rotatorId === "rot-1" && s.date === "2026-05-07")
      .map((s) => s.period)
      .sort();
    expect(periods).toEqual(["PM"]);
  });

  it("range-assign OP uses the generic placeholder label (not Methodist) and dedupes by slot on re-run", () => {
    const state = makeRangeState();
    const block = state.serviceBlocks[0];
    const args = { rotatorId: "rot-1", startDate: "2026-05-06", endDate: "2026-05-08", phase: "outpatient" };
    const once = applyRangeAssignment(state, block, args);
    const placeholders = once.outpatientSessions.filter((s) => s.rotatorId === "rot-1");
    expect(placeholders.length).toBeGreaterThan(0);
    // Generic "clinic not specified" label — NOT the Methodist 14/14 label.
    expect(placeholders.every((s) => s.clinic === OP_PLACEHOLDER_CLINIC)).toBe(true);
    expect(placeholders.some((s) => s.clinic === METHODIST_OP_CLINIC)).toBe(false);
    // Slot-identity dedupe (date|rotator|period) is independent of the clinic
    // string, so re-running over the same range must not duplicate sessions.
    const twice = applyRangeAssignment(once, block, args);
    const after = twice.outpatientSessions.filter((s) => s.rotatorId === "rot-1");
    expect(after).toHaveLength(placeholders.length);
  });

  it("OP phase is additive — existing OP records survive a range-assign re-run", () => {
    // Regression: range-assign-OP used to strip the rotator's full OP+IP
    // range and write a single AM Methodist placeholder. A manually-
    // added Continuity Clinic PM session would be silently destroyed
    // when the user re-ran range-assign over the same dates. Now the
    // strip is removed and OP is merged by slot identity.
    let state = makeRangeState();
    // Manually add a real PM Continuity Clinic record on a day inside
    // the range we'll re-assign.
    state = scheduleOutpatientSession(state, {
      date: "2026-05-07",
      period: "PM",
      clinic: "Continuity Clinic",
      provider: "Dr. Real",
      rotatorId: "rot-1"
    });
    const block = state.serviceBlocks[0];
    const next = applyRangeAssignment(state, block, {
      rotatorId: "rot-1",
      startDate: "2026-05-06",
      endDate: "2026-05-08",
      phase: "outpatient"
    });
    const my = next.outpatientSessions.filter((s) => s.rotatorId === "rot-1");
    // PM Continuity Clinic record must survive untouched.
    const survivor = my.find(
      (s) => s.date === "2026-05-07" && s.period === "PM" && s.clinic === "Continuity Clinic"
    );
    expect(survivor).toBeTruthy();
    expect(survivor.provider).toBe("Dr. Real");
    expect(survivor.source).not.toBe("Range-Assigned");
    // The empty AM slot on 5/07 gets a placeholder.
    const filled = my.find(
      (s) => s.date === "2026-05-07" && s.period === "AM"
    );
    expect(filled).toBeTruthy();
    expect(filled.source).toBe("Range-Assigned");
    // 5/06 and 5/08 (empty before) get both AM and PM placeholders.
    const others = my.filter((s) => s.date === "2026-05-06" || s.date === "2026-05-08");
    expect(others.map((s) => `${s.date}|${s.period}`).sort()).toEqual([
      "2026-05-06|AM", "2026-05-06|PM", "2026-05-08|AM", "2026-05-08|PM"
    ]);
  });

  it("setting IP strips any existing OP for the rotator on those dates (mutual exclusion)", () => {
    let state = makeRangeState();
    state = scheduleOutpatientSession(state, {
      date: "2026-05-07", period: "AM", clinic: "Continuity Clinic", provider: "Dr. X", rotatorId: "rot-1"
    });
    state = scheduleOutpatientSession(state, {
      date: "2026-05-07", period: "PM", clinic: "Continuity Clinic", provider: "Dr. Y", rotatorId: "rot-1"
    });
    expect(state.outpatientSessions.filter((s) => s.rotatorId === "rot-1")).toHaveLength(2);

    const next = applyRangeAssignment(state, state.serviceBlocks[0], {
      rotatorId: "rot-1",
      startDate: "2026-05-07",
      endDate: "2026-05-07",
      phase: "inpatient"
    });

    expect(next.outpatientSessions.filter((s) => s.rotatorId === "rot-1")).toHaveLength(0);
    expect(next.inpatientAssignments.filter((a) => a.rotatorId === "rot-1" && a.date === "2026-05-07")).toHaveLength(1);
  });

  it("setting OP strips any existing IP for the rotator on those dates (mutual exclusion)", () => {
    let state = makeRangeState();
    state = scheduleInpatientAssignment(state, { date: "2026-05-07", rotatorId: "rot-1", role: "Resident" });
    state = scheduleInpatientAssignment(state, { date: "2026-05-08", rotatorId: "rot-1", role: "Team senior" });
    expect(state.inpatientAssignments.filter((a) => a.rotatorId === "rot-1")).toHaveLength(2);

    const next = applyRangeAssignment(state, state.serviceBlocks[0], {
      rotatorId: "rot-1",
      startDate: "2026-05-07",
      endDate: "2026-05-08",
      phase: "outpatient"
    });

    expect(next.inpatientAssignments.filter((a) => a.rotatorId === "rot-1")).toHaveLength(0);
    // Range-OP writes BOTH AM and PM per weekday now. 2 weekdays × 2 = 4.
    expect(next.outpatientSessions.filter((s) => s.rotatorId === "rot-1")).toHaveLength(4);
  });

  it("clear strips both IP and OP for the rotator across the range without touching others", () => {
    let state = makeRangeState();
    state = scheduleInpatientAssignment(state, { date: "2026-05-07", rotatorId: "rot-1", role: "Resident" });
    state = scheduleOutpatientSession(state, {
      date: "2026-05-08", period: "AM", clinic: "Continuity Clinic", provider: "Dr. X", rotatorId: "rot-1"
    });
    // Other rotator's records on the same days — must be preserved.
    state = scheduleInpatientAssignment(state, { date: "2026-05-07", rotatorId: "rot-2", role: "Resident" });
    state = scheduleOutpatientSession(state, {
      date: "2026-05-08", period: "PM", clinic: "Continuity Clinic", provider: "Dr. Y", rotatorId: "rot-2"
    });

    const next = applyRangeAssignment(state, state.serviceBlocks[0], {
      rotatorId: "rot-1",
      startDate: "2026-05-06",
      endDate: "2026-05-15",
      phase: "clear"
    });

    expect(next.inpatientAssignments.filter((a) => a.rotatorId === "rot-1")).toHaveLength(0);
    expect(next.outpatientSessions.filter((s) => s.rotatorId === "rot-1")).toHaveLength(0);
    // Other rotator untouched.
    expect(next.inpatientAssignments.filter((a) => a.rotatorId === "rot-2")).toHaveLength(1);
    expect(next.outpatientSessions.filter((s) => s.rotatorId === "rot-2")).toHaveLength(1);
  });

  it("skips dates outside the rotator's segment (absent)", () => {
    const state = makeRangeState();
    // Segment is 5/06–5/15; requesting 5/04–5/08 means 5/04 and 5/05 are absent.
    const next = applyRangeAssignment(state, state.serviceBlocks[0], {
      rotatorId: "rot-1",
      startDate: "2026-05-04",
      endDate: "2026-05-08",
      phase: "inpatient"
    });
    const myIp = next.inpatientAssignments.filter((a) => a.rotatorId === "rot-1");
    expect(myIp.map((a) => a.date).sort()).toEqual(["2026-05-06", "2026-05-07", "2026-05-08"]);
  });

  it("skips dates where the rotator is unavailable (off)", () => {
    const state = makeRangeState();
    // 5/09 is in unavailableRanges → should be skipped silently.
    const next = applyRangeAssignment(state, state.serviceBlocks[0], {
      rotatorId: "rot-1",
      startDate: "2026-05-09",
      endDate: "2026-05-09",
      phase: "inpatient"
    });
    expect(next).toBe(state); // no applyDates → same reference
  });

  it("returns the same state reference when the range is entirely outside any segment", () => {
    const state = makeRangeState();
    // Request 5/16–5/17 — past segment end (5/15)
    const next = applyRangeAssignment(state, state.serviceBlocks[0], {
      rotatorId: "rot-1",
      startDate: "2026-05-16",
      endDate: "2026-05-17",
      phase: "inpatient"
    });
    expect(next).toBe(state);
  });

  it("clamps to block boundaries and preserves the planning-grid invariant", () => {
    const state = makeRangeState();
    const block = state.serviceBlocks[0];
    // Request way outside the block on both ends — should clamp to 5/04–5/17.
    const preview = previewRangeAssignment(state, block, {
      rotatorId: "rot-1",
      startDate: "2026-04-01",
      endDate: "2026-06-30"
    });
    expect(preview.clampedStart).toBe("2026-05-04");
    expect(preview.clampedEnd).toBe("2026-05-17");
    expect(preview.wasClamped).toBe(true);
    // applyDates are dates the rotator is active AND available within the clamped window.
    // Segment 5/06–5/15, unavailable 5/09 → 9 dates (5/06,07,08,10,11,12,13,14,15).
    expect(preview.applyDates).toHaveLength(9);

    const next = applyRangeAssignment(state, block, {
      rotatorId: "rot-1",
      startDate: "2026-04-01",
      endDate: "2026-06-30",
      phase: "outpatient"
    });
    const grid = buildPlanningGrid(next, block);
    for (const t of grid.totals) {
      expect(t.ip + t.op - t.both + t.unassigned).toBe(t.present);
    }
  });

  // ---- contract v2 §1b: phase "off" + same-day exclusivity (#3a/#7) ----

  it("phase 'off' writes role:'Off' inpatient records that render marked-off", () => {
    const state = makeRangeState();
    const block = state.serviceBlocks[0];
    const next = applyRangeAssignment(state, block, {
      rotatorId: "rot-1",
      startDate: "2026-05-06",
      endDate: "2026-05-08",
      phase: "off"
    });

    const myIp = next.inpatientAssignments.filter((a) => a.rotatorId === "rot-1");
    expect(myIp).toHaveLength(3);
    expect(myIp.every((a) => a.role === "Off")).toBe(true);
    expect(myIp.every((a) => a.source === "Range-Assigned")).toBe(true);
    expect(myIp.map((a) => a.id).sort()).toEqual([
      "off-2026-05-06-rot-1", "off-2026-05-07-rot-1", "off-2026-05-08-rot-1"
    ]);
    expect(next.outpatientSessions.filter((s) => s.rotatorId === "rot-1")).toHaveLength(0);

    // Grid classifies the OFF cells as status:"off", reason:"marked-off".
    const grid = buildPlanningGrid(next, block);
    const row = grid.rows.find((r) => r.rotator.id === "rot-1");
    const cellByDate = Object.fromEntries(row.cells.map((c) => [c.date, c]));
    expect(cellByDate["2026-05-06"].status).toBe("off");
    expect(cellByDate["2026-05-06"].reason).toBe("marked-off");
  });

  it("phase 'off' is excluded from coverage headcount (role:'Off' isn't real IP)", () => {
    const state = makeRangeState();
    const block = state.serviceBlocks[0];
    const next = applyRangeAssignment(state, block, {
      rotatorId: "rot-1",
      startDate: "2026-05-06",
      endDate: "2026-05-08",
      phase: "off"
    });
    const grid = buildPlanningGrid(next, block);
    const totalsByDate = Object.fromEntries(grid.totals.map((t) => [t.date, t]));
    // rot-1 marked Off on 5/06; no real IP that day → ip total stays 0.
    expect(totalsByDate["2026-05-06"].ip).toBe(0);
  });

  it("'clear' removes a painted OFF day", () => {
    let state = makeRangeState();
    const block = state.serviceBlocks[0];
    state = applyRangeAssignment(state, block, {
      rotatorId: "rot-1", startDate: "2026-05-06", endDate: "2026-05-08", phase: "off"
    });
    expect(state.inpatientAssignments.filter((a) => a.rotatorId === "rot-1")).toHaveLength(3);
    const cleared = applyRangeAssignment(state, block, {
      rotatorId: "rot-1", startDate: "2026-05-06", endDate: "2026-05-08", phase: "clear"
    });
    expect(cleared.inpatientAssignments.filter((a) => a.rotatorId === "rot-1")).toHaveLength(0);
    expect(cleared.outpatientSessions.filter((s) => s.rotatorId === "rot-1")).toHaveLength(0);
  });

  it("OP phase writes NO sessions on a noClinic holiday weekday (contract §6/§1d, B-1)", () => {
    // Block with a noClinic holiday on a weekday inside the rotator's
    // active segment. 2026-05-07 is a Thursday.
    const block = {
      id: "b", name: "Holiday test", startDate: "2026-05-04", endDate: "2026-05-17",
      status: "Draft", generate: {}, holidays: [{ date: "2026-05-07", label: "Test Holiday", noClinic: true }]
    };
    const rotator = makeRotator("rot-1", "OP Tester", "UT Pediatrics", "PGY-2", [
      { start: "2026-05-06", end: "2026-05-15" }
    ]);
    const state = {
      version: 2, activeBlockId: "b", serviceBlocks: [block], sources: [],
      rotators: [rotator], attendings: [], expectedSourcePrograms: [],
      inpatientAssignments: [], outpatientSessions: [],
      rules: { maxConsecutiveInpatientDays: 6 }, notes: []
    };
    const next = applyRangeAssignment(state, block, {
      rotatorId: "rot-1", startDate: "2026-05-06", endDate: "2026-05-08", phase: "outpatient"
    });
    const myOp = next.outpatientSessions.filter((s) => s.rotatorId === "rot-1");
    // The holiday date (5/07) must get ZERO OP sessions; the other two
    // weekdays (5/06, 5/08) get AM+PM each = 4 sessions.
    expect(myOp.filter((s) => s.date === "2026-05-07")).toHaveLength(0);
    expect(myOp.map((s) => s.date).sort()).toEqual([
      "2026-05-06", "2026-05-06", "2026-05-08", "2026-05-08"
    ]);
  });

  it("same-day exclusivity: each of IP/OP/OFF strips the others for that date+rotator", () => {
    let state = makeRangeState();
    const block = state.serviceBlocks[0];
    const args = (phase) => ({ rotatorId: "rot-1", startDate: "2026-05-06", endDate: "2026-05-06", phase });
    const ipCount = (s) => s.inpatientAssignments.filter((a) => a.rotatorId === "rot-1" && a.role !== "Off").length;
    const offCount = (s) => s.inpatientAssignments.filter((a) => a.rotatorId === "rot-1" && a.role === "Off").length;
    const opCount = (s) => s.outpatientSessions.filter((a) => a.rotatorId === "rot-1").length;

    // Paint IP, then OFF → IP stripped, one OFF record, no OP.
    state = applyRangeAssignment(state, block, args("inpatient"));
    expect(ipCount(state)).toBe(1);
    state = applyRangeAssignment(state, block, args("off"));
    expect(ipCount(state)).toBe(0);
    expect(offCount(state)).toBe(1);
    expect(opCount(state)).toBe(0);

    // Paint OP → OFF stripped, OP present (2 periods), no real IP.
    state = applyRangeAssignment(state, block, args("outpatient"));
    expect(offCount(state)).toBe(0);
    expect(ipCount(state)).toBe(0);
    expect(opCount(state)).toBe(2);

    // Paint IP again → OP stripped, one IP record.
    state = applyRangeAssignment(state, block, args("inpatient"));
    expect(opCount(state)).toBe(0);
    expect(ipCount(state)).toBe(1);
    expect(offCount(state)).toBe(0);
  });
});

describe("assessRangeAssignment — profile-override warnings (contract v2 §1c, Coordinator #2)", () => {
  function makeProfileState(defaultPhase) {
    const block = {
      id: "b", name: "Profile test", startDate: "2026-05-04", endDate: "2026-05-17",
      status: "Draft", generate: {}, holidays: []
    };
    const rotator = makeRotator("rot-1", "Profiled Rotator", "UT Pediatrics", "PGY-2", []);
    // Set segments directly (makeRotator's normalizeSegments drops
    // defaultPhase), matching the existing pre-assignment test fixtures.
    rotator.segments = [{ start: "2026-05-04", end: "2026-05-17", defaultPhase }];
    return {
      version: 2, activeBlockId: "b", serviceBlocks: [block], sources: [],
      rotators: [rotator], attendings: [], expectedSourcePrograms: [],
      inpatientAssignments: [], outpatientSessions: [],
      rules: { maxConsecutiveInpatientDays: 6 }, notes: []
    };
  }

  it("warns for each touched date when the attempted phase contradicts segment.defaultPhase", () => {
    const state = makeProfileState("inpatient");
    const block = state.serviceBlocks[0];
    const { warnings } = assessRangeAssignment(state, block, {
      rotatorId: "rot-1", startDate: "2026-05-04", endDate: "2026-05-06", phase: "outpatient"
    });
    expect(warnings).toHaveLength(3); // 5/04, 5/05, 5/06
    for (const w of warnings) {
      expect(w.kind).toBe("profile-override");
      expect(w.rotatorId).toBe("rot-1");
      expect(w.profilePhase).toBe("inpatient");
      expect(w.attemptedPhase).toBe("outpatient");
      expect(typeof w.message).toBe("string");
    }
    expect(warnings.map((w) => w.date)).toEqual(["2026-05-04", "2026-05-05", "2026-05-06"]);
  });

  it("does NOT warn when the attempted phase matches the profile", () => {
    const state = makeProfileState("inpatient");
    const block = state.serviceBlocks[0];
    const { warnings } = assessRangeAssignment(state, block, {
      rotatorId: "rot-1", startDate: "2026-05-04", endDate: "2026-05-06", phase: "inpatient"
    });
    expect(warnings).toHaveLength(0);
  });

  it("does NOT warn when the segment has no defaultPhase (null profile)", () => {
    const state = makeProfileState(undefined);
    const block = state.serviceBlocks[0];
    const { warnings } = assessRangeAssignment(state, block, {
      rotatorId: "rot-1", startDate: "2026-05-04", endDate: "2026-05-06", phase: "outpatient"
    });
    expect(warnings).toHaveLength(0);
  });

  it("'off' and 'clear' contradict ANY non-null profile phase", () => {
    const block = makeProfileState("inpatient").serviceBlocks[0];
    for (const phase of ["off", "clear"]) {
      const state = makeProfileState("outpatient");
      const { warnings } = assessRangeAssignment(state, block, {
        rotatorId: "rot-1", startDate: "2026-05-04", endDate: "2026-05-04", phase
      });
      expect(warnings).toHaveLength(1);
      expect(warnings[0].attemptedPhase).toBe(phase);
      expect(warnings[0].profilePhase).toBe("outpatient");
    }
  });

  it("touched dates match applyRangeAssignment exactly (skips unavailable/inactive)", () => {
    const state = makeProfileState("inpatient");
    state.rotators[0].unavailableRanges = [{ start: "2026-05-05", end: "2026-05-05" }];
    const block = state.serviceBlocks[0];
    const { warnings } = assessRangeAssignment(state, block, {
      rotatorId: "rot-1", startDate: "2026-05-04", endDate: "2026-05-06", phase: "outpatient"
    });
    // 5/05 is unavailable → not touched → not warned.
    expect(warnings.map((w) => w.date)).toEqual(["2026-05-04", "2026-05-06"]);
  });
});

describe("validateDrop + applyDrop (drag-drop)", () => {
  function makeStateWithActiveRotator() {
    let state = createInitialState();
    const block = state.serviceBlocks[0];
    const r = makeRotator("r1", "Active Rotator", "UT Pediatrics", "PGY-2", [
      { start: block.startDate, end: block.endDate }
    ]);
    return { state: { ...state, rotators: [r] }, block, rotator: r };
  }

  describe("validateDrop", () => {
    it("returns valid:false on missing arguments", () => {
      expect(validateDrop(null, "r1", "2026-05-04").valid).toBe(false);
      expect(validateDrop({}, null, "2026-05-04").valid).toBe(false);
      expect(validateDrop({}, "r1", null).valid).toBe(false);
    });

    it("returns valid:false when rotator doesn't exist", () => {
      const { state } = makeStateWithActiveRotator();
      const result = validateDrop(state, "nope", "2026-05-04");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/not found/i);
    });

    it("returns valid:true for an active, available rotator on a valid date", () => {
      const { state, block } = makeStateWithActiveRotator();
      const result = validateDrop(state, "r1", block.startDate);
      expect(result.valid).toBe(true);
    });

    it("returns valid:false when rotator's segments don't cover the date", () => {
      const { state } = makeStateWithActiveRotator();
      const result = validateDrop(state, "r1", "2027-01-01");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/not on service/i);
    });

    it("returns valid:false when rotator's day-off matches the date weekday", () => {
      const { state, block } = makeStateWithActiveRotator();
      const date = block.startDate;
      const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
        new Date(`${date}T00:00:00`).getDay()
      ];
      const augmented = {
        ...state,
        rotators: state.rotators.map((r) => ({ ...r, dayOff: [weekday] }))
      };
      const result = validateDrop(augmented, "r1", date);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/unavailable/i);
    });
  });

  describe("applyDrop", () => {
    it("creates an inpatient assignment when validateDrop passes", () => {
      const { state, block } = makeStateWithActiveRotator();
      const date = block.startDate;
      const next = applyDrop(state, "r1", date);
      expect(next.inpatientAssignments.length).toBe(1);
      const assignment = next.inpatientAssignments[0];
      expect(assignment.date).toBe(date);
      expect(assignment.rotatorId).toBe("r1");
      expect(assignment.role).toBe("Resident");
      expect(assignment.source).toBe("Drag-Drop");
    });

    it("returns state unchanged when validateDrop fails", () => {
      const { state } = makeStateWithActiveRotator();
      const next = applyDrop(state, "r1", "2027-01-01"); // outside segments
      expect(next).toBe(state);
    });

    it("returns state unchanged when rotator doesn't exist", () => {
      const { state } = makeStateWithActiveRotator();
      const next = applyDrop(state, "nope", "2026-05-04");
      expect(next).toBe(state);
    });
  });
});

describe("focusTargetForConflict (conflict-jump)", () => {
  it("returns null for null / unknown conflict shape", () => {
    expect(focusTargetForConflict(null)).toBe(null);
    expect(focusTargetForConflict({ type: "weird-thing" })).toBe(null);
  });

  it("routes missing-legend conflicts to the Reports page", () => {
    const conflict = { type: "missing-legend", rotatorId: "r1", date: "2026-05-04" };
    expect(focusTargetForConflict(conflict)).toEqual({
      page: "Reports",
      rotatorId: "r1"
    });
  });

  it("routes clinic-* conflicts to the Clinics page", () => {
    const conflict = { type: "clinic-over-capacity", date: "2026-05-04", rotatorId: "r1" };
    expect(focusTargetForConflict(conflict)).toEqual({
      page: "Clinics",
      date: "2026-05-04",
      rotatorId: "r1"
    });
  });

  it("routes assignment=inpatient conflicts to the Inpatient Schedule page", () => {
    const conflict = {
      type: "rotator-unavailable",
      assignment: "inpatient",
      date: "2026-05-04",
      rotatorId: "r1"
    };
    expect(focusTargetForConflict(conflict)).toEqual({
      page: "Inpatient Schedule",
      date: "2026-05-04",
      rotatorId: "r1"
    });
  });

  it("routes assignment=outpatient conflicts to the Outpatient Schedule page (with period)", () => {
    const conflict = {
      type: "continuity-clinic-conflict",
      assignment: "outpatient",
      date: "2026-05-12",
      rotatorId: "r1",
      period: "PM"
    };
    expect(focusTargetForConflict(conflict)).toEqual({
      page: "Outpatient Schedule",
      date: "2026-05-12",
      rotatorId: "r1",
      period: "PM"
    });
  });
});

describe("conflict shape includes rotatorId / period / assignment (conflict-jump v18)", () => {
  it("double-book conflict carries the outpatient rotator + period + assignment", () => {
    let state = createInitialState();
    const block = state.serviceBlocks[0];
    const r = makeRotator("r1", "X", "UT Pediatrics", "PGY-2", [
      { start: block.startDate, end: block.endDate }
    ]);
    const date = block.startDate;
    state = {
      ...state,
      rotators: [r],
      inpatientAssignments: [
        { id: "in-1", date, rotatorId: "r1", role: "Resident", source: "Manual" }
      ],
      outpatientSessions: [
        { id: "out-1", date, period: "AM", clinic: "Clinic A", provider: "Alder", rotatorId: "r1", status: "Scheduled" }
      ]
    };
    const conflicts = detectConflicts(state);
    const double = conflicts.find((c) => c.type === "double-booked");
    expect(double).toBeDefined();
    expect(double.rotatorId).toBe("r1");
    expect(double.period).toBe("AM");
    expect(double.assignment).toBe("outpatient");
  });
});

describe("removeRotator + removeRotators (Coordinator-3)", () => {
  function makeStateWithTwoRotators() {
    let state = createInitialState();
    const r1 = makeRotator("r1", "First Rotator", "UT Pediatrics", "PGY-2", [
      { start: "2026-05-01", end: "2026-05-14" }
    ]);
    const r2 = makeRotator("r2", "Second Rotator", "UT Pediatrics", "PGY-3", [
      { start: "2026-05-01", end: "2026-05-14" }
    ]);
    state = { ...state, rotators: [r1, r2] };
    state = { ...state,
      inpatientAssignments: [
        { id: "in-r1-1", date: "2026-05-04", rotatorId: "r1", role: "Resident", source: "Manual" },
        { id: "in-r2-1", date: "2026-05-04", rotatorId: "r2", role: "Resident", source: "Manual" }
      ],
      outpatientSessions: [
        { id: "out-r1-1", date: "2026-05-05", period: "AM", rotatorId: "r1", clinic: "Continuity", provider: "Alder", status: "Scheduled" }
      ],
      clinicAssignments: [
        { id: "clinic-r1-1", clinicOccurrenceId: "occ-r1-1", rotatorId: "r1", date: "2026-05-05", session: "AM", source: "Manual" },
        { id: "clinic-r2-1", clinicOccurrenceId: "occ-r2-1", rotatorId: "r2", date: "2026-05-05", session: "PM", source: "Manual" }
      ]
    };
    return state;
  }

  it("removeRotator drops the rotator and cascades to assignments + sessions", () => {
    const state = makeStateWithTwoRotators();
    const next = removeRotator(state, "r1");
    expect(next.rotators.map((r) => r.id)).toEqual(["r2"]);
    expect(next.inpatientAssignments.map((a) => a.rotatorId)).toEqual(["r2"]);
    expect(next.outpatientSessions).toEqual([]);
    expect(next.clinicAssignments.map((a) => a.rotatorId)).toEqual(["r2"]);
  });

  it("removeRotators (plural) drops every named rotator + cascades", () => {
    const state = makeStateWithTwoRotators();
    const next = removeRotators(state, ["r1", "r2"]);
    expect(next.rotators).toEqual([]);
    expect(next.inpatientAssignments).toEqual([]);
    expect(next.outpatientSessions).toEqual([]);
    expect(next.clinicAssignments).toEqual([]);
  });

  it("removeRotators accepts a Set as well as an array", () => {
    const state = makeStateWithTwoRotators();
    const next = removeRotators(state, new Set(["r1"]));
    expect(next.rotators.map((r) => r.id)).toEqual(["r2"]);
  });

  it("removeRotators is a no-op on an empty id collection", () => {
    const state = makeStateWithTwoRotators();
    expect(removeRotators(state, [])).toBe(state);
    expect(removeRotators(state, new Set())).toBe(state);
  });
});

describe("coverage demand model (auto-draft piece 1)", () => {
  // Fixed dates so the test doesn't drift with createInitialState's
  // today-based block. 2026-05-01 = Friday; 05-02 Sat, 05-03 Sun, 05-04 Mon.
  const block = {
    id: "b1", name: "B", startDate: "2026-05-01", endDate: "2026-05-31",
    status: "Draft", generate: {}, holidays: [{ date: "2026-05-25", label: "Memorial Day", noClinic: true }]
  };

  it("defaults: inpatient demand is 2 EVERY day incl weekends (contract v2 §1d / Coordinator #6)", () => {
    // Coordinator #6 (2026-06-02): inpatient always needs at least two bodies,
    // every day including weekends and holidays.
    expect(coverageForDate(block, "2026-05-04").count).toBe(2); // Monday
    expect(coverageForDate(block, "2026-05-02").count).toBe(2); // Saturday
    expect(coverageForDate(block, "2026-05-03").count).toBe(2); // Sunday
  });

  it("classifies holidays separately; default holiday demand is 2 (contract v2 §1d / Coordinator #6)", () => {
    // noClinic suppresses OUTPATIENT clinic only; inpatient staffing is
    // still required every day, so the holiday default is the min-2 too.
    expect(coverageForDate(block, "2026-05-25").count).toBe(2); // holiday, none set
  });

  it("defaultCoverageCount exposes the engine's per-day-type default (so the form can't drift)", () => {
    expect(defaultCoverageCount("weekday")).toBe(2);
    expect(defaultCoverageCount("saturday")).toBe(2);
    expect(defaultCoverageCount("sunday")).toBe(2);
    expect(defaultCoverageCount("holiday")).toBe(2);
    expect(defaultCoverageCount("nonsense")).toBe(0); // unknown day-type -> safe 0
  });

  it("reads explicit per-day-type counts + byRole", () => {
    const withCov = { ...block, coverage: {
      weekday: { ip: { count: 2, byRole: { Resident: 1 } } },
      saturday: { ip: { count: 1 } },
      sunday: { ip: { count: 0 } },
      holiday: { ip: { count: 1 } }
    }};
    expect(coverageForDate(withCov, "2026-05-04").count).toBe(2);
    expect(coverageForDate(withCov, "2026-05-04").byRole).toEqual({ Resident: 1 });
    expect(coverageForDate(withCov, "2026-05-02").count).toBe(1); // Saturday explicit
    expect(coverageForDate(withCov, "2026-05-03").count).toBe(0); // Sunday explicit override -> 0
    expect(coverageForDate(withCov, "2026-05-25").count).toBe(1); // holiday explicit
  });

  it("setBlockCoverage attaches coverage additively and leaves other blocks/fields alone", () => {
    const state = { serviceBlocks: [{ ...block }, { id: "b2", name: "Other" }] };
    const cov = { weekday: { ip: { count: 3 } } };
    const next = setBlockCoverage(state, "b1", cov);
    const b1 = next.serviceBlocks.find((b) => b.id === "b1");
    expect(b1.coverage).toEqual(cov);
    expect(b1.name).toBe("B");
    expect(next.serviceBlocks.find((b) => b.id === "b2").coverage).toBeUndefined();
  });

  it("suggestCoverageFromGrid derives the weekday count from a block's inpatient totals", () => {
    const seg = [{ start: "2026-05-01", end: "2026-05-31" }];
    let state = createInitialState();
    state = { ...state, serviceBlocks: [block], activeBlockId: "b1",
      rotators: [makeRotator("r1", "A", "UT Pediatrics", "PGY-2", seg), makeRotator("r2", "B", "UT Pediatrics", "PGY-3", seg)] };
    for (const date of ["2026-05-04", "2026-05-05"]) {
      for (const rid of ["r1", "r2"]) {
        state = scheduleInpatientAssignment(state, { date, rotatorId: rid, role: "Resident" });
      }
    }
    const cov = suggestCoverageFromGrid(state, block);
    expect(cov.weekday.ip.count).toBe(2);
    // Coordinator #6: the suggestion honors the hard min-2 floor on weekends/
    // holidays rather than 0, so "prefill from grid" can't propose coverage
    // below the always-staff-inpatient rule.
    expect(cov.saturday.ip.count).toBe(2);
    expect(cov.sunday.ip.count).toBe(2);
    expect(cov.holiday.ip.count).toBe(2);
  });
});

describe("validateDrop hard rules (auto-draft piece 2)", () => {
  function stateWith(rotatorOverrides = {}) {
    const block = { id: "b1", name: "B", startDate: "2026-05-01", endDate: "2026-05-31", status: "Draft", generate: {}, holidays: [] };
    let s = createInitialState();
    const r = { ...makeRotator("r1", "R", "UT Pediatrics", "PGY-2", [{ start: "2026-05-01", end: "2026-05-31" }]), ...rotatorOverrides };
    s = { ...s, serviceBlocks: [block], activeBlockId: "b1", rotators: [r] };
    return { s, block, r };
  }

  it("refuses a drop that would double-book (rotator already has OP that day)", () => {
    let { s } = stateWith();
    s = scheduleOutpatientSession(s, { date: "2026-05-04", period: "AM", clinic: "X", rotatorId: "r1" });
    const res = validateDrop(s, "r1", "2026-05-04");
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/outpatient/i);
  });

  it("enforces maxConsecutiveInpatientDays (6): 6th day ok, 7th refused", () => {
    let { s } = stateWith();
    for (const d of ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"]) {
      s = scheduleInpatientAssignment(s, { date: d, rotatorId: "r1", role: "Resident" });
    }
    expect(validateDrop(s, "r1", "2026-05-09").valid).toBe(true); // would be 6th consecutive
    s = scheduleInpatientAssignment(s, { date: "2026-05-09", rotatorId: "r1", role: "Resident" });
    const res = validateDrop(s, "r1", "2026-05-10"); // would be 7th consecutive
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/consecutive/i);
  });

  it("blocks the second weekend day unless the first is an Off record (Coordinator 2026-07-29 #6b)", () => {
    const block = { id: "b1", name: "B", startDate: "2026-05-04", endDate: "2026-05-10", status: "Draft", generate: {}, holidays: [] };
    const rotator = {
      id: "r1", fullName: "R", displayName: "R", program: "Other", level: "PGY-2", role: "Resident",
      segments: [{ start: "2026-05-04", end: "2026-05-10" }], schoolType: "other",
      continuityClinic: "", dayOff: [], unavailableRanges: []
    };
    const state = {
      activeBlockId: "b1", serviceBlocks: [block], rotators: [rotator],
      outpatientSessions: [],
      inpatientAssignments: [{ id: "sat", date: "2026-05-09", rotatorId: "r1", role: "Resident", source: "Manual" }]
    };
    const res = validateDrop(state, "r1", "2026-05-10");
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/weekend/);
    const withOff = {
      ...state,
      inpatientAssignments: [{ ...state.inpatientAssignments[0], role: "Off" }]
    };
    expect(validateDrop(withOff, "r1", "2026-05-10").valid).toBe(true);
  });

  it("continuity clinic is opt-in: allowed for plain drag-drop, refused when avoidContinuity set", () => {
    const { s } = stateWith({ program: "Methodist", continuityClinic: "Tuesday PM, Thursday AM" });
    // 2026-05-05 is a Tuesday; 2026-05-07 is a Thursday.
    expect(validateDrop(s, "r1", "2026-05-05").valid).toBe(true);
    expect(validateDrop(s, "r1", "2026-05-05", { avoidContinuity: true }).valid).toBe(false);
    expect(validateDrop(s, "r1", "2026-05-07").valid).toBe(true);
    expect(validateDrop(s, "r1", "2026-05-07", { avoidContinuity: true }).valid).toBe(false);
  });

  it("avoidContinuity allows a one-period inpatient day when half-day continuity evidence exists", () => {
    let { s } = stateWith({ program: "Methodist", continuityClinic: "Tuesday PM, Thursday AM" });
    s = {
      ...s,
      halfDayFacts: [{
        id: "half-2026-05-07-am-r1-clinic",
        date: "2026-05-07",
        period: "AM",
        rotatorId: "r1",
        kind: "inpatient-annotation",
        status: "IP",
        label: "AM Clinic",
        source: "Coordinator DOCX inpatient roster"
      }]
    };

    expect(validateDrop(s, "r1", "2026-05-07", { avoidContinuity: true }).valid).toBe(true);
    expect(validateDrop(s, "r1", "2026-05-05", { avoidContinuity: true }).valid).toBe(false);
  });

  it("avoidContinuity still blocks whole-day continuity even when both half-day facts exist", () => {
    let { s } = stateWith({ program: "Methodist", continuityClinic: "Thursday AM, Thursday PM" });
    s = {
      ...s,
      halfDayFacts: [
        {
          id: "half-2026-05-07-am-r1-clinic",
          date: "2026-05-07",
          period: "AM",
          rotatorId: "r1",
          kind: "inpatient-annotation",
          status: "IP",
          label: "AM Clinic",
          source: "Coordinator DOCX inpatient roster"
        },
        {
          id: "half-2026-05-07-pm-r1-clinic",
          date: "2026-05-07",
          period: "PM",
          rotatorId: "r1",
          kind: "inpatient-annotation",
          status: "IP",
          label: "PM Clinic",
          source: "Coordinator DOCX inpatient roster"
        }
      ]
    };

    const result = validateDrop(s, "r1", "2026-05-07", { avoidContinuity: true });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Thursday/);
  });

  it("requiredRole is opt-in: refuses a rotator whose role doesn't match", () => {
    const { s } = stateWith(); // role "Resident"
    expect(validateDrop(s, "r1", "2026-05-04", { requiredRole: "Fellow" }).valid).toBe(false);
    expect(validateDrop(s, "r1", "2026-05-04", { requiredRole: "Resident" }).valid).toBe(true);
  });
});

describe("understaffed conflict (auto-draft piece 2)", () => {
  function stateWithCoverage(count) {
    const block = { id: "b1", name: "B", startDate: "2026-05-01", endDate: "2026-05-08", status: "Draft", generate: {}, holidays: [], coverage: { weekday: { ip: { count } } } };
    const seg = [{ start: "2026-05-01", end: "2026-05-08" }];
    let s = createInitialState();
    s = { ...s, serviceBlocks: [block], activeBlockId: "b1",
      rotators: [makeRotator("r1", "A", "UT Pediatrics", "PGY-2", seg), makeRotator("r2", "B", "UT Pediatrics", "PGY-3", seg)] };
    return { s, block };
  }

  it("flags understaffed (Warning) when 0 < actual < required; zero stays missing-coverage (Critical)", () => {
    let { s } = stateWithCoverage(2);
    s = scheduleInpatientAssignment(s, { date: "2026-05-04", rotatorId: "r1", role: "Resident" }); // 1 of 2
    const conflicts = detectConflicts(s);
    const u = conflicts.find((c) => c.type === "understaffed" && c.date === "2026-05-04");
    expect(u).toBeTruthy();
    expect(u.severity).toBe("Warning");
    expect(u.detail).toMatch(/1 of 2/);
    const m = conflicts.find((c) => c.type === "missing-coverage" && c.date === "2026-05-05");
    expect(m).toBeTruthy();
  });

  it("no understaffed/missing-coverage when actual >= required", () => {
    let { s } = stateWithCoverage(2);
    s = scheduleInpatientAssignment(s, { date: "2026-05-04", rotatorId: "r1", role: "Resident" });
    s = scheduleInpatientAssignment(s, { date: "2026-05-04", rotatorId: "r2", role: "Resident" });
    const hits = detectConflicts(s).filter((c) => c.date === "2026-05-04" && (c.type === "understaffed" || c.type === "missing-coverage"));
    expect(hits.length).toBe(0);
  });
});

describe("fillOutpatientTarget — continuity-aware outpatient fair-fill", () => {
  it("skips every continuity clinic period while filling outpatient targets", () => {
    const block = { id: "b1", name: "B", startDate: "2026-05-07", endDate: "2026-05-07", status: "Draft", generate: {}, holidays: [] };
    const seg = [{ start: "2026-05-07", end: "2026-05-07" }];
    const r1 = makeRotator("r1", "A", "UT Pediatrics", "PGY-2", seg);
    const r2 = makeRotator("r2", "B", "UT Pediatrics", "PGY-3", seg);
    r1.continuityClinic = "Tuesday PM, Thursday AM";
    let s = createInitialState();
    s = { ...s, serviceBlocks: [block], activeBlockId: "b1", rotators: [r1, r2] };

    const next = fillOutpatientTarget(s, block);
    const r1Periods = next.outpatientSessions
      .filter((session) => session.rotatorId === "r1" && session.date === "2026-05-07")
      .map((session) => session.period)
      .sort();
    const r2Periods = next.outpatientSessions
      .filter((session) => session.rotatorId === "r2" && session.date === "2026-05-07")
      .map((session) => session.period)
      .sort();

    expect(r1Periods).toEqual(["PM"]);
    expect(r2Periods).toEqual(["AM", "PM"]);
  });
});

describe("proposeSchedule fair-fill engine (auto-draft piece 3)", () => {
  // Mon–Fri week so weekday demand applies on every day. 2026-05-04..08.
  function weekState({ coverage, rotators }) {
    const block = { id: "b1", name: "B", startDate: "2026-05-04", endDate: "2026-05-08", status: "Draft", generate: {}, holidays: [], coverage };
    let s = createInitialState();
    s = { ...s, serviceBlocks: [block], activeBlockId: "b1", rotators };
    return { s, block };
  }
  const fullWeekSeg = [{ start: "2026-05-04", end: "2026-05-08" }];
  const ipDaysFor = (state, rid) =>
    state.inpatientAssignments.filter((a) => a.rotatorId === rid && a.role !== "Off").map((a) => a.date).sort();

  it("fills every required-but-open weekday to the demanded count", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 1 } } },
      rotators: [makeRotator("r1", "A", "UT Pediatrics", "PGY-2", fullWeekSeg), makeRotator("r2", "B", "UT Pediatrics", "PGY-3", fullWeekSeg)]
    });
    const { proposedState, unmet } = proposeSchedule(s, block);
    const draft = proposedState.inpatientAssignments.filter((a) => a.source === "Auto-Draft");
    expect(draft.length).toBe(5); // Mon–Fri, 1/day
    expect(unmet).toEqual([]);
    for (const d of ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"]) {
      expect(proposedState.inpatientAssignments.some((a) => a.date === d && a.role !== "Off")).toBe(true);
    }
  });

  it("does not mutate input state and tags new assignments source Auto-Draft", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 1 } } },
      rotators: [makeRotator("r1", "A", "UT Pediatrics", "PGY-2", fullWeekSeg)]
    });
    const before = s.inpatientAssignments.length;
    const { proposedState } = proposeSchedule(s, block);
    expect(s.inpatientAssignments.length).toBe(before); // input untouched
    expect(proposedState.inpatientAssignments.every((a) => a.source === "Auto-Draft" || before > 0)).toBe(true);
  });

  it("LOCKS existing assignments: counts them toward demand and never overwrites", () => {
    let { s, block } = weekState({
      coverage: { weekday: { ip: { count: 2 } } },
      rotators: [makeRotator("r1", "A", "UT Pediatrics", "PGY-2", fullWeekSeg), makeRotator("r2", "B", "UT Pediatrics", "PGY-3", fullWeekSeg)]
    });
    // Pre-existing Auto-Methodist assignment on Monday for r1.
    s = scheduleInpatientAssignment(s, { date: "2026-05-04", rotatorId: "r1", role: "Resident", source: "Auto-Methodist" });
    const { proposedState } = proposeSchedule(s, block);
    const monday = proposedState.inpatientAssignments.filter((a) => a.date === "2026-05-04" && a.role !== "Off");
    expect(monday.length).toBe(2); // 1 locked + 1 new, not 2 new
    const locked = monday.find((a) => a.rotatorId === "r1");
    expect(locked.source).toBe("Auto-Methodist"); // untouched
    expect(monday.some((a) => a.source === "Auto-Draft" && a.rotatorId === "r2")).toBe(true);
  });

  it("honors max-consecutive within the run: one rotator can't exceed 6 in a row", () => {
    // 7 CONTIGUOUS days, demand 1/day, single rotator. Days 1-6 fill as a
    // 6-run; day 7 IS the 7th consecutive -> refused -> unmet.
    const block = { id: "b1", name: "B", startDate: "2026-05-04", endDate: "2026-05-10", status: "Draft", generate: {}, holidays: [], coverage: { weekday: { ip: { count: 1 } }, saturday: { ip: { count: 1 } }, sunday: { ip: { count: 1 } } } };
    let s = createInitialState();
    s = { ...s, serviceBlocks: [block], activeBlockId: "b1", rotators: [makeRotator("r1", "A", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-10" }])] };
    const { proposedState, unmet } = proposeSchedule(s, block);
    expect(ipDaysFor(proposedState, "r1").length).toBe(6); // capped at 6 consecutive
    expect(unmet.length).toBe(1); // the 7th consecutive day can't be filled
    expect(unmet[0].date).toBe("2026-05-10");
  });

  it("over-constrained slots go to unmet with a reason, never fabricated", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 2 } } },
      rotators: [makeRotator("r1", "A", "UT Pediatrics", "PGY-2", fullWeekSeg)] // only ONE rotator, need 2
    });
    const { proposedState, unmet } = proposeSchedule(s, block);
    // each weekday gets 1 (the one rotator), 1 short -> unmet per day
    for (const d of ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"]) {
      expect(proposedState.inpatientAssignments.filter((a) => a.date === d && a.role !== "Off").length).toBe(1);
    }
    expect(unmet.length).toBe(5);
    expect(unmet.every((u) => typeof u.reason === "string" && u.reason.length > 0)).toBe(true);
  });

  it("balances load: two rotators over 4 single-coverage days split ~evenly, deterministically", () => {
    const block = { id: "b1", name: "B", startDate: "2026-05-04", endDate: "2026-05-07", status: "Draft", generate: {}, holidays: [], coverage: { weekday: { ip: { count: 1 } } } };
    let s = createInitialState();
    s = { ...s, serviceBlocks: [block], activeBlockId: "b1", rotators: [makeRotator("r1", "A", "UT Pediatrics", "PGY-2", [{ start: "2026-05-04", end: "2026-05-07" }]), makeRotator("r2", "B", "UT Pediatrics", "PGY-3", [{ start: "2026-05-04", end: "2026-05-07" }])] };
    const a = proposeSchedule(s, block);
    const b = proposeSchedule(s, block);
    expect(ipDaysFor(a.proposedState, "r1").length).toBe(2);
    expect(ipDaysFor(a.proposedState, "r2").length).toBe(2);
    // deterministic: same input -> same output
    expect(JSON.stringify(a.proposedState.inpatientAssignments)).toBe(JSON.stringify(b.proposedState.inpatientAssignments));
  });

  it("never assigns on a rotator's unavailable day", () => {
    const r = { ...makeRotator("r1", "A", "UT Pediatrics", "PGY-2", fullWeekSeg), dayOff: ["Wednesday"] };
    const block = { id: "b1", name: "B", startDate: "2026-05-04", endDate: "2026-05-08", status: "Draft", generate: {}, holidays: [], coverage: { weekday: { ip: { count: 1 } } } };
    let s = createInitialState();
    s = { ...s, serviceBlocks: [block], activeBlockId: "b1", rotators: [r] };
    const { proposedState, unmet } = proposeSchedule(s, block);
    // 2026-05-06 is a Wednesday -> rotator off -> no assignment, unmet
    expect(proposedState.inpatientAssignments.some((a) => a.date === "2026-05-06")).toBe(false);
    expect(unmet.some((u) => u.date === "2026-05-06")).toBe(true);
  });

  // Coordinator #8 (D1b): a Methodist rotator is off OUR inpatient service during
  // their 14-day outpatient fortnight and must never be pulled onto inpatient
  // fair-fill as backup — even on weekends/holidays where they hold no clinic
  // and would otherwise look "free". The split stays split.
  it("excludes a Methodist rotator during their outpatient fortnight from inpatient fair-fill", () => {
    // rotationStartDate 2026-05-20 -> days 0-13 (outpatient) = 5/20-6/02.
    // Week 2026-05-25..29 (Mon-Fri) is days 5-9 -> all outpatient fortnight.
    const block = { id: "b1", name: "B", startDate: "2026-05-25", endDate: "2026-05-29", status: "Draft", generate: {}, holidays: [], coverage: { weekday: { ip: { count: 1 } } } };
    let s = createInitialState();
    s = { ...s, serviceBlocks: [block], activeBlockId: "b1", rotators: [methodistRotator({ id: "m1" })] };
    const { proposedState, unmet } = proposeSchedule(s, block);
    expect(proposedState.inpatientAssignments.filter((a) => a.rotatorId === "m1" && a.role !== "Off").length).toBe(0);
    // Days surface as unmet (honest gap), never silently backfilled by an off-service body.
    expect(unmet.length).toBe(5);
  });

  it("still fair-fills a Methodist rotator during their inpatient fortnight", () => {
    // Week 2026-06-08..12 (Mon-Fri) is days 19-23 of the rotation -> inpatient (14-27).
    const block = { id: "b1", name: "B", startDate: "2026-06-08", endDate: "2026-06-12", status: "Draft", generate: {}, holidays: [], coverage: { weekday: { ip: { count: 1 } } } };
    let s = createInitialState();
    s = { ...s, serviceBlocks: [block], activeBlockId: "b1", rotators: [methodistRotator({ id: "m1" })] };
    const { proposedState, unmet } = proposeSchedule(s, block);
    expect(proposedState.inpatientAssignments.filter((a) => a.rotatorId === "m1" && a.role !== "Off").length).toBe(5);
    expect(unmet).toEqual([]);
  });
});

describe("clampDateToBlock", () => {
  const block = { startDate: "2026-07-01", endDate: "2026-07-28" };

  it("returns the date unchanged when it falls inside the block", () => {
    expect(clampDateToBlock("2026-07-15", block)).toBe("2026-07-15");
    expect(clampDateToBlock("2026-07-01", block)).toBe("2026-07-01"); // inclusive start
    expect(clampDateToBlock("2026-07-28", block)).toBe("2026-07-28"); // inclusive end
  });

  it("clamps a date before the block to the block start", () => {
    // The real bug: today (e.g. 2026-05-24) is before a July block, so the
    // assignment picker should open on the block start, not an out-of-block day.
    expect(clampDateToBlock("2026-05-24", block)).toBe("2026-07-01");
  });

  it("clamps a date after the block to the block end", () => {
    expect(clampDateToBlock("2026-09-10", block)).toBe("2026-07-28");
  });

  it("falls back to the block start when the date is missing/invalid", () => {
    expect(clampDateToBlock(undefined, block)).toBe("2026-07-01");
    expect(clampDateToBlock("", block)).toBe("2026-07-01");
  });

  it("returns the date unchanged when there is no usable block", () => {
    expect(clampDateToBlock("2026-05-24", null)).toBe("2026-05-24");
    expect(clampDateToBlock("2026-05-24", {})).toBe("2026-05-24");
  });
});

describe("extendBlockEnd — peek-past-block-end date math", () => {
  it("pushes the end date forward by the given number of days", () => {
    const block = { id: "b1", name: "Block 1", startDate: "2026-07-01", endDate: "2026-07-30" };
    expect(extendBlockEnd(block, 7).endDate).toBe("2026-08-06");
  });

  it("handles month rollover correctly", () => {
    const block = { startDate: "2026-07-01", endDate: "2026-07-31" };
    expect(extendBlockEnd(block, 3).endDate).toBe("2026-08-03");
  });

  it("preserves every other block field and does not mutate the input", () => {
    const block = { id: "b1", name: "Block 1", startDate: "2026-07-01", endDate: "2026-07-30", holidays: [{ date: "2026-07-04", noClinic: true }] };
    const out = extendBlockEnd(block, 7);
    expect(out.id).toBe("b1");
    expect(out.name).toBe("Block 1");
    expect(out.startDate).toBe("2026-07-01");
    expect(out.holidays).toEqual(block.holidays);
    expect(block.endDate).toBe("2026-07-30"); // input untouched
  });

  it("no-ops on a block with no end date or a non-finite day count", () => {
    expect(extendBlockEnd(null, 7)).toBe(null);
    expect(extendBlockEnd({ startDate: "2026-07-01" }, 7)).toEqual({ startDate: "2026-07-01" });
    const block = { endDate: "2026-07-30" };
    expect(extendBlockEnd(block, NaN)).toBe(block);
  });
});
