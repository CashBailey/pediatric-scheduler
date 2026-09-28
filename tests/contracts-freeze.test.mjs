import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { schemas } from "../shared/contracts/v1/index.js";
import {
  createInitialState,
  migrateLoadedState
} from "../shared/scheduler/scheduler.js";

// Contract-freeze parity. The canonical schemas are the JS modules in
// shared/contracts/v1/. contracts/v1/*.schema.json is a GENERATED copy
// (scripts/freeze-contracts.mjs) consumed by the Python backend, which
// can't import JS. This test fails if anyone edits a JS schema without
// re-running the freeze script — i.e. it makes drift impossible to ship.
//
// If this test fails: run `node scripts/freeze-contracts.mjs` and commit
// the updated contracts/v1/ files.

const appRoot = new URL("..", import.meta.url).pathname;
const frozenDir = join(appRoot, "contracts", "v1");

function filenameForId(id) {
  return `${id.replace(/\.v1$/, "")}.schema.json`;
}

for (const schema of Object.values(schemas)) {
  test(`frozen JSON for ${schema.$id} equals the JS source`, () => {
    const filePath = join(frozenDir, filenameForId(schema.$id));
    assert.ok(
      existsSync(filePath),
      `missing frozen schema ${filePath} — run: node scripts/freeze-contracts.mjs`
    );
    const frozen = JSON.parse(readFileSync(filePath, "utf8"));
    assert.deepEqual(
      frozen,
      schema,
      `${schema.$id} drifted — run: node scripts/freeze-contracts.mjs`
    );
  });
}

test("frozen initial-state fixture matches the live domain engine", () => {
  // The Python contract test validates this fixture against the frozen
  // scheduler-state schema to prove "the freeze captured reality". That
  // claim only holds if the fixture tracks the engine — so assert it
  // equals migrateLoadedState(createInitialState()) here, where the JS
  // engine is importable. If this fails: run `node scripts/freeze-contracts.mjs`.
  const fixturePath = join(
    appRoot,
    "backend_py",
    "tests",
    "fixtures",
    "initial-state.json"
  );
  assert.ok(
    existsSync(fixturePath),
    `missing ${fixturePath} — run: node scripts/freeze-contracts.mjs`
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  // Pin the same anchor date the freeze script uses, so this comparison is
  // stable across calendar days. MUST match scripts/freeze-contracts.mjs.
  const fixtureAnchor = new Date(2026, 0, 1); // local 2026-01-01
  assert.deepEqual(
    fixture,
    migrateLoadedState(createInitialState(fixtureAnchor)),
    "initial-state fixture is stale — run: node scripts/freeze-contracts.mjs"
  );
});

test("populated-state fixture validates and survives migration unchanged", () => {
  // contracts/golden/populated-state.json is the shared cross-language
  // fixture: Python and Swift round-trip the same file. Here we prove the
  // JS side: it validates against scheduler-state.v1 and is a fixed point
  // of migrateLoadedState (loading it through the engine changes nothing).
  const fixturePath = join(appRoot, "contracts", "golden", "populated-state.json");
  assert.ok(
    existsSync(fixturePath),
    `missing ${fixturePath} — run: node scripts/freeze-contracts.mjs`
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

  // The fixture must actually exercise the drift-prone fields — an empty
  // array here would recreate the blind spot it exists to close.
  assert.ok(fixture.sources.length > 0, "fixture must contain a source record");
  assert.ok(fixture.clinicAssignments.length > 0, "fixture must contain a clinic assignment");
  assert.ok(fixture.halfDayFacts.length > 0, "fixture must contain a half-day fact");
  assert.equal(typeof fixture.sources[0].importWarningCount, "number");
  assert.ok(Array.isArray(fixture.sources[0].importWarnings));

  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const schema of Object.values(schemas)) ajv.addSchema(schema);
  const valid = ajv.validate("scheduler-state.v1", fixture);
  assert.ok(valid, `populated-state fixture failed schema: ${JSON.stringify(ajv.errors)}`);

  assert.deepEqual(
    migrateLoadedState(fixture),
    fixture,
    "populated-state fixture is not migration-stable — run: node scripts/freeze-contracts.mjs"
  );
});

test("frozen roster-import aliases match the live JS import module", async () => {
  // contracts/v1/roster-import-aliases.json is generated from
  // shared/scheduler/excel-import.js and loaded at runtime by
  // backend_py/roster_import.py, so JS↔Python alias parity holds by
  // construction — provided this freeze stays current.
  const {
    BROWSER_EXCEL_EXTENSIONS,
    COLUMN_SYNONYMS,
    ROSTER_FILE_EXTENSIONS,
    PROGRAM_ALIASES,
    WEEKDAYS,
    WEEKDAY_CANONICAL,
    MATRIX_PRESENT_MARKS,
    MATRIX_BANG_BEHAVIORS,
    DEFAULT_MATRIX_BANG_BEHAVIOR
  } = await import("../shared/scheduler/excel-import.js");
  const frozenPath = join(frozenDir, "roster-import-aliases.json");
  assert.ok(existsSync(frozenPath), `missing ${frozenPath} — run: node scripts/freeze-contracts.mjs`);
  const frozen = JSON.parse(readFileSync(frozenPath, "utf8"));

  assert.deepEqual(frozen.columnSynonyms, COLUMN_SYNONYMS, "column synonyms drifted — re-run freeze");
  assert.deepEqual(frozen.programAliases, PROGRAM_ALIASES, "program aliases drifted — re-run freeze");
  assert.deepEqual(
    frozen.weekdayAliases,
    WEEKDAY_CANONICAL.map((canonical, index) => ({ canonical, aliases: WEEKDAYS[index] })),
    "weekday aliases drifted — re-run freeze"
  );
  assert.deepEqual(frozen.matrixPresentMarks, [...MATRIX_PRESENT_MARKS]);
  assert.deepEqual(frozen.matrixBangBehaviors, MATRIX_BANG_BEHAVIORS);
  assert.equal(frozen.defaultMatrixBangBehavior, DEFAULT_MATRIX_BANG_BEHAVIOR);
  assert.deepEqual(frozen.rosterFileExtensions, ROSTER_FILE_EXTENSIONS);
  assert.deepEqual(frozen.browserExcelExtensions, BROWSER_EXCEL_EXTENSIONS);
});

test("frozen index.json lists every schema $id", () => {
  const index = JSON.parse(readFileSync(join(frozenDir, "index.json"), "utf8"));
  const indexedIds = new Set(index.schemas.map((entry) => entry.id));
  for (const schema of Object.values(schemas)) {
    assert.ok(
      indexedIds.has(schema.$id),
      `index.json is missing ${schema.$id} — run: node scripts/freeze-contracts.mjs`
    );
  }
  assert.equal(index.schemas.length, Object.values(schemas).length);
});
