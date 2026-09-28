#!/usr/bin/env node
// Seed helper for the Coordinator fix-map screenshot loop (meta-prompt Step Zero).
// Builds a schema-valid scheduler-state.v1 with rotators that land in EVERY
// planning section (Fully Inpatient, Fully Outpatient, Mixed, Needs Assignment)
// plus a real Methodist mixed row — so C1/C2 screenshots have meaningful data.
// POSTs to the local backend (validates + persists), then the app hydrates it.
//
//   node e2e/seed-demo-state.mjs [--port 6174]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { makeRotator } from "../shared/scheduler/scheduler.js";

function argValue(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const port = Number(argValue("--port", 6174));
const dataDir = argValue("--data-dir");
const profile = argValue("--profile", "planning-grid");

// Mon–Fri of the first block week (2026-05-04 is a Monday).
const WK1 = ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"];

const ip = (date, rotatorId, role = "Resident") => ({
  id: `in-${date}-${rotatorId}-${role}`.replaceAll(" ", "-").toLowerCase(),
  date, rotatorId, role, source: "Manual"
});
const op = (date, rotatorId, clinic, provider) => ({
  id: `out-${date}-am-${rotatorId}`.toLowerCase(),
  date, period: "AM", clinic, provider, rotatorId, status: "Scheduled"
});

const block = {
  id: "block-may-2026",
  name: "May 2026 Pediatric Neurology",
  startDate: "2026-05-04",
  endDate: "2026-05-31",
  status: "Draft",
  generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
  holidays: [{ date: "2026-05-25", label: "Memorial Day", noClinic: true }]
};

const rotators = [
  // Methodist mixed row (also the C1 phantom-clinic subject).
  makeRotator("rot-methodist-1", "Maya Lopez", "Methodist", "PGY-3", [{ start: WK1[0], end: WK1[4] }]),
  // Fully Inpatient.
  makeRotator("rot-ip-1", "Jules Nguyen", "UT Adult Neuro", "PGY-3", [{ start: WK1[0], end: WK1[4] }]),
  // Fully Outpatient.
  makeRotator("rot-utpeds-1", "Drew Quinn", "UT Pediatrics", "PGY-2", [{ start: WK1[0], end: WK1[4] }]),
  // Mixed (2 IP + 3 OP), block extended through the weekend for the A3 demo.
  makeRotator("rot-utadult-1", "Noah Patel", "UT Adult Neuro", "PGY-2", [{ start: WK1[0], end: "2026-05-10" }]),
  // Needs Assignment (in block, nothing assigned) — a fellow.
  makeRotator("rot-fellow-1", "Sam Carter", "Other", "Fellow", [{ start: "2026-05-11", end: "2026-05-15" }]),
  // A second fellow so A2's candidate slash-list is exercisable later.
  makeRotator("rot-fellow-2", "Dana Reyes", "Other", "Fellow", [{ start: "2026-05-11", end: "2026-05-15" }])
];

const inpatientAssignments = [
  ...WK1.slice(0, 4).map((d) => ip(d, "rot-methodist-1", "Team senior")), // Maya: 4 IP …
  ...WK1.map((d) => ip(d, "rot-ip-1", "Team junior")),                     // Jules: all 5 IP → Fully Inpatient
  ...WK1.slice(0, 2).map((d) => ip(d, "rot-utadult-1"))                    // Noah: 2 IP → Mixed
];
const outpatientSessions = [
  // Maya: 1 OP day labeled with the Methodist 14/14 placeholder + EMPTY provider.
  // This is exactly what applyMethodistAutoAssign emits and what reproduces C1's
  // phantom "Methodist Outpatient" clinic card + "white bar" on the Clinics page.
  op(WK1[4], "rot-methodist-1", "Methodist Outpatient", ""),
  ...WK1.map((d) => op(d, "rot-utpeds-1", "Continuity Clinic", "Alder")),        // Ari: all 5 OP → Fully Outpatient
  ...WK1.slice(2).map((d) => op(d, "rot-utadult-1", "Resident Clinic", "Birch")), // Noah: 3 OP → Mixed
  op("2026-05-09", "rot-utadult-1", "Resident Clinic", "Birch")                   // Noah: Sat OP → A3 weekend-clinic conflict
];

const planningGridState = {
  version: 2,
  activeBlockId: block.id,
  serviceBlocks: [block],
  sources: [{ id: "source-ay-roster", program: "UT Adult Neuro", fileName: "AY 2026 roster.xlsx", status: "Reviewed", importedAt: "2026-05-19" }],
  rotators,
  attendings: [
    { name: "Alder", recurringClinics: [{ weekday: "Monday", session: "AM", clinicName: "General Neuro", capacity: 2 }], oneOffDates: [] },
    { name: "Birch", recurringClinics: [{ weekday: "Wednesday", session: "PM", clinicName: "Epilepsy", capacity: 2 }], oneOffDates: [] }
  ],
  expectedSourcePrograms: [],
  inpatientAssignments,
  outpatientSessions,
  rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
  notes: []
};

const finalHandoffWeek = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];
const finalHandoffBlock = {
  id: "block-final-handoff-2026",
  name: "Final Handoff Week",
  startDate: finalHandoffWeek[0],
  endDate: finalHandoffWeek[4],
  status: "Draft",
  coverage: {
    weekday: { ip: { count: 1 } },
    saturday: { ip: { count: 0 } },
    sunday: { ip: { count: 0 } },
    holiday: { ip: { count: 0 } }
  },
  generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
  holidays: []
};

