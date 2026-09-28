// Clinic-stage selectors (2026-05-28 redesign, plan §3 & §6).
//
// Clinic SESSIONS are not persisted — they are generated on demand from the
// attending clinic configuration (recurring weekday patterns + one-off dates)
// via expandClinicOccurrences. Clinic ASSIGNMENTS (a rotator placed into a
// concrete occurrence) live in state.clinicAssignments.
//
// Backward compatibility:
//  - Attending slots may be the legacy shape {weekday|date, period} or the
//    richer {session, clinicName, location, capacity, active, id}. `session`
//    and `period` are aliases; capacity blank means unlimited (null).
//  - Legacy outpatientSessions that already named a real clinic are synthesized
//    into read-only "legacy" occurrences + assignments (migration-critic B4 /
//    plan §10) so the Clinics/Outpatient QA panels are correct on day one for
//    existing schedules — WITHOUT persisting a second source of truth.

import { weekdayName, dateRange, OP_PLACEHOLDER_CLINIC, METHODIST_OP_CLINIC } from "./scheduler.js";
import { serviceTypeForRotatorDate } from "./service-assignments.js";

export function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "x";
}

function normalizeCapacity(raw) {
  if (raw === null || raw === undefined || raw === "") return null; // unlimited
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const CLINIC_ROLE_ORDER = ["Resident", "Fellow", "Student"];
const CLINIC_ROLE_SET = new Set(CLINIC_ROLE_ORDER);

export function normalizeAllowedClinicRoles(raw) {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/\s*,\s*/)
      : [];
  const seen = new Set();
  for (const value of values) {
    const role = String(value || "").trim();
    if (CLINIC_ROLE_SET.has(role)) seen.add(role);
  }
  return CLINIC_ROLE_ORDER.filter((role) => seen.has(role));
}

function occurrenceId(attendingName, templateId, date, session) {
  return `clinic-occurrence::${slug(attendingName)}::${templateId}::${date}::${session}`;
}

// True for a legacy outpatient session that names a concrete clinic (i.e. a
// real second-stage placement), as opposed to a bare "outpatient service"
// placeholder written by range-assign / pre-assignment.
function isRealClinicName(clinic) {
  const name = String(clinic || "").trim();
  // Neither service-level OP placeholder is a real second-stage clinic placement:
  //  - OP_PLACEHOLDER_CLINIC ("Outpatient (clinic TBD)") — generic range-assign marker.
  //  - METHODIST_OP_CLINIC ("Methodist Outpatient") — the 14/14 auto-assign's OP marker,
  //    written with an EMPTY provider. Synthesizing it into a Clinics-page occurrence
  //    produced a phantom clinic card + an empty "white bar" attending (C1). The real
  //    Methodist outpatient clinic/attending is assigned separately on the Clinics page.
  return name.length > 0 && name !== OP_PLACEHOLDER_CLINIC && name !== METHODIST_OP_CLINIC;
}

/**
 * Expand the attending clinic configuration into concrete dated AM/PM clinic
 * occurrences within [startDate, endDate], plus synthesized legacy occurrences.
 * Deterministic, collision-free ids (migration-critic B3: legacy slots carry no
 * id, so the templateId embeds the slot index + clinic slug to disambiguate two
 * clinics on the same attending/weekday/session).
 */
