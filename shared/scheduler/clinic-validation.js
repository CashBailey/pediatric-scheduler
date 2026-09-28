// Clinic assignment validation + writers (plan §6 & §9).
//
// All clinic business rules live here in the shared domain layer (the backend
// only does structural validation). The UI calls validateClinicAssignment to
// disable invalid drops and show reasons; assignClinic/unassignClinic perform
// the actual state mutation. Legacy real-clinic assignments are visible via
// getClinicAssignments but are read-only — only state.clinicAssignments is
// written.

import { serviceTypeForRotatorDate } from "./service-assignments.js";
import {
  expandClinicOccurrences,
  getClinicAssignments,
  normalizeAllowedClinicRoles
} from "./clinic-selectors.js";

// Reason codes returned by validateClinicAssignment when ok === false.
export const CLINIC_REASONS = {
  OCCURRENCE_MISSING: "occurrence-missing",
  DATE_SESSION_MISMATCH: "date-session-mismatch",
  NOT_OUTPATIENT: "not-outpatient",
  ALREADY_IN_SESSION: "already-in-session",
  OVER_CAPACITY: "over-capacity",
  ROLE_NOT_ALLOWED: "role-not-allowed"
};

const REASON_TEXT = {
  "occurrence-missing": "That clinic session no longer exists.",
  "date-session-mismatch": "Clinic session date/period doesn't match.",
  "not-outpatient": "Rotator isn't on outpatient service that day.",
  "already-in-session": "Rotator already has a clinic in that AM/PM session.",
  "over-capacity": "That clinic session is already full.",
  "role-not-allowed": "Rotator role is not allowed for that clinic."
};

function findOccurrence(state, clinicOccurrenceId, date) {
  const occurrences = expandClinicOccurrences(state, { startDate: date, endDate: date });
  return occurrences.find((o) => o.id === clinicOccurrenceId) || null;
}

function getRotator(state, rotatorId) {
  return (state?.rotators || []).find((rotator) => rotator?.id === rotatorId) || null;
}

function roleAllowedForClinic(occurrence, rotator) {
  const allowedRoles = normalizeAllowedClinicRoles(occurrence?.allowedRoles);
  if (allowedRoles.length === 0) return true;
  return allowedRoles.includes(rotator?.role);
}

/**
 * Validate a proposed clinic assignment. Returns
 *   { ok: true } | { ok: false, reason, message }
 *
 * Rules (plan §9 clinic-level):
 *   - the occurrence must exist and match the date/session
 *   - rotator must be STRICTLY outpatient that date
 *   - rotator role must match the occurrence allowedRoles policy, when set
 *   - rotator may have at most one clinic per AM/PM session
 *   - the occurrence must not exceed capacity (when capacity is set)
 * Re-assigning a rotator to the SAME occurrence is idempotent (ok).
 */
export function validateClinicAssignment(state, { clinicOccurrenceId, rotatorId, date, session }) {
  const fail = (reason) => ({ ok: false, reason, message: REASON_TEXT[reason] });

  const occurrence = findOccurrence(state, clinicOccurrenceId, date);
  if (!occurrence) return fail(CLINIC_REASONS.OCCURRENCE_MISSING);
  if (occurrence.date !== date || occurrence.session !== session) {
    return fail(CLINIC_REASONS.DATE_SESSION_MISMATCH);
  }
  if (serviceTypeForRotatorDate(state, rotatorId, date) !== "outpatient") {
    return fail(CLINIC_REASONS.NOT_OUTPATIENT);
  }
  if (!roleAllowedForClinic(occurrence, getRotator(state, rotatorId))) {
    return fail(CLINIC_REASONS.ROLE_NOT_ALLOWED);
  }

  const dayAssignments = getClinicAssignments(state, { startDate: date, endDate: date });
  // Idempotent re-assign to the same occurrence is allowed.
  const alreadyHere = dayAssignments.some(
    (a) => a.clinicOccurrenceId === clinicOccurrenceId && a.rotatorId === rotatorId
  );
  if (!alreadyHere) {
    const sameSession = dayAssignments.some(
      (a) => a.rotatorId === rotatorId && a.session === session
    );
    if (sameSession) return fail(CLINIC_REASONS.ALREADY_IN_SESSION);

    if (occurrence.capacity !== null && occurrence.capacity !== undefined) {
      const occupants = dayAssignments.filter(
        (a) => a.clinicOccurrenceId === clinicOccurrenceId
      ).length;
      if (occupants >= occurrence.capacity) return fail(CLINIC_REASONS.OVER_CAPACITY);
    }
  }
  return { ok: true };
}