const finalHandoffState = {
  version: 2,
  activeBlockId: finalHandoffBlock.id,
  serviceBlocks: [finalHandoffBlock],
  sources: [{
    id: "source-final-handoff-roster",
    program: "UT Pediatrics",
    fileName: "Final handoff roster.csv",
    fileType: "csv",
    status: "Reviewed",
    importedAt: "2026-06-01T08:00:00.000Z",
    importedRotatorCount: 1,
    importWarningCount: 0,
    importWarnings: [],
    parsedRows: [{ fullName: "Riley Chen", program: "UT Pediatrics", level: "PGY-3" }]
  }],
  rotators: [
    makeRotator("rot-final-1", "Riley Chen", "UT Pediatrics", "PGY-3", [{ start: finalHandoffWeek[0], end: finalHandoffWeek[4] }])
  ],
  attendings: [
    { name: "Alder", recurringClinics: [{ weekday: "Monday", session: "AM", clinicName: "General Neuro", capacity: 2 }], oneOffDates: [] }
  ],
  expectedSourcePrograms: ["UT Pediatrics"],
  inpatientAssignments: finalHandoffWeek.map((d) => ip(d, "rot-final-1", "Team senior")),
  outpatientSessions: [],
  clinicAssignments: [],
  halfDayFacts: [],
  rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
  notes: []
};

const draftGenerationWeek = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"];
const draftGenerationBlock = {
  id: "block-draft-generation-2026",
  name: "Draft Generation Week",
  startDate: draftGenerationWeek[0],
  endDate: draftGenerationWeek[4],
  status: "Draft",
  coverage: { weekday: { ip: { count: 1 } } },
  generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
  holidays: []
};

const draftGenerationState = {
  version: 2,
  activeBlockId: draftGenerationBlock.id,
  serviceBlocks: [draftGenerationBlock],
  sources: [],
  rotators: [
    makeRotator("rot-draft-1", "Drew Quinn", "Other", "PGY-2", [{ start: draftGenerationWeek[0], end: draftGenerationWeek[4] }])
  ],
  attendings: [],
  expectedSourcePrograms: [],
  inpatientAssignments: [],
  outpatientSessions: [],
  clinicAssignments: [],
  halfDayFacts: [],
  rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
  notes: []
};

const methodistAutoWeek = ["2026-07-01", "2026-07-28"];
const methodistAutoBlock = {
  id: "block-methodist-auto-2026",
  name: "Methodist Auto Week",
  startDate: methodistAutoWeek[0],
  endDate: methodistAutoWeek[1],
  status: "Draft",
  coverage: { weekday: { ip: { count: 0 } } },
  generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
  holidays: []
};

const methodistAutoRotator = {
  ...makeRotator("rot-methodist-auto-1", "Maya Lopez", "Methodist", "PGY-3", [
    { start: methodistAutoWeek[0], end: methodistAutoWeek[1] }
  ]),
  role: "Resident",
  schoolType: "methodist",
  rotationStartDate: methodistAutoWeek[0],
  methodistStartSide: ""
};

const methodistAutoState = {
  version: 2,
  activeBlockId: methodistAutoBlock.id,
  serviceBlocks: [methodistAutoBlock],
  sources: [],
  rotators: [methodistAutoRotator],
  attendings: [],
  expectedSourcePrograms: [],
  inpatientAssignments: [],
  outpatientSessions: [],
  clinicAssignments: [],
  halfDayFacts: [],
  rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
  notes: []
};

const planningEditWeek = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];
const planningEditBlock = {
  id: "block-planning-edit-2026",
  name: "Planning Edit Week",
  startDate: planningEditWeek[0],
  endDate: planningEditWeek[4],
  status: "Draft",
  coverage: { weekday: { ip: { count: 1 } } },
  generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
  holidays: []
};

const planningEditState = {
  version: 2,
  activeBlockId: planningEditBlock.id,
  serviceBlocks: [planningEditBlock],
  sources: [],
  rotators: [
    makeRotator("rot-edit-1", "Noah Patel", "Other", "PGY-2", [{ start: planningEditWeek[0], end: planningEditWeek[4] }])
  ],
  attendings: [],
  expectedSourcePrograms: [],
  inpatientAssignments: [],
  outpatientSessions: [],
  clinicAssignments: [],
  halfDayFacts: [],
  rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
  notes: []
};

