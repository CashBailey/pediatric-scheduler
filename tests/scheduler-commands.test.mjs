import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeBlock,
  createInitialState,
  detectConflicts,
} from "../shared/scheduler/scheduler.js";
import {
  executeSchedulerCommand,
  resolveBlock,
  resolveRotator,
  summarizeSchedulerState,
} from "../shared/scheduler/commands.js";

function stateForCommands() {
  return createInitialState(new Date("2026-07-01T12:00:00"));
}

function run(state, type, input = {}) {
  const result = executeSchedulerCommand(state, { type, input });
  assert.equal(result.ok, true, result.error?.message);
  return result;
}

test("T-SCH-CMD-001 block commands add, switch, update, and delete through one pure command surface", () => {
  let state = stateForCommands();

  let result = run(state, "block.add", {
    name: "July 2026",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  });
  state = result.state;
  const july = activeBlock(state);
  assert.equal(july.name, "July 2026");
  assert.equal(result.changed, true);
  assert.equal(result.data.blockId, july.id);

  result = run(state, "block.add", {
    name: "August 2026",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
  });
  state = result.state;
  const august = activeBlock(state);
  assert.equal(august.name, "August 2026");

  state = run(state, "block.use", { blockRef: "July 2026" }).state;
  assert.equal(activeBlock(state).id, july.id);

  state = run(state, "block.update", {
    blockRef: august.id,
    patch: { status: "Ready" },
  }).state;
  assert.equal(resolveBlock(state, august.id).status, "Ready");
  assert.equal(activeBlock(state).id, july.id);

  state = run(state, "block.update", {
    blockRef: "July 2026",
    patch: {
      status: "Final",
      name: "July Final",
      finalizedAt: "2026-07-06T12:00:00.000Z",
      finalizedBy: "Native Reports Review & Finalize",
      finalReview: {
        reviewedAt: "2026-07-06T12:00:00.000Z",
        criticalConflictCount: 0,
        warningConflictCount: 2,
        openSlots: 0,
        missingSourcePrograms: [],
        reason: "Reports Review & Finalize checks passed",
      },
    },
  }).state;
  const finalBlock = resolveBlock(state, "July Final");
  assert.equal(finalBlock.status, "Final");
  assert.equal(finalBlock.finalizedAt, "2026-07-06T12:00:00.000Z");
  assert.equal(finalBlock.finalizedBy, "Native Reports Review & Finalize");
  assert.equal(finalBlock.finalReview.criticalConflictCount, 0);
  assert.equal(finalBlock.finalReview.warningConflictCount, 2);
  assert.deepEqual(finalBlock.finalReview.missingSourcePrograms, []);
  assert.equal(finalBlock.postFinalChanges, undefined);

  result = run(state, "block.update", {
    blockRef: "July Final",
    patch: { name: "July Final Corrected" },
    postFinalReason: "Corrected display title after final review",
    changedBy: "Command test",
  });
  state = result.state;
  const correctedFinalBlock = resolveBlock(state, "July Final Corrected");
  assert.equal(correctedFinalBlock.status, "Final");
  assert.equal(correctedFinalBlock.postFinalChanges.length, 1);
  assert.equal(correctedFinalBlock.postFinalChanges[0].blockId, july.id);
  assert.equal(correctedFinalBlock.postFinalChanges[0].command, "block.update");
  assert.equal(correctedFinalBlock.postFinalChanges[0].reason, "Corrected display title after final review");
  assert.equal(correctedFinalBlock.postFinalChanges[0].changedBy, "Command test");
  assert.equal(correctedFinalBlock.postFinalChanges[0].summary, "Updated block July Final Corrected.");
  assert.deepEqual(result.data.postFinalChange, correctedFinalBlock.postFinalChanges[0]);

  result = run(state, "block.delete", { blockRef: august.id });
  state = result.state;
  assert.equal(state.serviceBlocks.some((block) => block.id === august.id), false);
  assert.equal(activeBlock(state).name, "July Final Corrected");
});

