// Service-level assignment adapter (2026-05-28 workflow-stage redesign).
//
// Planning Grid owns the single source of truth for "is this rotator inpatient
// or outpatient on this day?". Today that truth lives in the legacy
// `inpatientAssignments` / `outpatientSessions` arrays. This module is a
// READ-ONLY adapter over those arrays plus thin write wrappers — it does NOT
// introduce a second persisted source of truth (see plan §10, acceptance
// criterion "no duplicate source of truth"). A future migration can persist
// `state.serviceAssignments`; until then every selector derives from legacy so
// the two can never diverge.
//
// CRITICAL (migration-critic B1): `serviceTypeForRotatorDate` must replicate
// buildPlanningGrid's exact precedence chain, NOT a re-mapping. unavailable /
// marked-off are SUPPRESSED whenever a real IP or OP record exists (that's how
// "scheduled on a day off" stays visible as a conflict). Any divergence here
// silently breaks every saved schedule.

import {
  isRotatorActiveOn,
  isRotatorUnavailable,
  dateRange,
  applyRangeAssignment
} from "./scheduler.js";

// Map a service-level intent to the legacy applyRangeAssignment phase.
const SERVICE_TO_PHASE = {
  inpatient: "inpatient",
  outpatient: "outpatient",
  off: "off",
  unassigned: "clear",
  clear: "clear"
};

/**
 * The service type for a single (rotator, date), matching buildPlanningGrid's
 * cell status exactly. Returns one of:
 *   'absent'     — rotator not active that day
 *   'off'        — unavailable (dayOff/range) or explicit role:"Off", AND no
 *                  real IP and no OP record
 *   'both'       — a real inpatient record AND an outpatient session (conflict)
 *   'inpatient'  — at least one inpatient record whose role !== "Off"
 *   'outpatient' — at least one outpatient session
 *   'unassigned' — active, available, no IP/OP record
 */
export function serviceTypeForRotatorDate(state, rotatorId, date) {
  const rotator = (state?.rotators || []).find((r) => r.id === rotatorId);
  if (!rotator) return "absent";
  if (!isRotatorActiveOn(rotator, date)) return "absent";

  const ipBucket = (state.inpatientAssignments || []).filter(
    (item) => item.date === date && item.rotatorId === rotatorId
  );
  const opBucket = (state.outpatientSessions || []).filter(
    (item) => item.date === date && item.rotatorId === rotatorId
  );
  const realIp = ipBucket.filter((item) => item.role !== "Off");
  const markedOff = ipBucket.some((item) => item.role === "Off");
  const unavailable = isRotatorUnavailable(rotator, date);

  // Ordered precedence chain — identical to buildPlanningGrid (scheduler.js).
  if (unavailable && realIp.length === 0 && opBucket.length === 0) return "off";
  if (markedOff && realIp.length === 0 && opBucket.length === 0) return "off";
  if (realIp.length > 0 && opBucket.length > 0) return "both";
  if (realIp.length > 0) return "inpatient";
  if (opBucket.length > 0) return "outpatient";
  return "unassigned";
}

/**
 * Derived service assignments for every active (rotator, date) in the given
 * block (or, when no block is passed, across all service blocks). This is the
 * adapter shape a future persisted `serviceAssignments` model would take; it is
 * derived, never stored.
 */
export function getServiceAssignments(state, block = null) {
  if (!state) return [];
  // If a real persisted model ever lands, honor it (forward-compat hook).
  if (Array.isArray(state.serviceAssignments) && state.serviceAssignments.length > 0) {
    return state.serviceAssignments;
  }
  const blocks = block ? [block] : (state.serviceBlocks || []);
  const seen = new Set();
  const out = [];
  for (const b of blocks) {
    if (!b?.startDate || !b?.endDate) continue;
    for (const date of dateRange(b.startDate, b.endDate)) {
      for (const rotator of state.rotators || []) {
        const serviceType = serviceTypeForRotatorDate(state, rotator.id, date);
        if (serviceType === "absent" || serviceType === "unassigned") continue;
        const key = `${rotator.id}|${date}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ rotatorId: rotator.id, date, serviceType });
      }
    }
  }
  return out;
}

/**
 * Set a single rotator/date to a service type. Wraps the canonical legacy
 * funnel (applyRangeAssignment) so Planning Grid behavior is unchanged.
 * Returns the same state reference on no-op.
 */
export function assignService(state, block, { rotatorId, date, serviceType, clinic, role }) {
  const phase = SERVICE_TO_PHASE[serviceType];
  if (!phase) return state;
  return applyRangeAssignment(state, block, {
    rotatorId,
    startDate: date,
    endDate: date,
    phase,
    ...(clinic !== undefined ? { clinic } : {}),
    ...(role !== undefined ? { role } : {})
  });
}

/** Set a rotator/date range to a service type. Wraps applyRangeAssignment. */
export function assignServiceRange(state, block, { rotatorId, startDate, endDate, serviceType, clinic, role }) {
  const phase = SERVICE_TO_PHASE[serviceType];
  if (!phase) return state;
  return applyRangeAssignment(state, block, {
    rotatorId,
    startDate,
    endDate,
    phase,
    ...(clinic !== undefined ? { clinic } : {}),
    ...(role !== undefined ? { role } : {})
  });
}
