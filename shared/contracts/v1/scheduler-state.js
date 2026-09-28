// Top-level Pediatric Neurology Scheduler state. This is the canonical
// shape produced by both createInitialState() and migrateLoadedState().
// Every state the frontend can POST to the persistence backend conforms
// to this contract, so saves never 400 on a shape mismatch.

export default {
  $id: "scheduler-state.v1",
  type: "object",
  required: [
    "version",
    "activeBlockId",
    "serviceBlocks",
    "rotators",
    "attendings",
    "expectedSourcePrograms",
    "inpatientAssignments",
    "outpatientSessions",
    "rules"
  ],
  properties: {
    version: { type: "integer", minimum: 1 },
    activeBlockId: { type: "string" },
    serviceBlocks: {
      type: "array",
      items: { $ref: "service-block.v1" }
    },
    // Source records are written by JS addSource()/applyImportedRoster() and
    // Python roster_import._add_source_record(); importWarningCount and
    // importWarnings are Python-only writers, so they are declared optional.
    // Only `id` is required so legacy partial records keep validating.
    sources: {
      type: "array",
      items: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
          importedAt: { type: "string" },
          status: { type: "string" },
          program: { type: "string" },
          fileName: { type: "string" },
          fileType: { type: "string" },
          content: { type: "string" },
          parsedRows: { type: "array" },
          importedRotatorCount: { type: "integer", minimum: 0 },
          importWarningCount: { type: "integer", minimum: 0 },
          importWarnings: { type: "array", items: { type: "string" } }
        },
        additionalProperties: true
      }
    },
    rotators: {
      type: "array",
      items: { $ref: "rotator.v1" }
    },
    attendings: {
      type: "array",
      items: { $ref: "attending.v1" }
    },
    expectedSourcePrograms: {
      type: "array",
      items: { type: "string" }
    },
    inpatientAssignments: {
      type: "array",
      items: { $ref: "inpatient-assignment.v1" }
    },
    outpatientSessions: {
      type: "array",
      items: { $ref: "outpatient-session.v1" }
    },
    halfDayFacts: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "date", "period", "rotatorId", "kind", "source"],
        properties: {
          id: { type: "string" },
          date: { type: "string", format: "date" },
          period: { type: "string", enum: ["AM", "PM"] },
          rotatorId: { type: "string" },
          kind: { type: "string" },
          status: { type: "string" },
          label: { type: "string" },
          source: { type: "string" },
          sourceText: { type: "string" }
        },
        additionalProperties: true
      }
    },
    rules: {
      type: "object",
      properties: {
        // `methodistOutpatientFirst` stays DECLARED here (optional, harmless)
        // for legacy states that still carry it, but is no longer emitted by
        // DEFAULT_RULES / createInitialState — it was a dead flag (removed
        // 2026-06-01). additionalProperties:true makes its presence/absence a
        // no-op for validation either way.
        methodistOutpatientFirst: { type: "boolean" },
        maxConsecutiveInpatientDays: { type: "integer", minimum: 0 },
        honorNoClinicHolidays: { type: "boolean" }
      },
      additionalProperties: true
    },
    // Clinic assignments are emitted only by the clinic.assign command with a
    // fixed shape (see shared/scheduler/commands.js); migrateLoadedState
    // backfills the array itself, so every persisted record has these keys.
    clinicAssignments: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "clinicOccurrenceId", "rotatorId", "date", "session"],
        properties: {
          id: { type: "string" },
          clinicOccurrenceId: { type: "string" },
          rotatorId: { type: "string" },
          date: { type: "string", format: "date" },
          session: { type: "string", enum: ["AM", "PM"] },
          source: { type: "string" }
        },
        additionalProperties: true
      }
    },
    // Poster settings mirror DEFAULT_POSTER_SETTINGS in
    // shared/scheduler/scheduler.js; migrateLoadedState merges defaults under
    // user edits, so no key is required here.
    posterSettings: {
      type: "object",
      properties: {
        programName: { type: "string" },
        chief: { type: "string" },
        notes: { type: "array", items: { type: "string" } },
        locations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              address: { type: "string" }
            },
            additionalProperties: true
          }
        },
        tagline: { type: "string" }
      },
      additionalProperties: true
    },
    notes: { type: "array" }
  },
  additionalProperties: true
};
