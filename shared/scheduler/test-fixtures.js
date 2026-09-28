// Test-only fixtures. Never imported by production code (App.jsx, storage.js,
// scheduler.js, excelImport.js, main.jsx). Only *.test.js files import this.
// Therefore none of this ends up in the production Vite bundle.

import { makeRotator } from "./scheduler.js";

const STORAGE_VERSION = 2;

function assignment(date, rotatorId, role) {
  return {
    id: `in-${date}-${rotatorId}-${role}`.replaceAll(" ", "-").toLowerCase(),
    date,
    rotatorId,
    role,
    source: "Manual"
  };
}

function session(date, period, clinic, provider, rotatorId) {
  return {
    id: `out-${date}-${period}-${rotatorId}`.toLowerCase(),
    date,
    period,
    clinic,
    provider,
    rotatorId,
    status: "Scheduled"
  };
}

// Realistic non-trivial dataset used by tests that need concrete rotators,
// assignments, and sources to assert behavior against (conflict detection,
// continuity-clinic coverage, merge-by-name, daily report, manifest, etc.).
export function createDemoState() {
  const block = {
    id: "block-may-2026",
    name: "May 2026 Pediatric Neurology",
    startDate: "2026-05-04",
    endDate: "2026-05-31",
    status: "Draft",
    generate: {
      inpatient: true,
      outpatient: true,
      dailyReport: true,
      legend: true,
      export: true
    },
    holidays: [{ date: "2026-05-25", label: "Memorial Day", noClinic: true }]
  };

  const rotators = [
    makeRotator("rot-methodist-1", "Maya Lopez", "Methodist", "PGY-3", [
      { start: "2026-05-04", end: "2026-05-31" }
    ]),
    makeRotator("rot-utadult-1", "Noah Patel", "UT Adult Neuro", "PGY-2", [
      { start: "2026-05-04", end: "2026-05-17" }
    ]),
    makeRotator("rot-utpeds-1", "Drew Quinn", "UT Pediatrics", "PGY-2", [
      { start: "2026-05-04", end: "2026-05-31" }
    ]),
    makeRotator("rot-student-1", "Elena Ruiz", "UT Med Student", "MS-4", [
      { start: "2026-05-11", end: "2026-05-24" }
    ]),
    makeRotator("rot-fellow-1", "Sam Carter", "Other", "Fellow", [
      { start: "2026-05-04", end: "2026-05-31" }
    ])
  ];

  return {
    version: STORAGE_VERSION,
    activeBlockId: block.id,
    serviceBlocks: [block],
    sources: [
      {
        id: "source-ay-roster",
        program: "UT Adult Neuro",
        fileName: "AY 2026 roster.xlsx",
        status: "Reviewed",
        importedAt: "2026-05-19"
      }
    ],
    rotators,
    inpatientAssignments: [
      assignment("2026-05-04", "rot-methodist-1", "Team senior"),
      assignment("2026-05-05", "rot-methodist-1", "Team senior"),
      assignment("2026-05-06", "rot-utpeds-1", "Resident"),
      assignment("2026-05-11", "rot-utadult-1", "Resident"),
      assignment("2026-05-12", "rot-utpeds-1", "Resident")
    ],
    outpatientSessions: [
      session("2026-05-06", "PM", "Continuity Clinic", "Dr. Green", "rot-utpeds-1"),
      session("2026-05-08", "AM", "Resident Clinic", "Dr. Shah", "rot-methodist-1"),
      session("2026-05-11", "PM", "Continuity Clinic", "Dr. Green", "rot-utadult-1")
    ],
    rules: {
      maxConsecutiveInpatientDays: 6,
      honorNoClinicHolidays: true
    },
    notes: []
  };
}