const sourcesImportWeek = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];
const sourcesImportBlock = {
  id: "block-source-import-2026",
  name: "Source Import Week",
  startDate: sourcesImportWeek[0],
  endDate: sourcesImportWeek[4],
  status: "Draft",
  coverage: { weekday: { ip: { count: 1 } } },
  generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
  holidays: []
};

const sourcesImportState = {
  version: 2,
  activeBlockId: sourcesImportBlock.id,
  serviceBlocks: [sourcesImportBlock],
  sources: [],
  rotators: [],
  attendings: [],
  expectedSourcePrograms: ["UT Pediatrics"],
  inpatientAssignments: [],
  outpatientSessions: [],
  clinicAssignments: [],
  halfDayFacts: [],
  rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
  notes: []
};

const rotatorsEditWeek = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
const rotatorsEditBlock = {
  id: "block-rotators-edit-2026",
  name: "Rotators Edit Week",
  startDate: rotatorsEditWeek[0],
  endDate: "2026-10-30",
  status: "Draft",
  coverage: { weekday: { ip: { count: 1 } } },
  generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
  holidays: []
};

const rotatorsEditState = {
  version: 2,
  activeBlockId: rotatorsEditBlock.id,
  serviceBlocks: [rotatorsEditBlock],
  sources: [],
  rotators: [],
  attendings: [],
  expectedSourcePrograms: [],
  inpatientAssignments: [],
  outpatientSessions: [],
  clinicAssignments: [],
  halfDayFacts: [],
  rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
  notes: []
};

const outpatientEditWeek = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const outpatientEditBlock = {
  id: "block-outpatient-edit-2026",
  name: "Outpatient Edit Week",
  startDate: outpatientEditWeek[0],
  endDate: outpatientEditWeek[4],
  status: "Draft",
  coverage: { weekday: { ip: { count: 0 } } },
  generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
  holidays: []
};

const outpatientEditState = {
  version: 2,
  activeBlockId: outpatientEditBlock.id,
  serviceBlocks: [outpatientEditBlock],
  sources: [],
  rotators: [
    makeRotator("rot-outpatient-edit-1", "Drew Quinn", "UT Pediatrics", "PGY-2", [{ start: outpatientEditWeek[0], end: outpatientEditWeek[4] }])
  ],
  attendings: [
    { name: "Alder", recurringClinics: [{ weekday: "Tuesday", session: "AM", clinicName: "Resident Clinic", capacity: 2 }], oneOffDates: [] },
    { name: "Birch", recurringClinics: [{ weekday: "Tuesday", session: "AM", clinicName: "Epilepsy Clinic", capacity: 2 }], oneOffDates: [] }
  ],
  expectedSourcePrograms: [],
  inpatientAssignments: [],
  outpatientSessions: [],
  clinicAssignments: [],
  halfDayFacts: [],
  rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
  notes: []
};

const inpatientEditWeek = ["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11"];
const inpatientEditBlock = {
  id: "block-inpatient-edit-2026",
  name: "Inpatient Edit Week",
  startDate: inpatientEditWeek[0],
  endDate: inpatientEditWeek[4],
  status: "Draft",
  coverage: { weekday: { ip: { count: 1 } } },
  generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
  holidays: []
};

const inpatientEditState = {
  version: 2,
  activeBlockId: inpatientEditBlock.id,
  serviceBlocks: [inpatientEditBlock],
  sources: [],
  rotators: [
    makeRotator("rot-inpatient-edit-1", "Jordan Lee", "UT Pediatrics", "PGY-2", [{ start: inpatientEditWeek[0], end: inpatientEditWeek[4] }])
  ],
  attendings: [],
  expectedSourcePrograms: [],
  inpatientAssignments: [],
  outpatientSessions: [],
  clinicAssignments: [],
  halfDayFacts: [],
  rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
  notes: []
};

const clinicsEditWeek = ["2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07", "2027-01-08"];
const clinicsEditBlock = {
  id: "block-clinics-edit-2027",
  name: "Clinics Edit Week",
  startDate: clinicsEditWeek[0],
  endDate: clinicsEditWeek[4],
  status: "Draft",
  coverage: { weekday: { ip: { count: 0 } } },
  generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
  holidays: []
};

