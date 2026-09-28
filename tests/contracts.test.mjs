// Contract-compatibility tests for shared/contracts/v1.
//
// Goal: prove that the JSON Schemas accurately describe what the
// existing scheduler.js code actually produces. If these break in a
// future change, the schema is stale (or the producer drifted) — fix
// one or the other before merging.

import assert from "node:assert/strict";
import { test } from "node:test";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {
  createInitialState,
  makeRotator,
  migrateLoadedState
} from "../shared/scheduler/scheduler.js";
import { allSchemas } from "../shared/contracts/v1/index.js";

function makeAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const schema of allSchemas) {
    ajv.addSchema(schema);
  }
  return ajv;
}

function validate(ajv, id, payload) {
  const validator = ajv.getSchema(id);
  assert.ok(validator, `no validator registered for ${id}`);
  const ok = validator(payload);
  if (!ok) {
    console.error(`Validation errors for ${id}:`, validator.errors);
  }
  return ok;
}

test("All v1 schemas compile and are reachable by $id", () => {
  const ajv = makeAjv();
  for (const schema of allSchemas) {
    assert.ok(ajv.getSchema(schema.$id), `expected validator for ${schema.$id}`);
  }
});

test("migrateLoadedState(createInitialState()) conforms to scheduler-state.v1", () => {
  const ajv = makeAjv();
  const state = migrateLoadedState(createInitialState());
  assert.equal(validate(ajv, "scheduler-state.v1", state), true);
});

// Regression guard: the first-launch path (loadSchedulerState with no
// localStorage) returns createInitialState() WITHOUT running migration,
// then the storage layer POSTs it to the backend. If raw createInitialState
// isn't schema-valid, every save 400s and data silently never persists to
// the backend volume — only to browser localStorage. This is the exact
// assertion that would have caught the bare-string `attendings` divergence.
test("createInitialState() is schema-valid WITHOUT migration (first-launch save)", () => {
  const ajv = makeAjv();
  const state = createInitialState();
  assert.equal(
    validate(ajv, "scheduler-state.v1", state),
    true,
    "raw createInitialState() must pass scheduler-state.v1 so the first-launch backend sync POST succeeds"
  );
});

test("scheduler-state.v1 rejects malformed attending (non-string name)", () => {
  const ajv = makeAjv();
  const state = migrateLoadedState(createInitialState());
  const broken = {
    ...state,
    attendings: [...state.attendings, { name: 123, recurringClinics: [], oneOffDates: [] }]
  };
  const validator = ajv.getSchema("scheduler-state.v1");
  assert.equal(validator(broken), false);
});

test("scheduler-state.v1 accepts clinic allowedRoles policy metadata", () => {
  const ajv = makeAjv();
  const state = migrateLoadedState(createInitialState());
  const withPolicy = {
    ...state,
    attendings: [{
      name: "Alder",
      recurringClinics: [{ weekday: "Monday", session: "AM", clinicName: "General Neuro", allowedRoles: ["Resident", "Fellow"] }],
      oneOffDates: [{ date: "2026-05-06", period: "PM", clinicName: "TSC", allowedRoles: [] }]
    }]
  };
  assert.equal(validate(ajv, "scheduler-state.v1", withPolicy), true);
});

test("scheduler-state.v1 rejects malformed clinic allowedRoles", () => {
  const ajv = makeAjv();
  const state = migrateLoadedState(createInitialState());
  const broken = {
    ...state,
    attendings: [{
      name: "Alder",
      recurringClinics: [{ weekday: "Monday", session: "AM", clinicName: "General Neuro", allowedRoles: ["Intern"] }],
      oneOffDates: []
    }]
  };
  const validator = ajv.getSchema("scheduler-state.v1");
  assert.equal(validator(broken), false);
});

test("scheduler-state.v1 rejects state missing required top-level field", () => {
  const ajv = makeAjv();
  const state = migrateLoadedState(createInitialState());
  const broken = { ...state };
  delete broken.serviceBlocks;
  const validator = ajv.getSchema("scheduler-state.v1");
  assert.equal(validator(broken), false);
});

test("scheduler-state.v1 accepts first-class half-day facts", () => {
  const ajv = makeAjv();
  const state = {
    ...migrateLoadedState(createInitialState()),
    halfDayFacts: [
      {
        id: "half-2026-05-01-am-r1-master-ip",
        date: "2026-05-01",
        period: "AM",
        rotatorId: "r1",
        kind: "master-service-status",
        status: "IP",
        label: "IP AM",
        source: "test"
      }
    ]
  };
  assert.equal(validate(ajv, "scheduler-state.v1", state), true);
});

test("scheduler-state.v1 rejects malformed half-day periods", () => {
  const ajv = makeAjv();
  const state = {
    ...migrateLoadedState(createInitialState()),
    halfDayFacts: [
      {
        id: "half-2026-05-01-evening-r1",
        date: "2026-05-01",
        period: "Evening",
        rotatorId: "r1",
        kind: "master-service-status",
        source: "test"
      }
    ]
  };
  const validator = ajv.getSchema("scheduler-state.v1");
  assert.equal(validator(state), false);
});

