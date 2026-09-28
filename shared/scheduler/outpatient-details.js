function normalizeLabel(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function firstLabel(...values) {
  for (const value of values) {
    const normalized = normalizeLabel(value);
    if (normalized) return normalized;
  }
  return "";
}

export function normalizeOutpatientDetail(detail = {}) {
  const input = detail && typeof detail === "object" ? detail : {};
  return {
    clinic: firstLabel(input.clinic, input.clinicName),
    attending: firstLabel(input.attending, input.provider),
    task: firstLabel(input.task),
    notes: firstLabel(input.notes, input.note)
  };
}

export function normalizeOutpatientDetails(details) {
  if (!Array.isArray(details)) return [];
  return details
    .map((detail) => normalizeOutpatientDetail(detail))
    .filter((detail) => (
      detail.clinic ||
      detail.attending ||
      detail.task ||
      detail.notes
    ));
}

export function outpatientDetailsForSession(session = {}) {
  const normalized = normalizeOutpatientDetails(session.details);
  if (normalized.length > 0) {
    return normalized.map((detail) => ({ ...detail, synthetic: false }));
  }

  return [
    {
      ...normalizeOutpatientDetail({
        clinic: session.clinic,
        attending: session.attending ?? session.provider,
        task: session.task,
        notes: session.notes
      }),
      synthetic: true
    }
  ];
}