const clinicsEditState = {
  version: 2,
  activeBlockId: clinicsEditBlock.id,
  serviceBlocks: [clinicsEditBlock],
  sources: [],
  rotators: [
    makeRotator("rot-clinics-edit-1", "Casey Morgan", "UT Pediatrics", "PGY-2", [{ start: clinicsEditWeek[0], end: clinicsEditWeek[4] }])
  ],
  attendings: [
    {
      name: "Alder",
      recurringClinics: [{
        id: "clinic-edit-monday-am",
        weekday: "Monday",
        session: "AM",
        clinicName: "General Neuro",
        location: "Clinic 2",
        capacity: 2,
        active: true
      }],
      oneOffDates: []
    }
  ],
  expectedSourcePrograms: [],
  inpatientAssignments: [],
  outpatientSessions: [
    op(clinicsEditWeek[0], "rot-clinics-edit-1", "Outpatient (clinic TBD)", "")
  ],
  clinicAssignments: [],
  halfDayFacts: [],
  rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
  notes: []
};

const fellowsResolveWeek = ["2027-02-01", "2027-02-02", "2027-02-03", "2027-02-04", "2027-02-05"];
const fellowsResolveBlock = {
  id: "block-fellows-resolve-2027",
  name: "Fellows Resolve Week",
  startDate: fellowsResolveWeek[0],
  endDate: fellowsResolveWeek[4],
  status: "Draft",
  coverage: { weekday: { ip: { count: 1 } } },
  generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
  holidays: []
};

const fellowsResolveState = {
  version: 2,
  activeBlockId: fellowsResolveBlock.id,
  serviceBlocks: [fellowsResolveBlock],
  sources: [],
  rotators: [
    makeRotator("rot-fellows-resolve-1", "Coordinator", "Other", "Fellow", [{ start: fellowsResolveWeek[0], end: fellowsResolveWeek[4] }]),
    makeRotator("rot-fellows-resolve-2", "Eden", "Other", "Fellow", [{ start: fellowsResolveWeek[0], end: fellowsResolveWeek[4] }])
  ],
  attendings: [],
  expectedSourcePrograms: [],
  inpatientAssignments: [],
  outpatientSessions: [],
  clinicAssignments: [],
  halfDayFacts: [],
  rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
  notes: []
};

const settingsEditWeek = ["2027-03-08", "2027-03-09", "2027-03-10", "2027-03-11", "2027-03-12"];
const settingsEditBlock = {
  id: "block-settings-edit-2027",
  name: "Settings Edit Week",
  startDate: settingsEditWeek[0],
  endDate: settingsEditWeek[4],
  status: "Draft",
  coverage: {
    weekday: { ip: { count: 1 } },
    saturday: { ip: { count: 0 } },
    sunday: { ip: { count: 0 } },
    holiday: { ip: { count: 1 } }
  },
  generate: { inpatient: true, outpatient: true, dailyReport: true, legend: true, export: true },
  holidays: []
};

const settingsEditState = {
  version: 2,
  activeBlockId: settingsEditBlock.id,
  serviceBlocks: [settingsEditBlock],
  sources: [],
  rotators: [],
  attendings: [
    { name: "Legacy Attending", recurringClinics: [], oneOffDates: [] }
  ],
  expectedSourcePrograms: ["UT Pediatrics"],
  inpatientAssignments: [],
  outpatientSessions: [],
  clinicAssignments: [],
  halfDayFacts: [],
  posterSettings: {
    programName: "Pediatric Neurology Residency",
    chief: "",
    notes: ["Existing note"],
    locations: [{ name: "Main Campus", address: "" }],
    tagline: "Thank you for all you do for our patients!"
  },
  rules: { maxConsecutiveInpatientDays: 6, honorNoClinicHolidays: true },
  notes: []
};

const stateByProfile = {
  "planning-grid": planningGridState,
  "reports-final-handoff": finalHandoffState,
  "dashboard-draft-generation": draftGenerationState,
  "methodist-auto": methodistAutoState,
  "planning-edit-undo": planningEditState,
  "sources-roster-import": sourcesImportState,
  "rotators-edit": rotatorsEditState,
  "outpatient-edit": outpatientEditState,
  "inpatient-edit": inpatientEditState,
  "clinics-edit": clinicsEditState,
  "fellows-resolve": fellowsResolveState,
  "settings-edit": settingsEditState
};
const state = stateByProfile[profile];
if (!state) {
  console.error(`Unknown seed profile "${profile}". Use one of: ${Object.keys(stateByProfile).join(", ")}`);
  process.exit(2);
}

if (dataDir) {
  const outDir = resolve(dataDir);
  mkdirSync(outDir, { recursive: true });
  const filePath = join(outDir, "scheduler-state.json");
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log(`Seeded ${profile} demo state file: ${filePath}`);
  process.exit(0);
}

const url = `http://127.0.0.1:${port}/api/scheduler/state`;
const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) });
const text = await res.text();
if (!res.ok) {
  console.error(`POST ${url} -> ${res.status}\n${text}`);
  process.exit(1);
}
console.log(`Seeded ${profile} demo state -> ${res.status}`);
