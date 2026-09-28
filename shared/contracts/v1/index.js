// Shared contract schemas (v1). Versioned via the `v1/` path segment;
// breaking schema changes ship under v2/ etc. Each schema's `$id`
// matches its filename for Ajv resolution of $ref cross-references.
//
// SOURCE OF TRUTH: these JS modules are canonical. The frontend reads them
// directly here (tests/contracts.test.mjs compiles them with Ajv). The
// Python backend can't import JS, so scripts/freeze-contracts.mjs generates
// a byte-faithful copy at contracts/v1/*.schema.json for it. Do NOT delete
// this directory thinking the JSON is canonical — it's the generated copy;
// tests/contracts-freeze.test.mjs fails if the two drift.

import attending from "./attending.js";
import serviceBlock from "./service-block.js";
import rotator from "./rotator.js";
import inpatientAssignment from "./inpatient-assignment.js";
import outpatientSession from "./outpatient-session.js";
import schedulerState from "./scheduler-state.js";
import conflict from "./conflict.js";
import legendEntry from "./legend-entry.js";

export const schemas = {
  attending,
  serviceBlock,
  rotator,
  inpatientAssignment,
  outpatientSession,
  schedulerState,
  conflict,
  legendEntry
};

export const VERSION = "v1";

// All schemas as an array, in the order needed for Ajv `addSchema`
// (referenced schemas before referencing ones).
export const allSchemas = [
  attending,
  serviceBlock,
  rotator,
  inpatientAssignment,
  outpatientSession,
  schedulerState,
  conflict,
  legendEntry
];

export {
  attending,
  serviceBlock,
  rotator,
  inpatientAssignment,
  outpatientSession,
  schedulerState,
  conflict,
  legendEntry
};
