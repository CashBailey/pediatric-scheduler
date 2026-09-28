// Freeze the canonical v1 contract schemas (authored in JS at
// shared/contracts/v1/*.js) into language-neutral JSON Schema files at
// contracts/v1/*.schema.json.
//
// WHY THIS EXISTS
// The JS modules remain the single source of truth — Ajv on both the
// frontend and the Node backend loads them directly. The Python backend
// (backend_py/) cannot import JS, so it needs a language-neutral copy.
// Rather than hand-maintain a second set (which drifts), we GENERATE the
// JSON from the JS so the two are byte-faithful by construction. The
// $id / $ref strings are preserved verbatim ("scheduler-state.v1",
// "$ref": "service-block.v1", ...) so a Python registry can resolve them
// exactly the way Ajv does with strict:false.
//
// tests/contracts-freeze.test.mjs asserts the committed JSON still equals
// the JS export, so any future schema edit that forgets to re-run this
// script fails CI rather than silently drifting.
//
// Run: node scripts/freeze-contracts.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { schemas } from "../shared/contracts/v1/index.js";
import {
  createInitialState,
  migrateLoadedState
} from "../shared/scheduler/scheduler.js";
import {
  COLUMN_SYNONYMS,
  PROGRAM_ALIASES,
  WEEKDAYS as WEEKDAY_ALIAS_LISTS,
  WEEKDAY_CANONICAL,
  MATRIX_PRESENT_MARKS,
  MATRIX_BANG_BEHAVIORS,
  DEFAULT_MATRIX_BANG_BEHAVIOR,
  BROWSER_EXCEL_EXTENSIONS,
  ROSTER_FILE_EXTENSIONS
} from "../shared/scheduler/excel-import.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const outDir = join(repoRoot, "contracts", "v1");

// Derive the output filename from the schema $id by stripping the
// ".v1" version suffix: "scheduler-state.v1" -> "scheduler-state.schema.json".
function filenameForId(id) {
  const base = id.replace(/\.v1$/, "");
  return `${base}.schema.json`;
}

mkdirSync(outDir, { recursive: true });

