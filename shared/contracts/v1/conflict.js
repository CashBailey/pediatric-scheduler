// A single conflict reported by detectConflicts(state). Each conflict
// names a date, a severity, a short title, and a human-readable detail
// the UI uses to render the conflicts page and the PDF conflicts section.

export default {
  $id: "conflict.v1",
  type: "object",
  required: ["id", "severity", "date", "title", "detail"],
  properties: {
    id: { type: "string" },
    severity: { type: "string", enum: ["Critical", "Warning"] },
    type: { type: "string" },
    date: { type: "string", format: "date" },
    title: { type: "string" },
    detail: { type: "string" },
    status: { type: "string" }
  },
  additionalProperties: true
};
