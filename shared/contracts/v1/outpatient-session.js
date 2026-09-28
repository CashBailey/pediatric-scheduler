// A single outpatient AM or PM session. Slot identity is
// (date, rotatorId, period). Multiple sessions per (date, rotatorId)
// are valid as long as the period differs.

export default {
  $id: "outpatient-session.v1",
  type: "object",
  required: ["id", "date", "period", "rotatorId"],
  properties: {
    id: { type: "string" },
    date: { type: "string", format: "date" },
    period: { type: "string", enum: ["AM", "PM"] },
    clinic: { type: "string" },
    provider: { type: "string" },
    details: {
      type: "array",
      items: {
        type: "object",
        properties: {
          clinic: { type: "string" },
          attending: { type: "string" },
          task: { type: "string" },
          notes: { type: "string" }
        },
        additionalProperties: true
      }
    },
    rotatorId: { type: "string" },
    status: { type: "string" }
  },
  additionalProperties: true
};