test("rotator.v1 accepts canonical makeRotator output", () => {
  const ajv = makeAjv();
  const rotator = makeRotator("r1", "Test Rotator", "Methodist", "PGY-2", [
    { start: "2026-05-01", end: "2026-05-14" }
  ]);
  assert.equal(validate(ajv, "rotator.v1", rotator), true);
});

test("rotator.v1 rejects unknown schoolType", () => {
  const ajv = makeAjv();
  const rotator = makeRotator("r1", "Test Rotator", "Methodist", "PGY-2");
  const broken = { ...rotator, schoolType: "not-a-real-school" };
  const validator = ajv.getSchema("rotator.v1");
  assert.equal(validator(broken), false);
});

test("rotator.v1 rejects role outside enum", () => {
  const ajv = makeAjv();
  const rotator = makeRotator("r1", "Test Rotator", "Methodist", "PGY-2");
  const broken = { ...rotator, role: "Intern" };
  const validator = ajv.getSchema("rotator.v1");
  assert.equal(validator(broken), false);
});

test("inpatient-assignment.v1 accepts canonical example", () => {
  const ajv = makeAjv();
  const example = {
    id: "in-2026-05-01-r1-resident",
    date: "2026-05-01",
    rotatorId: "r1",
    role: "Resident",
    source: "Manual"
  };
  assert.equal(validate(ajv, "inpatient-assignment.v1", example), true);
});

test("outpatient-session.v1 accepts canonical AM/PM examples", () => {
  const ajv = makeAjv();
  for (const period of ["AM", "PM"]) {
    const example = {
      id: `out-2026-05-01-${period.toLowerCase()}-r1`,
      date: "2026-05-01",
      period,
      clinic: "Continuity Clinic",
      provider: "Alder",
      rotatorId: "r1",
      status: "Scheduled"
    };
    assert.equal(validate(ajv, "outpatient-session.v1", example), true);
  }
});

test("outpatient-session.v1 accepts optional nested detail rows", () => {
  const ajv = makeAjv();
  const example = {
    id: "out-2026-05-01-am-r1",
    date: "2026-05-01",
    period: "AM",
    clinic: "Outpatient (clinic TBD)",
    provider: "",
    rotatorId: "r1",
    status: "Scheduled",
    details: [
      { clinic: "Resident Continuity", attending: "Alder", task: "new patients", notes: "Room 4" },
      { task: "Inbox follow-up" }
    ]
  };
  assert.equal(validate(ajv, "outpatient-session.v1", example), true);
});

test("outpatient-session.v1 rejects malformed nested details", () => {
  const ajv = makeAjv();
  const broken = {
    id: "out-2026-05-01-am-r1",
    date: "2026-05-01",
    period: "AM",
    rotatorId: "r1",
    details: "Resident Continuity"
  };
  const validator = ajv.getSchema("outpatient-session.v1");
  assert.equal(validator(broken), false);
});

test("outpatient-session.v1 rejects period outside AM/PM", () => {
  const ajv = makeAjv();
  const broken = {
    id: "out-2026-05-01-eve-r1",
    date: "2026-05-01",
    period: "Evening",
    rotatorId: "r1"
  };
  const validator = ajv.getSchema("outpatient-session.v1");
  assert.equal(validator(broken), false);
});

test("service-block.v1 accepts canonical block from createInitialState", () => {
  const ajv = makeAjv();
  const state = createInitialState();
  const block = state.serviceBlocks[0];
  assert.equal(validate(ajv, "service-block.v1", block), true);
});

test("service-block.v1 rejects malformed dates", () => {
  const ajv = makeAjv();
  const state = createInitialState();
  const broken = { ...state.serviceBlocks[0], startDate: "not-a-date" };
  const validator = ajv.getSchema("service-block.v1");
  assert.equal(validator(broken), false);
});

test("conflict.v1 accepts canonical example", () => {
  const ajv = makeAjv();
  const example = {
    id: "conflict-double-2026-05-01-r1",
    severity: "Critical",
    type: "double-booked",
    date: "2026-05-01",
    title: "X is double-booked",
    detail: "Assigned to inpatient and outpatient on the same day.",
    status: "Open"
  };
  assert.equal(validate(ajv, "conflict.v1", example), true);
});

test("conflict.v1 rejects unknown severity", () => {
  const ajv = makeAjv();
  const broken = {
    id: "x",
    severity: "Notice",
    date: "2026-05-01",
    title: "t",
    detail: "d"
  };
  const validator = ajv.getSchema("conflict.v1");
  assert.equal(validator(broken), false);
});

test("legend-entry.v1 accepts integer or string number (both shapes)", () => {
  const ajv = makeAjv();
  const validator = ajv.getSchema("legend-entry.v1");
  for (const number of [1, "F1"]) {
    const entry = {
      number,
      rotatorId: "r1",
      displayLabel: "Rotator X",
      dateRange: "May 1-5",
      continuityClinic: ""
    };
    assert.equal(validator(entry), true, `expected to accept number=${JSON.stringify(number)}`);
  }
});
