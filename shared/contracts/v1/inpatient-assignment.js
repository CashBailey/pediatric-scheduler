// A single day of inpatient coverage. Slot identity is (date, rotatorId);
// role is informational (multi-role-per-day is intentional for
// fellow/team-senior combinations).

export default {
  $id: "inpatient-assignment.v1",
  type: "object",
  required: ["id", "date", "rotatorId", "role"],
  properties: {
    id: { type: "string" },
    date: { type: "string", format: "date" },
    rotatorId: { type: "string" },
    role: { type: "string" },
    source: { type: "string" }
  },
  additionalProperties: true
};