test("T-SCH-CMD-002 rotator commands add, update, and delete while cascading assignments", () => {
  let state = run(stateForCommands(), "block.add", {
    name: "July 2026",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  }).state;

  state = run(state, "rotator.add", {
    fullName: "Drew Quinn",
    program: "UT Pediatrics",
    level: "PGY-2",
    segments: [{ start: "2026-07-01", end: "2026-07-31" }],
    dayOff: ["Friday", "Nonesday"],
    unavailableRanges: [
      { start: "2026-07-10", end: "2026-07-12", label: " Conference " },
      { start: "2026-07-20", end: "2026-07-18", label: "Backwards" },
    ],
  }).state;
  let ari = resolveRotator(state, "Drew Quinn");
  assert.equal(ari.program, "UT Pediatrics");
  assert.deepEqual(ari.dayOff, ["Friday"]);
  assert.deepEqual(ari.unavailableRanges, [
    { start: "2026-07-10", end: "2026-07-12", label: "Conference" },
  ]);

  let methodistState = run(stateForCommands(), "rotator.add", {
    fullName: "Maya Lopez",
    program: "Methodist",
    level: "PGY-3",
    segments: [{ start: "2026-06-20", end: "2026-07-17" }],
    rotationStartDate: " 2026-06-20 ",
    methodistStartSide: "Inpatient",
  }).state;
  let methodist = resolveRotator(methodistState, "Maya Lopez");
  assert.equal(methodist.schoolType, "methodist");
  assert.equal(methodist.rotationStartDate, "2026-06-20");
  assert.equal(methodist.methodistStartSide, "inpatient");
  methodistState = run(methodistState, "rotator.update", {
    rotatorRef: methodist.id,
    patch: {
      rotationStartDate: "2026-06-21",
      methodistStartSide: "outpatient",
    },
  }).state;
  methodist = resolveRotator(methodistState, "Maya Lopez");
  assert.equal(methodist.rotationStartDate, "2026-06-21");
  assert.equal(methodist.methodistStartSide, "outpatient");
  methodistState = run(methodistState, "rotator.update", {
    rotatorRef: methodist.id,
    patch: {
      rotationStartDate: "not-a-date",
      methodistStartSide: "sideways",
    },
  }).state;
  methodist = resolveRotator(methodistState, "Maya Lopez");
  assert.equal(methodist.rotationStartDate, "");
  assert.equal(methodist.methodistStartSide, "");

  state = run(state, "inpatient.assign", {
    rotatorRef: "Drew Quinn",
    date: "2026-07-02",
    role: "Team senior",
  }).state;
  state = run(state, "outpatient.assign", {
    rotatorRef: "Drew Quinn",
    date: "2026-07-06",
    period: "AM",
    clinic: "Continuity Clinic",
    provider: "Alder",
  }).state;
  state = {
    ...state,
    clinicAssignments: [
      { id: "clinic-ari", clinicOccurrenceId: "occ-ari", rotatorId: ari.id, date: "2026-07-06", session: "AM", source: "Manual" },
    ],
  };

  state = run(state, "rotator.update", {
    rotatorRef: "Drew Quinn",
    patch: {
      level: "PGY-3",
      continuityClinic: "Wednesday AM",
      dayOff: ["Monday", "Friday", "Nope"],
      unavailableRanges: [
        { start: "2026-07-18", end: "2026-07-18", label: "Vacation" },
        { start: "bad", end: "2026-07-18" },
      ],
    },
  }).state;
  ari = resolveRotator(state, "Drew Quinn");
  assert.equal(ari.level, "PGY-3");
  assert.equal(ari.continuityClinic, "Wednesday AM");
  assert.deepEqual(ari.dayOff, ["Monday", "Friday"]);
  assert.deepEqual(ari.unavailableRanges, [
    { start: "2026-07-18", end: "2026-07-18", label: "Vacation" },
  ]);

  state = run(state, "rotator.update", {
    rotatorRef: "Drew Quinn",
    patch: { dayOff: [], unavailableRanges: [] },
  }).state;
  ari = resolveRotator(state, "Drew Quinn");
  assert.deepEqual(ari.dayOff, []);
  assert.deepEqual(ari.unavailableRanges, []);

  state = run(state, "rotator.delete", { rotatorRef: ari.id }).state;
  assert.equal(state.rotators.length, 0);
  assert.equal(state.inpatientAssignments.length, 0);
  assert.equal(state.outpatientSessions.length, 0);
  assert.equal(state.clinicAssignments.length, 0);
});