/**
 * Assign a rotator into a clinic occurrence. Returns
 *   { ok: true, state } | { ok: false, reason, message, state }
 * On invalid input the original state reference is returned unchanged.
 */
export function assignClinic(state, { clinicOccurrenceId, rotatorId, date, session, source = "manual" }) {
  const verdict = validateClinicAssignment(state, { clinicOccurrenceId, rotatorId, date, session });
  if (!verdict.ok) return { ...verdict, state };

  const existing = Array.isArray(state.clinicAssignments) ? state.clinicAssignments : [];
  // Dedupe by (occurrence, rotator) — idempotent upsert.
  const filtered = existing.filter(
    (a) => !(a.clinicOccurrenceId === clinicOccurrenceId && a.rotatorId === rotatorId)
  );
  const record = {
    id: `clinic-assign::${clinicOccurrenceId}::${rotatorId}`,
    clinicOccurrenceId,
    rotatorId,
    date,
    session,
    source: String(source || "manual")
  };
  return { ok: true, state: { ...state, clinicAssignments: [...filtered, record] } };
}

/** Remove a rotator from a clinic occurrence. Returns new state (or same on no-op). */
export function unassignClinic(state, { clinicOccurrenceId, rotatorId }) {
  const existing = Array.isArray(state.clinicAssignments) ? state.clinicAssignments : [];
  const filtered = existing.filter(
    (a) => !(a.clinicOccurrenceId === clinicOccurrenceId && a.rotatorId === rotatorId)
  );
  if (filtered.length === existing.length) return state;
  return { ...state, clinicAssignments: filtered };
}

/**
 * Detect clinic-level conflicts across a block, for the Outpatient Schedule
 * warnings panel: same rotator in two clinics in one session, over-capacity
 * occurrences, and assignments referencing a stale/deleted occurrence.
 */
export function detectClinicAssignmentConflicts(state, block) {
  if (!block?.startDate || !block?.endDate) return [];
  const range = { startDate: block.startDate, endDate: block.endDate };
  const occurrences = expandClinicOccurrences(state, range);
  const occById = new Map(occurrences.map((o) => [o.id, o]));
  const assignments = getClinicAssignments(state, range);
  const conflicts = [];

  // Same rotator, two clinics, same (date, session).
  const bySessionRotator = new Map();
  for (const a of assignments) {
    const key = `${a.date}|${a.session}|${a.rotatorId}`;
    const list = bySessionRotator.get(key) || [];
    list.push(a);
    bySessionRotator.set(key, list);
  }
  for (const [key, list] of bySessionRotator) {
    if (list.length > 1) {
      const [date, session, rotatorId] = key.split("|");
      conflicts.push({
        type: "clinic-double-book",
        severity: "Critical",
        date,
        session,
        rotatorId,
        occurrenceIds: list.map((a) => a.clinicOccurrenceId)
      });
    }
  }

  // Role policy, over-capacity, and stale-occurrence.
  const byOccurrence = new Map();
  for (const a of assignments) {
    const occurrence = occById.get(a.clinicOccurrenceId);
    if (!occurrence) {
      conflicts.push({
        type: "clinic-stale-occurrence",
        severity: "Warning",
        date: a.date,
        session: a.session,
        rotatorId: a.rotatorId,
        clinicOccurrenceId: a.clinicOccurrenceId
      });
      continue;
    }
    const rotator = getRotator(state, a.rotatorId);
    const allowedRoles = normalizeAllowedClinicRoles(occurrence.allowedRoles);
    if (allowedRoles.length > 0 && !roleAllowedForClinic(occurrence, rotator)) {
      conflicts.push({
        type: "clinic-role-mismatch",
        severity: "Warning",
        date: a.date,
        session: a.session,
        rotatorId: a.rotatorId,
        clinicOccurrenceId: a.clinicOccurrenceId,
        actualRole: rotator?.role || "",
        allowedRoles
      });
    }
    byOccurrence.set(a.clinicOccurrenceId, (byOccurrence.get(a.clinicOccurrenceId) || 0) + 1);
  }
  for (const [occId, count] of byOccurrence) {
    const occ = occById.get(occId);
    if (occ?.capacity !== null && occ?.capacity !== undefined && count > occ.capacity) {
      conflicts.push({
        type: "clinic-over-capacity",
        severity: "Warning",
        date: occ.date,
        session: occ.session,
        clinicOccurrenceId: occId,
        capacity: occ.capacity,
        assigned: count
      });
    }
  }
  return conflicts;
}
