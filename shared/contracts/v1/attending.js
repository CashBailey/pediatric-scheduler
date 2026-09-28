// Attending profile (canonical). Older persisted states stored
// attendings as bare strings; migrateLoadedState lifts them into this
// object shape, and createInitialState() emits it directly — so every
// code path produces schema-valid attendings.

const allowedRoles = {
  anyOf: [
    {
      type: "array",
      items: { type: "string", enum: ["Resident", "Fellow", "Student"] },
      uniqueItems: true
    },
    { type: "null" }
  ]
};

const clinicCapacity = {
  anyOf: [{ type: "integer", minimum: 0 }, { type: "string" }, { type: "null" }]
};

const recurringClinic = {
  type: "object",
  properties: {
    id: { type: "string" },
    weekday: { type: "string" },
    period: { type: "string", enum: ["AM", "PM"] },
    session: { type: "string", enum: ["AM", "PM"] },
    clinicName: { type: "string" },
    location: { type: "string" },
    capacity: clinicCapacity,
    active: { type: "boolean" },
    allowedRoles
  },
  additionalProperties: true
};

const oneOffClinic = {
  type: "object",
  properties: {
    id: { type: "string" },
    date: { type: "string", format: "date" },
    period: { type: "string", enum: ["AM", "PM"] },
    session: { type: "string", enum: ["AM", "PM"] },
    clinicName: { type: "string" },
    location: { type: "string" },
    capacity: clinicCapacity,
    allowedRoles
  },
  additionalProperties: true
};

export default {
  $id: "attending.v1",
  type: "object",
  required: ["name", "recurringClinics", "oneOffDates"],
  properties: {
    name: { type: "string" },
    recurringClinics: { type: "array", items: recurringClinic },
    oneOffDates: { type: "array", items: oneOffClinic }
  },
  additionalProperties: false
};
