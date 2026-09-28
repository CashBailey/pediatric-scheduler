// A single row in the numbered rotator legend for a block. Numbers may
// be plain integers (resident counter) or short prefixed strings
// (e.g. "F1" for fellows) — schema accepts both shapes.

export default {
  $id: "legend-entry.v1",
  type: "object",
  required: ["number", "rotatorId", "displayLabel", "dateRange", "continuityClinic"],
  properties: {
    number: { type: ["integer", "string"] },
    rotatorId: { type: "string" },
    displayLabel: { type: "string" },
    dateRange: { type: "string" },
    continuityClinic: { type: "string" }
  },
  additionalProperties: true
};