export function expandClinicOccurrences(state, { startDate, endDate } = {}) {
  if (!state || !startDate || !endDate) return [];
  const dates = dateRange(startDate, endDate);
  if (dates.length === 0) return [];
  const datesByWeekday = new Map();
  for (const date of dates) {
    const wd = weekdayName(date);
    const list = datesByWeekday.get(wd) || [];
    list.push(date);
    datesByWeekday.set(wd, list);
  }
  const inRange = (d) => d >= startDate && d <= endDate;
  const byId = new Map();
  const add = (occ) => {
    if (!byId.has(occ.id)) byId.set(occ.id, occ);
  };

  for (const attending of state.attendings || []) {
    if (!attending) continue;
    const name = attending.name || "";
    const recurring = Array.isArray(attending.recurringClinics) ? attending.recurringClinics : [];
    recurring.forEach((slot, index) => {
      if (!slot) return;
      if (slot.active === false) return; // recurring-only active flag
      const session = slot.session ?? slot.period;
      if (!slot.weekday || !session) return;
      const clinicName = slot.clinicName ?? "";
      const templateId = slot.id ?? `${index}-${slug(slot.weekday)}-${session}-${slug(clinicName || "clinic")}`;
      for (const date of datesByWeekday.get(slot.weekday) || []) {
        add({
          id: occurrenceId(name, templateId, date, session),
          date,
          session,
          attendingName: name,
          clinicName,
          location: slot.location ?? "",
          capacity: normalizeCapacity(slot.capacity),
          allowedRoles: normalizeAllowedClinicRoles(slot.allowedRoles),
          source: "recurring",
          templateId
        });
      }
    });
    const oneOffs = Array.isArray(attending.oneOffDates) ? attending.oneOffDates : [];
    oneOffs.forEach((slot, index) => {
      if (!slot) return;
      const session = slot.session ?? slot.period;
      if (!slot.date || !session || !inRange(slot.date)) return;
      const clinicName = slot.clinicName ?? "";
      const templateId = slot.id ?? `oneoff-${index}-${session}-${slug(clinicName || "clinic")}`;
      add({
        id: occurrenceId(name, templateId, slot.date, session),
        date: slot.date,
        session,
        attendingName: name,
        clinicName,
        location: slot.location ?? "",
        capacity: normalizeCapacity(slot.capacity),
        allowedRoles: normalizeAllowedClinicRoles(slot.allowedRoles),
        source: "one-off",
        templateId
      });
    });
  }

  // Legacy synthesis (B4): real-clinic outpatient sessions → read-only occurrences.
  for (const sessionRec of state.outpatientSessions || []) {
    if (!sessionRec || !inRange(sessionRec.date)) continue;
    if (!isRealClinicName(sessionRec.clinic)) continue;
    const session = sessionRec.period;
    if (!session) continue;
    const provider = sessionRec.provider || "";
    const templateId = `legacy-${slug(sessionRec.clinic)}-${slug(provider)}`;
    add({
      id: occurrenceId(provider, templateId, sessionRec.date, session),
      date: sessionRec.date,
      session,
      attendingName: provider,
      clinicName: sessionRec.clinic,
      location: "",
      capacity: null,
      allowedRoles: [],
      source: "legacy",
      templateId
    });
  }

  return Array.from(byId.values());
}

/**
 * Effective clinic assignments = persisted state.clinicAssignments PLUS
 * synthesized legacy assignments (from real-clinic outpatient sessions). The
 * synthesized ones are read-only and never persisted; a persisted assignment
 * for the same (occurrence, rotator) wins.
 */
export function getClinicAssignments(state, { startDate, endDate } = {}) {
  const persisted = Array.isArray(state?.clinicAssignments) ? state.clinicAssignments : [];
  const inRange = (d) => (!startDate || d >= startDate) && (!endDate || d <= endDate);
  const seen = new Set(persisted.map((a) => `${a.clinicOccurrenceId}|${a.rotatorId}`));
  const out = persisted.filter((a) => inRange(a.date));

  for (const sessionRec of state?.outpatientSessions || []) {
    if (!sessionRec || !inRange(sessionRec.date)) continue;
    if (!isRealClinicName(sessionRec.clinic)) continue;
    if (!sessionRec.rotatorId || !sessionRec.period) continue;
    const provider = sessionRec.provider || "";
    const templateId = `legacy-${slug(sessionRec.clinic)}-${slug(provider)}`;
    const occId = occurrenceId(provider, templateId, sessionRec.date, sessionRec.period);
    const key = `${occId}|${sessionRec.rotatorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `legacy-clinic-${slug(sessionRec.id || key)}`,
      clinicOccurrenceId: occId,
      rotatorId: sessionRec.rotatorId,
      date: sessionRec.date,
      session: sessionRec.period,
      source: "legacy"
    });
  }
  return out;
}

/**
 * Rotators eligible to be placed into a clinic on `date`: those whose Planning
 * Grid service type is STRICTLY 'outpatient' (not 'both'/inpatient/off/absent).
 */
export function eligibleOutpatientRotatorsForDate(state, date) {
  if (!state || !date) return [];
  return (state.rotators || []).filter(
    (r) => serviceTypeForRotatorDate(state, r.id, date) === "outpatient"
  );
}