test("source commands add reviewed notes and delete source records without touching rotators", () => {
  let state = {
    ...stateForCommands(),
    rotators: [
      {
        id: "rot-ari",
        fullName: "Drew Quinn",
        displayName: "Drew Quinn",
        program: "UT Pediatrics",
        level: "PGY-2",
        role: "Resident",
        schoolType: "ut-peds",
        segments: [{ start: "2026-07-01", end: "2026-07-31" }],
      },
    ],
    sources: [],
  };

  let result = run(state, "source.add", {
    id: "source-manual-coordinator-note",
    program: "Other",
    fileName: "Coordinator note",
    content: "Use the updated fellow preference sheet.",
  });
  state = result.state;
  assert.equal(result.data.sourceId, "source-manual-coordinator-note");
  assert.equal(state.sources.length, 1);
  assert.equal(state.sources[0].fileType, "manual");
  assert.equal(state.sources[0].status, "Reviewed");
  assert.equal(state.sources[0].content, "Use the updated fellow preference sheet.");
  assert.equal(state.rotators.length, 1);

  const duplicate = executeSchedulerCommand(state, {
    type: "source.add",
    input: { id: "source-manual-coordinator-note", fileName: "Duplicate" },
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, "duplicate_source");
  assert.equal(duplicate.state, state);

  result = run(state, "source.delete", { sourceId: "Coordinator note" });
  state = result.state;
  assert.equal(result.data.sourceId, "source-manual-coordinator-note");
  assert.equal(state.sources.length, 0);
  assert.equal(state.rotators.length, 1);

  state = {
    ...state,
    sources: [{ id: "source-keep", fileName: "keep.csv" }],
  };
  result = run(state, "source.remove", { id: "source-keep" });
  assert.equal(result.state.sources.length, 0);
});

test("source.add tolerates legacy states without sources and rejects invalid source metadata", () => {
  const { sources, ...legacy } = stateForCommands();

  const added = run(legacy, "source.add", {
    fileName: "Legacy manual note",
    content: "Recovered from legacy state.",
  });
  assert.equal(added.state.sources.length, 1);
  assert.equal(added.state.sources[0].fileName, "Legacy manual note");

  const badWarnings = executeSchedulerCommand(added.state, {
    type: "source.add",
    input: { fileName: "Bad warnings", importWarnings: [123] },
  });
  assert.equal(badWarnings.ok, false);
  assert.equal(badWarnings.error.code, "invalid_type");
  assert.equal(badWarnings.error.field, "importWarnings");

  const badWarningCount = executeSchedulerCommand(added.state, {
    type: "source.add",
    input: { fileName: "Bad warning count", importWarningCount: -1 },
  });
  assert.equal(badWarningCount.ok, false);
  assert.equal(badWarningCount.error.code, "invalid_type");
  assert.equal(badWarningCount.error.field, "importWarningCount");
});

test("T-SCH-CMD-003 range command supports inpatient, outpatient, off, and clear effects", () => {
  let state = run(stateForCommands(), "block.add", {
    name: "July 2026",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  }).state;
  state = run(state, "rotator.add", {
    fullName: "Drew Quinn",
    program: "UT Pediatrics",
    level: "PGY-2",
    segments: [{ start: "2026-07-01", end: "2026-07-31" }],
  }).state;

  state = run(state, "assign.range", {
    rotatorRef: "Drew Quinn",
    blockRef: "July 2026",
    startDate: "2026-07-01",
    endDate: "2026-07-03",
    phase: "inpatient",
  }).state;
  assert.deepEqual(state.inpatientAssignments.map((item) => item.date), [
    "2026-07-01",
    "2026-07-02",
    "2026-07-03",
  ]);

  state = run(state, "assign.range", {
    rotatorRef: "Drew Quinn",
    blockRef: "July 2026",
    startDate: "2026-07-06",
    endDate: "2026-07-07",
    phase: "outpatient",
  }).state;
  assert.equal(state.outpatientSessions.length, 4);

  state = run(state, "assign.range", {
    rotatorRef: "Drew Quinn",
    blockRef: "July 2026",
    startDate: "2026-07-08",
    endDate: "2026-07-08",
    phase: "off",
  }).state;
  assert.equal(state.inpatientAssignments.some((item) => item.date === "2026-07-08" && item.role === "Off"), true);

  state = run(state, "assign.range", {
    rotatorRef: "Drew Quinn",
    blockRef: "July 2026",
    startDate: "2026-07-01",
    endDate: "2026-07-08",
    phase: "clear",
  }).state;
  assert.equal(state.inpatientAssignments.length, 0);
  assert.equal(state.outpatientSessions.length, 0);
});

test("planning mutation commands support inpatient drop and assignment chip deletes", () => {
  let state = run(stateForCommands(), "block.add", {
    name: "July 2026",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  }).state;
  state = run(state, "rotator.add", {
    fullName: "Drew Quinn",
    program: "UT Pediatrics",
    level: "PGY-2",
    segments: [{ start: "2026-07-01", end: "2026-07-31" }],
  }).state;

  let result = run(state, "inpatient.drop", {
    rotatorRef: "Drew Quinn",
    date: "2026-07-02",
    role: "Team senior",
  });
  state = result.state;
  assert.equal(result.data.role, "Team senior");
  assert.equal(state.inpatientAssignments.length, 1);
  assert.equal(state.inpatientAssignments[0].source, "Drag-Drop");
  assert.equal(state.inpatientAssignments[0].role, "Team senior");

  const blocked = executeSchedulerCommand(state, {
    type: "inpatient.drop",
    input: { rotatorRef: "Drew Quinn", date: "2027-01-01" },
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "invalid_drop");
  assert.equal(blocked.state, state);

  result = run(state, "inpatient.delete", { assignmentRef: state.inpatientAssignments[0].id });
  state = result.state;
  assert.equal(state.inpatientAssignments.length, 0);

  state = run(state, "outpatient.assign", {
    rotatorRef: "Drew Quinn",
    date: "2026-07-06",
    period: "AM",
  }).state;
  assert.equal(state.outpatientSessions.length, 1);

  result = run(state, "outpatient.delete", { sessionRef: state.outpatientSessions[0].id });
  assert.equal(result.state.outpatientSessions.length, 0);
});

test("inpatient.assign rejects invalid active-date assignments before mutation", () => {
  let state = run(stateForCommands(), "block.add", {
    name: "July 2026",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  }).state;
  state = run(state, "rotator.add", {
    fullName: "Drew Quinn",
    program: "UT Pediatrics",
    level: "PGY-2",
    segments: [{ start: "2026-07-01", end: "2026-07-31" }],
    unavailableRanges: [{ start: "2026-07-08", end: "2026-07-08", label: "Vacation" }],
  }).state;
  state = run(state, "rotator.add", {
    fullName: "Blake Lee",
    program: "UT Pediatrics",
    level: "PGY-3",
    segments: [{ start: "2026-08-01", end: "2026-08-31" }],
  }).state;

  let result = run(state, "inpatient.assign", {
    rotatorRef: "Drew Quinn",
    date: "2026-07-07",
    role: "Resident",
  });
  state = result.state;
  assert.equal(state.inpatientAssignments.length, 1);

  state = run(state, "outpatient.assign", {
    rotatorRef: "Drew Quinn",
    date: "2026-07-09",
    period: "AM",
  }).state;

  for (const [reason, input] of [
    ["outside active block", { rotatorRef: "Blake Lee", date: "2026-08-03" }],
    ["inactive on date", { rotatorRef: "Blake Lee", date: "2026-07-10" }],
    ["unavailable on date", { rotatorRef: "Drew Quinn", date: "2026-07-08" }],
    ["already outpatient on date", { rotatorRef: "Drew Quinn", date: "2026-07-09" }],
  ]) {
    const blocked = executeSchedulerCommand(state, { type: "inpatient.assign", input });
    assert.equal(blocked.ok, false, reason);
    assert.equal(blocked.changed, false, reason);
    assert.equal(blocked.error.code, "invalid_inpatient_assignment", reason);
    assert.equal(blocked.state, state, reason);
  }
});

test("outpatient.assign rejects closed or ineligible clinic dates before mutation", () => {
  let state = run(stateForCommands(), "block.add", {
    name: "July 2026",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  }).state;
  state = run(state, "block.update", {
    blockRef: "July 2026",
    patch: { holidays: [{ date: "2026-07-06", noClinic: true, label: "Clinic Closed" }] },
  }).state;
  state = run(state, "rotator.add", {
    fullName: "Drew Quinn",
    program: "UT Pediatrics",
    level: "PGY-2",
    segments: [{ start: "2026-07-01", end: "2026-07-31" }],
    unavailableRanges: [{ start: "2026-07-08", end: "2026-07-08", label: "Vacation" }],
  }).state;

  let result = run(state, "outpatient.assign", {
    rotatorRef: "Drew Quinn",
    date: "2026-07-07",
    period: "AM",
  });
  state = result.state;
  assert.equal(state.outpatientSessions.length, 1);

  for (const [date, reason] of [
    ["2026-07-04", "weekend"],
    ["2026-07-06", "no-clinic holiday"],
    ["2026-07-08", "unavailable"],
    ["2026-08-03", "outside block"],
  ]) {
    const blocked = executeSchedulerCommand(state, {
      type: "outpatient.assign",
      input: { rotatorRef: "Drew Quinn", date, period: "PM" },
    });
    assert.equal(blocked.ok, false, reason);
    assert.equal(blocked.error.code, "invalid_outpatient_assignment", reason);
    assert.equal(blocked.error.date, date, reason);
    assert.equal(blocked.state, state, reason);
  }
});

test("inpatient.fellow.resolve validates fellow pick dates atomically", () => {
  let state = run(stateForCommands(), "block.add", {
    name: "July 2026",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  }).state;
  state = run(state, "rotator.add", {
    fullName: "Sam Carter",
    program: "UT Pediatrics",
    level: "Fellow",
    role: "Fellow",
    continuityClinic: "Tuesday AM",
    segments: [{ start: "2026-07-01", end: "2026-07-31" }],
  }).state;
  state = run(state, "rotator.add", {
    fullName: "Drew Quinn",
    program: "UT Pediatrics",
    level: "PGY-2",
    segments: [{ start: "2026-07-01", end: "2026-07-31" }],
  }).state;
  const sam = resolveRotator(state, "Sam Carter");

  let result = run(state, "inpatient.fellow.resolve", {
    rotatorRef: "Sam Carter",
    dates: ["2026-07-02", "2026-07-03"],
  });
  state = result.state;
  assert.equal(result.data.rotatorId, sam.id);
  assert.deepEqual(result.data.dates, ["2026-07-02", "2026-07-03"]);
  assert.deepEqual(
    state.inpatientAssignments.map((item) => [item.date, item.rotatorId, item.role, item.source]),
    [
      ["2026-07-02", sam.id, "Fellow", "Manual"],
      ["2026-07-03", sam.id, "Fellow", "Manual"],
    ],
  );

  const nonFellow = executeSchedulerCommand(state, {
    type: "inpatient.fellow.resolve",
    input: { rotatorRef: "Drew Quinn", dates: ["2026-07-06"] },
  });
  assert.equal(nonFellow.ok, false);
  assert.equal(nonFellow.error.code, "invalid_fellow_resolution");
  assert.equal(nonFellow.state, state);

  const beforeInvalidCount = state.inpatientAssignments.length;
  const blocked = executeSchedulerCommand(state, {
    type: "inpatient.fellow.resolve",
    input: { rotatorRef: "Sam Carter", dates: ["2026-07-04", "2027-01-01"] },
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "invalid_fellow_resolution");
  assert.equal(blocked.error.date, "2027-01-01");
  assert.equal(blocked.state, state);
  assert.equal(state.inpatientAssignments.length, beforeInvalidCount);
});

test("T-SCH-CMD-006 clinic commands validate outpatient placement and delete persisted assignments", () => {
  let state = run(stateForCommands(), "block.add", {
    name: "July 2026",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  }).state;
  state = run(state, "rotator.add", {
    fullName: "Drew Quinn",
    program: "UT Pediatrics",
    level: "PGY-2",
    segments: [{ start: "2026-07-01", end: "2026-07-31" }],
  }).state;
  state = run(state, "rotator.add", {
    fullName: "Bea Student",
    program: "UT Med Student",
    level: "MS3",
    segments: [{ start: "2026-07-01", end: "2026-07-31" }],
  }).state;
  state = {
    ...state,
    attendings: [
      {
        name: "Alder",
        recurringClinics: [
          { weekday: "Monday", session: "AM", clinicName: "General Neuro", capacity: 1, allowedRoles: ["Resident"] },
          { weekday: "Monday", session: "AM", clinicName: "Epilepsy", capacity: 1 },
        ],
        oneOffDates: [],
      },
    ],
  };

  const firstOccurrence = "clinic-occurrence::alder::0-monday-AM-general-neuro::2026-07-06::AM";
  const notOutpatient = executeSchedulerCommand(state, {
    type: "clinic.assign",
    input: {
      clinicOccurrenceId: firstOccurrence,
      rotatorRef: "Drew Quinn",
      date: "2026-07-06",
      session: "AM",
    },
  });
  assert.equal(notOutpatient.ok, false);
  assert.equal(notOutpatient.error.code, "not-outpatient");
  assert.equal(notOutpatient.state, state);

  state = run(state, "assign.range", {
    rotatorRef: "Drew Quinn",
    blockRef: "July 2026",
    startDate: "2026-07-06",
    endDate: "2026-07-06",
    phase: "outpatient",
  }).state;
  state = run(state, "assign.range", {
    rotatorRef: "Bea Student",
    blockRef: "July 2026",
    startDate: "2026-07-06",
    endDate: "2026-07-06",
    phase: "outpatient",
  }).state;

  const roleDenied = executeSchedulerCommand(state, {
    type: "clinic.assign",
    input: {
      clinicOccurrenceId: firstOccurrence,
      rotatorRef: "Bea Student",
      date: "2026-07-06",
      session: "AM",
    },
  });
  assert.equal(roleDenied.ok, false);
  assert.equal(roleDenied.error.code, "role-not-allowed");
  assert.equal(roleDenied.state, state);

  let result = run(state, "clinic.assign", {
    clinicOccurrenceId: firstOccurrence,
    rotatorRef: "Drew Quinn",
    date: "2026-07-06",
    session: "AM",
  });
  state = result.state;
  assert.equal(state.clinicAssignments.length, 1);
  assert.equal(state.clinicAssignments[0].clinicOccurrenceId, firstOccurrence);

  const secondOccurrence = "clinic-occurrence::alder::1-monday-AM-epilepsy::2026-07-06::AM";
  const doubleBook = executeSchedulerCommand(state, {
    type: "clinic.assign",
    input: {
      clinicOccurrenceId: secondOccurrence,
      rotatorRef: "Drew Quinn",
      date: "2026-07-06",
      session: "AM",
    },
  });
  assert.equal(doubleBook.ok, false);
  assert.equal(doubleBook.error.code, "already-in-session");
  assert.equal(doubleBook.state, state);

  result = run(state, "clinic.delete", { assignmentRef: state.clinicAssignments[0].id });
  assert.equal(result.state.clinicAssignments.length, 0);
  assert.equal(result.state.outpatientSessions.length, 4);
});

test("T-SCH-CMD-004 reporting commands expose read-only scheduler evidence", () => {
  let state = run(stateForCommands(), "rotator.add", {
    fullName: "Drew Quinn",
    program: "UT Pediatrics",
    level: "PGY-2",
    segments: [{ start: "2026-07-01", end: "2026-07-31" }],
  }).state;
  state = run(state, "inpatient.assign", {
    rotatorRef: "Drew Quinn",
    date: "2026-07-02",
    role: "Resident",
  }).state;

  const conflicts = run(state, "conflicts.list", { date: "2026-07-02" });
  assert.deepEqual(conflicts.data.conflicts, detectConflicts(state).filter((item) => item.date === "2026-07-02"));
  assert.equal(conflicts.changed, false);

  const daily = run(state, "report.daily", { date: "2026-07-02" });
  assert.match(daily.data.report, /Daily Team Report/);
  assert.match(daily.data.report, /Resident: Drew Quinn/);

  const summary = summarizeSchedulerState(state, "test-store");
  assert.match(summary, /Scheduler state \(test-store\)/);
  assert.match(summary, /Rotators: 1/);
});

test("grid.show command returns prior/past peek metadata and effective dates", () => {
  const base = stateForCommands();
  const april = {
    id: "block-april",
    name: "April",
    startDate: "2026-04-01",
    endDate: "2026-04-30",
    status: "Draft",
    generate: {},
    holidays: [],
    coverage: {},
  };
  const may = {
    id: "block-may",
    name: "May",
    startDate: "2026-05-01",
    endDate: "2026-05-28",
    status: "Draft",
    generate: {},
    holidays: [{ date: "2026-05-25", noClinic: true, label: "Memorial Day" }],
    coverage: {},
  };
  const june = {
    id: "block-june",
    name: "June",
    startDate: "2026-05-29",
    endDate: "2026-06-25",
    status: "Draft",
    generate: {},
    holidays: [{ date: "2026-06-19", noClinic: true, label: "Juneteenth" }],
    coverage: {},
  };
  const state = {
    ...base,
    activeBlockId: may.id,
    serviceBlocks: [april, may, june],
    rotators: [],
    inpatientAssignments: [],
    outpatientSessions: [],
  };

  let result = run(state, "grid.show", { blockRef: may.id, peekPastBlock: true });
  assert.equal(result.changed, false);
  assert.equal(result.data.blockId, may.id);
  assert.equal(result.data.peekPastBlock, true);
  assert.equal(result.data.peekBeforeBlock, false);
  assert.equal(result.data.rawStartDate, "2026-05-01");
  assert.equal(result.data.rawEndDate, "2026-05-28");
  assert.equal(result.data.effectiveStartDate, "2026-05-01");
  assert.equal(result.data.effectiveEndDate, "2026-06-11");
  assert.equal(result.data.grid.dates.at(-1), "2026-06-11");

  result = run(state, "grid.show", { blockRef: may.id, peekBeforeBlock: true });
  assert.equal(result.data.peekBeforeBlock, true);
  assert.equal(result.data.peekPastBlock, false);
  assert.equal(result.data.rawStartDate, "2026-05-01");
  assert.equal(result.data.effectiveStartDate, "2026-04-17");
  assert.equal(result.data.grid.dates[0], "2026-04-17");

  result = run({ ...state, serviceBlocks: [may] }, "grid.show", {
    blockRef: may.id,
    peekBeforeBlock: true,
    peekPastBlock: true,
  });
  assert.equal(result.data.effectiveStartDate, "2026-04-17");
  assert.equal(result.data.rawEndDate, "2026-05-28");
  assert.equal(result.data.effectiveEndDate, "2026-06-11");
  assert.equal(result.data.grid.dates[0], "2026-04-17");
  assert.equal(result.data.grid.dates.at(-1), "2026-06-11");
});

test("draft.generate command runs the shared draft engine and preserves idempotency", () => {
  const block = {
    id: "b1",
    name: "Draftable",
    startDate: "2026-07-06",
    endDate: "2026-07-10",
    status: "Draft",
    generate: {},
    holidays: [],
    coverage: { weekday: { ip: { count: 1 } } },
  };
  let state = {
    ...stateForCommands(),
    activeBlockId: "b1",
    serviceBlocks: [block],
    rotators: [
      {
        id: "rot-ari",
        fullName: "Drew Quinn",
        displayName: "Drew Quinn",
        program: "Other",
        level: "PGY-2",
        role: "Resident",
        schoolType: "other",
        segments: [{ start: "2026-07-06", end: "2026-07-10" }],
        continuityClinic: "",
        dayOff: [],
        unavailableRanges: [],
      },
    ],
    inpatientAssignments: [],
    outpatientSessions: [],
  };

  let result = run(state, "draft.generate");
  state = result.state;
  assert.equal(result.data.inpatientAdded, 5);
  assert.equal(result.data.report.summary.inpatientAdded, 5);
  assert.equal(state.inpatientAssignments.filter((item) => item.source === "Auto-Draft").length, 5);

  result = run(state, "inpatient.draft");
  assert.equal(result.data.inpatientAdded, 0);
  assert.equal(result.data.outpatientAdded, 0);
});

test("methodist.auto command computes start side, fills the 14/14 schedule, and is idempotent", () => {
  const block = {
    id: "b-methodist",
    name: "Methodist July",
    startDate: "2026-07-01",
    endDate: "2026-07-28",
    status: "Draft",
    generate: {},
    holidays: [],
    coverage: { weekday: { ip: { count: 0 } } },
  };
  let state = {
    ...stateForCommands(),
    activeBlockId: block.id,
    serviceBlocks: [block],
    rotators: [
      {
        id: "rot-maya",
        fullName: "Maya Lopez",
        displayName: "Maya Lopez",
        program: "Methodist",
        level: "PGY-3",
        role: "Resident",
        schoolType: "methodist",
        rotationStartDate: "2026-07-01",
        methodistStartSide: "",
        segments: [{ start: "2026-07-01", end: "2026-07-28" }],
        continuityClinic: "",
        dayOff: [],
        unavailableRanges: [],
      },
    ],
    inpatientAssignments: [],
    outpatientSessions: [],
  };

  let result = run(state, "methodist.auto", { blockRef: block.id });
  state = result.state;
  assert.equal(result.changed, true);
  assert.equal(result.data.methodistCount, 1);
  assert.equal(result.data.startSidesSet, 1);
  assert.equal(result.data.inpatientAdded, 14);
  assert.equal(result.data.outpatientAdded, 20);
  assert.equal(resolveRotator(state, "Maya Lopez").methodistStartSide, "outpatient");
  assert.equal(state.inpatientAssignments.filter((item) => item.source === "Auto-Methodist").length, 14);
  assert.equal(state.outpatientSessions.filter((item) => item.source === "Auto-Methodist").length, 20);
  assert.ok(state.inpatientAssignments.some((item) => item.date === "2026-07-15" && item.rotatorId === "rot-maya"));
  assert.ok(state.outpatientSessions.some((item) => item.date === "2026-07-01" && item.period === "AM"));

  result = run(state, "methodist.auto", { blockRef: block.id });
  assert.equal(result.changed, false);
  assert.equal(result.data.startSidesSet, 0);
  assert.equal(result.data.inpatientAdded, 0);
  assert.equal(result.data.outpatientAdded, 0);
  assert.equal(result.message, "Methodist 14/14 schedule is already up to date.");
});

test("methodist.auto command no-ops cleanly without Methodist rotators", () => {
  const block = {
    id: "b-empty",
    name: "No Methodist",
    startDate: "2026-07-01",
    endDate: "2026-07-07",
    status: "Draft",
    generate: {},
    holidays: [],
    coverage: { weekday: { ip: { count: 0 } } },
  };
  const state = {
    ...stateForCommands(),
    activeBlockId: block.id,
    serviceBlocks: [block],
    rotators: [],
    inpatientAssignments: [],
    outpatientSessions: [],
  };

  const result = run(state, "methodist.auto", { blockRef: block.id });
  assert.equal(result.changed, false);
  assert.equal(result.state, state);
  assert.equal(result.data.methodistCount, 0);
  assert.equal(result.message, "No Methodist rotators are in the roster.");
});

test("methodist.auto command accepts flat input and honors legacy Methodist program classification", () => {
  const block = {
    id: "b-legacy-methodist",
    name: "Legacy Methodist",
    startDate: "2026-07-01",
    endDate: "2026-07-07",
    status: "Draft",
    generate: {},
    holidays: [],
    coverage: { weekday: { ip: { count: 0 } } },
  };
  const state = {
    ...stateForCommands(),
    activeBlockId: block.id,
    serviceBlocks: [block],
    rotators: [
      {
        id: "rot-legacy",
        fullName: "Legacy Methodist",
        displayName: "Legacy Methodist",
        program: "Methodist",
        level: "PGY-3",
        role: "Resident",
        rotationStartDate: "2026-07-01",
        methodistStartSide: "inpatient",
        segments: [{ start: "2026-07-01", end: "2026-07-07" }],
        continuityClinic: "",
        dayOff: [],
        unavailableRanges: [],
      },
    ],
    inpatientAssignments: [],
    outpatientSessions: [],
  };

  const result = executeSchedulerCommand(state, {
    type: "methodist.auto",
    blockId: block.id,
  });
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(result.changed, true);
  assert.equal(result.data.methodistCount, 1);
  assert.equal(result.data.startSidesSet, 0);
  // Coordinator 2026-07-10: a 7-day rotation splits in half (4 IP / 3 OP days);
  // the OP tail lands on Jul 5-7; Sunday Jul 5 holds no clinic, leaving
  // Mon-Tue x AM/PM -> 4 sessions.
  assert.equal(result.data.inpatientAdded, 4);
  assert.equal(result.data.outpatientAdded, 4);
  assert.equal(resolveRotator(result.state, "Legacy Methodist").methodistStartSide, "inpatient");
});

test("draft.generate command applies segment defaultPhase preassignments before drafting", () => {
  const block = {
    id: "b1",
    name: "Template Block",
    startDate: "2026-09-14",
    endDate: "2026-09-18",
    status: "Draft",
    generate: {},
    holidays: [{ date: "2026-09-16", noClinic: true, label: "Closed clinic" }],
    coverage: {
      weekday: { ip: { count: 0 } },
      saturday: { ip: { count: 0 } },
      sunday: { ip: { count: 0 } },
      holiday: { ip: { count: 0 } },
    },
  };
  const state = {
    ...stateForCommands(),
    activeBlockId: "b1",
    serviceBlocks: [block],
    rotators: [
      {
        id: "rot-ari",
        fullName: "Drew Quinn",
        displayName: "Drew Quinn",
        program: "Other",
        level: "PGY-2",
        role: "Resident",
        schoolType: "other",
        segments: [{ start: "2026-09-14", end: "2026-09-18", defaultPhase: "outpatient" }],
        continuityClinic: "Tuesday PM, Thursday AM",
        dayOff: [],
        unavailableRanges: [],
      },
    ],
    inpatientAssignments: [],
    outpatientSessions: [],
  };

  const result = run(state, "draft.generate");
  const preassigned = result.state.outpatientSessions.filter((item) => item.source === "Auto-Preassigned");

  assert.equal(result.data.outpatientAdded, 6);
  assert.equal(preassigned.length, 6);
  assert.equal(preassigned.some((item) => item.date === "2026-09-16"), false);
  assert.equal(preassigned.some((item) => item.date === "2026-09-15" && item.period === "PM"), false);
  assert.equal(preassigned.some((item) => item.date === "2026-09-17" && item.period === "AM"), false);
});

test("T-SCH-CMD-005 invalid commands return structured errors and preserve state", () => {
  const state = stateForCommands();

  const missing = executeSchedulerCommand(state, { type: "block.add", input: { name: "Broken" } });
  assert.equal(missing.ok, false);
  assert.equal(missing.changed, false);
  assert.equal(missing.state, state);
  assert.equal(missing.error.code, "missing_field");
  assert.equal(missing.error.field, "startDate");

  const missingRotator = executeSchedulerCommand(state, { type: "rotator.delete", input: { rotatorRef: "No One" } });
  assert.equal(missingRotator.ok, false);
  assert.equal(missingRotator.error.code, "rotator_not_found");

  const unknown = executeSchedulerCommand(state, { type: "toString" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.changed, false);
  assert.equal(unknown.state, state);
  assert.equal(unknown.error.code, "unknown_command");
  assert.equal(unknown.error.field, "type");
  assert.equal(unknown.error.value, "toString");
});

test("patch commands reject non-object or schema-invalid patch payloads", () => {
  let state = stateForCommands();
  state = run(state, "block.add", {
    name: "July 2026",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  }).state;
  state = run(state, "attending.add", { name: "Dr. Lane" }).state;

  for (const command of [
    { type: "block.update", input: { blockRef: "July 2026", patch: [] } },
    { type: "rotator.update", input: { rotatorRef: "missing", patch: "bad" } },
    { type: "rules.patch", input: { patch: "bad" } },
    { type: "attending.update", input: { name: "Dr. Lane", patch: null } },
  ]) {
    const result = executeSchedulerCommand(state, command);
    assert.equal(result.ok, false, command.type);
    assert.equal(result.error.code, "invalid_type", command.type);
    assert.equal(result.error.field, "patch", command.type);
  }

  const badPosterNotes = executeSchedulerCommand(state, {
    type: "posterSettings.patch",
    input: { patch: { notes: "Bring badge" } },
  });
  assert.equal(badPosterNotes.ok, false);
  assert.equal(badPosterNotes.error.code, "invalid_type");
  assert.equal(badPosterNotes.error.field, "notes");

  const badPosterLocation = executeSchedulerCommand(state, {
    type: "posterSettings.patch",
    input: { patch: { locations: [{ name: "Clinic", address: 42 }] } },
  });
  assert.equal(badPosterLocation.ok, false);
  assert.equal(badPosterLocation.error.code, "invalid_type");
  assert.equal(badPosterLocation.error.field, "locations");

  const emptyExpectedSource = executeSchedulerCommand(state, {
    type: "expectedSource.add",
    input: { program: "   " },
  });
  assert.equal(emptyExpectedSource.ok, false);
  assert.equal(emptyExpectedSource.error.code, "missing_field");
  assert.equal(emptyExpectedSource.error.field, "program");
});
