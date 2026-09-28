// A single rotation block (e.g. "May 2026 block"). Drives the calendar
// window, generate-flags for derived artifacts, and holiday list.

export default {
  $id: "service-block.v1",
  type: "object",
  required: ["id", "name", "startDate", "endDate", "status", "generate", "holidays"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    startDate: { type: "string", format: "date" },
    endDate: { type: "string", format: "date" },
    status: { type: "string" },
    finalizedAt: { type: "string" },
    finalizedBy: { type: "string" },
    finalReview: {
      type: "object",
      properties: {
        reviewedAt: { type: "string" },
        criticalConflictCount: { type: "integer" },
        warningConflictCount: { type: "integer" },
        openSlots: { type: "integer" },
        missingSourcePrograms: {
          type: "array",
          items: { type: "string" }
        },
        reason: { type: "string" }
      },
      additionalProperties: true
    },
    generate: {
      type: "object",
      properties: {
        inpatient: { type: "boolean" },
        outpatient: { type: "boolean" },
        dailyReport: { type: "boolean" },
        legend: { type: "boolean" },
        export: { type: "boolean" }
      },
      additionalProperties: true
    },
    holidays: { type: "array" }
  },
  additionalProperties: true
};