const written = [];
for (const schema of Object.values(schemas)) {
  const filename = filenameForId(schema.$id);
  const filePath = join(outDir, filename);
  // 2-space indent + trailing newline so the file is diff-friendly and
  // the freeze test can compare parsed objects (not formatting).
  writeFileSync(filePath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  written.push({ id: schema.$id, filename });
}

// An index mapping each $id to its file, so non-JS consumers can load
// the whole registry without re-deriving filenames.
const index = {
  version: "v1",
  schemas: written.sort((a, b) => a.id.localeCompare(b.id))
};
writeFileSync(
  join(outDir, "index.json"),
  `${JSON.stringify(index, null, 2)}\n`,
  "utf8"
);

console.log(`Froze ${written.length} schemas to contracts/v1/`);
for (const { id, filename } of written) {
  console.log(`  ${id} -> ${filename}`);
}

// Also freeze a canonical initial-state fixture straight from the live
// domain engine. The Python contract tests validate THIS against the
// frozen scheduler-state schema, so it must track what the engine
// actually produces — not a hand-written snapshot. A Node test
// (tests/contracts-freeze.test.mjs) asserts the committed fixture still
// deep-equals migrateLoadedState(createInitialState()), so an engine
// change that forgets to re-run this script fails CI.
const fixtureDir = join(repoRoot, "backend_py", "tests", "fixtures");
mkdirSync(fixtureDir, { recursive: true });
// Pin a fixed anchor date so the fixture is byte-stable across calendar days
// (createInitialState derives the default block's start/end from it). MUST
// match the anchor in tests/contracts-freeze.test.mjs.
const FIXTURE_ANCHOR = new Date(2026, 0, 1); // local 2026-01-01
const initialState = migrateLoadedState(createInitialState(FIXTURE_ANCHOR));
writeFileSync(
  join(fixtureDir, "initial-state.json"),
  `${JSON.stringify(initialState, null, 2)}\n`,
  "utf8"
);
console.log("Froze initial-state fixture to backend_py/tests/fixtures/");

// Also freeze a POPULATED state fixture that exercises every top-level field
// the three languages share — including the ones the initial state leaves
// empty (sources, clinicAssignments, halfDayFacts, assignments). JS, Python,
// and Swift each round-trip this fixture in their own test suites, so
// source-record metadata drift (e.g. Python-only importWarnings) can't slip
// through the empty-array blind spot of the initial-state fixture. All values
// are deterministic — no Date.now()/random ids — so the freeze test can
// assert the committed fixture equals a regeneration.
const rotator = {
  id: "rotator-populated-1",
  fullName: "Jordan Example",
  displayName: "Jordan E.",
  program: "Pediatric Neurology",
  level: "PGY-3",
  role: "Resident",
  segments: [{ start: "2026-01-05", end: "2026-01-30", defaultPhase: "inpatient" }],
  schoolType: "ut-peds",
  continuityClinic: "Tuesday PM",
  dayOff: ["Saturday"],
  unavailableRanges: [{ start: "2026-01-19", end: "2026-01-19", label: "Holiday" }]
};
const populatedState = migrateLoadedState({
  ...initialState,
  rotators: [rotator],
  inpatientAssignments: [
    { id: "ip-populated-1", date: "2026-01-06", rotatorId: rotator.id, role: "Primary", source: "manual" }
  ],
  outpatientSessions: [
    { id: "op-populated-1", date: "2026-01-07", period: "AM", clinic: "General Clinic", provider: "Dr. Attending", rotatorId: rotator.id, status: "confirmed" }
  ],
  halfDayFacts: [
    { id: "hdf-populated-1", date: "2026-01-08", period: "PM", rotatorId: rotator.id, kind: "inpatient", status: "IP", label: "IP (PM)", source: "coordinator-master", sourceText: "IP!" }
  ],
  clinicAssignments: [
    { id: "clinic-assign::occ-1::rotator-populated-1", clinicOccurrenceId: "occ-1", rotatorId: rotator.id, date: "2026-01-13", session: "PM", source: "manual" }
  ],
  sources: [
    {
      id: "source-roster-populated-1",
      importedAt: "2026-01-05",
      status: "Reviewed",
      program: "Pediatric Neurology",
      fileName: "roster.xlsx",
      fileType: "xlsx",
      content: "",
      parsedRows: [{ fullName: "Jordan Example", program: "Pediatric Neurology" }],
      importedRotatorCount: 1,
      importWarningCount: 1,
      importWarnings: ["Row 3: missing level, defaulted to PGY-3"]
    }
  ],
  posterSettings: { ...populatedPoster() }
});
function populatedPoster() {
  return {
    programName: "Pediatric Neurology Residency",
    chief: "Dr. Chief Example",
    notes: ["Please arrive 15 minutes before clinic starts."],
    locations: [{ name: "Main Campus", address: "123 Example Way" }],
    tagline: "Thank you for all you do for our patients!"
  };
}
const goldenDir = join(repoRoot, "contracts", "golden");
mkdirSync(goldenDir, { recursive: true });
writeFileSync(
  join(goldenDir, "populated-state.json"),
  `${JSON.stringify(populatedState, null, 2)}\n`,
  "utf8"
);
console.log("Froze populated-state fixture to contracts/golden/");

// Also freeze the roster-import alias tables. The JS module
// (shared/scheduler/excel-import.js) is the single source of truth; the
// Python backend (backend_py/roster_import.py) loads this JSON at import
// time, so the two parsers can no longer drift on column synonyms, program
// aliases, weekday names, matrix marks, or supported roster extensions.
const rosterImportAliases = {
  columnSynonyms: COLUMN_SYNONYMS,
  programAliases: PROGRAM_ALIASES,
  weekdayAliases: WEEKDAY_CANONICAL.map((canonical, index) => ({
    canonical,
    aliases: WEEKDAY_ALIAS_LISTS[index]
  })),
  matrixPresentMarks: [...MATRIX_PRESENT_MARKS],
  matrixBangBehaviors: MATRIX_BANG_BEHAVIORS,
  defaultMatrixBangBehavior: DEFAULT_MATRIX_BANG_BEHAVIOR,
  // Backend roster route support; the browser Excel picker accepts the
  // xlsx/xlsm subset (CSV/JSON stay backend-only).
  rosterFileExtensions: ROSTER_FILE_EXTENSIONS,
  browserExcelExtensions: BROWSER_EXCEL_EXTENSIONS
};
writeFileSync(
  join(outDir, "roster-import-aliases.json"),
  `${JSON.stringify(rosterImportAliases, null, 2)}\n`,
  "utf8"
);
console.log("Froze roster-import aliases to contracts/v1/");
