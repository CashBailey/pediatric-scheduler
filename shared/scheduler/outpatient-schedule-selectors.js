// Outpatient Schedule final-view selectors (plan §8).
//
// The Outpatient Schedule is the polished, READ-ONLY final output. It combines
// three inputs, all derived (no new source of truth):
//   - Planning Grid outpatient service days (serviceTypeForRotatorDate)
//   - clinic occurrences generated from Configuration (expandClinicOccurrences)
//   - clinic assignments from the Clinics tab + synthesized legacy ones
//     (getClinicAssignments)
// Drag/drop stays in Clinics — nothing here mutates state.

import { dateRange, getRotator } from "./scheduler.js";
import { serviceTypeForRotatorDate } from "./service-assignments.js";
import {
  expandClinicOccurrences,
  getClinicAssignments
} from "./clinic-selectors.js";
import { detectClinicAssignmentConflicts } from "./clinic-validation.js";

const SESSIONS = ["AM", "PM"];

function rotatorName(state, rotatorId) {
  const r = getRotator(state, rotatorId);
  return r?.displayName ?? r?.fullName ?? rotatorId;
}

function blockRange(block) {
  if (!block?.startDate || !block?.endDate) return null;
  return { startDate: block.startDate, endDate: block.endDate };
}

/** All outpatient-service dates per rotator within the block. */
export function outpatientServiceDates(state, block) {
  const range = blockRange(block);
  if (!range) return new Map();
  const map = new Map(); // rotatorId -> Set(date)
  for (const date of dateRange(range.startDate, range.endDate)) {
    for (const rotator of state.rotators || []) {
      if (serviceTypeForRotatorDate(state, rotator.id, date) === "outpatient") {
        const set = map.get(rotator.id) || new Set();
        set.add(date);
        map.set(rotator.id, set);
      }
    }
  }
  return map;
}

/** Clinic coverage: every occurrence with its assigned rotators. */
export function clinicCoverageByOccurrence(state, block) {
  const range = blockRange(block);
  if (!range) return [];
  const occurrences = expandClinicOccurrences(state, range);
  const assignments = getClinicAssignments(state, range);
  const byOcc = new Map();
  for (const a of assignments) {
    const list = byOcc.get(a.clinicOccurrenceId) || [];
    list.push(a);
    byOcc.set(a.clinicOccurrenceId, list);
  }
  return occurrences.map((occ) => ({
    occurrence: occ,
    rotators: (byOcc.get(occ.id) || []).map((a) => ({
      rotatorId: a.rotatorId,
      name: rotatorName(state, a.rotatorId),
      source: a.source
    }))
  }));
}

/** Occurrences with zero assigned rotators (uncovered clinics). */
export function uncoveredClinicOccurrences(state, block) {
  return clinicCoverageByOccurrence(state, block)
    .filter((c) => c.rotators.length === 0)
    .map((c) => c.occurrence);
}

/**
 * Outpatient rotators who are outpatient on a date but have no clinic
 * assignment that date. Returned per date (sorted).
 */
export function unassignedOutpatientRotatorsByDate(state, block) {
  const range = blockRange(block);
  if (!range) return [];
  const assignments = getClinicAssignments(state, range);
  const assignedByDate = new Map(); // date -> Set(rotatorId)
  for (const a of assignments) {
    const set = assignedByDate.get(a.date) || new Set();
    set.add(a.rotatorId);
    assignedByDate.set(a.date, set);
  }
  const out = [];
  for (const date of dateRange(range.startDate, range.endDate)) {
    const assigned = assignedByDate.get(date) || new Set();
    const rotators = (state.rotators || [])
      .filter((r) => serviceTypeForRotatorDate(state, r.id, date) === "outpatient" && !assigned.has(r.id))
      .map((r) => ({ rotatorId: r.id, name: rotatorName(state, r.id) }));
    if (rotators.length > 0) out.push({ date, rotators });
  }
  return out;
}

/** Final itinerary grouped by rotator: where each outpatient person goes. */
export function outpatientItineraryByRotator(state, block) {
  const range = blockRange(block);
  if (!range) return [];
  const serviceDates = outpatientServiceDates(state, block);
  const occById = new Map(expandClinicOccurrences(state, range).map((o) => [o.id, o]));
  const assignments = getClinicAssignments(state, range);
  const assignsByRotator = new Map();
  for (const a of assignments) {
    const list = assignsByRotator.get(a.rotatorId) || [];
    list.push(a);
    assignsByRotator.set(a.rotatorId, list);
  }

  const rotatorIds = new Set([...serviceDates.keys(), ...assignsByRotator.keys()]);
  const out = [];
  for (const rotatorId of rotatorIds) {
    const stops = (assignsByRotator.get(rotatorId) || [])
      .map((a) => {
        const occ = occById.get(a.clinicOccurrenceId);
        return {
          date: a.date,
          session: a.session,
          clinicName: occ?.clinicName || "",
          attendingName: occ?.attendingName || "",
          stale: !occ
        };
      })
      .sort((x, y) => (x.date === y.date ? x.session.localeCompare(y.session) : x.date.localeCompare(y.date)));
    const serviceDayCount = (serviceDates.get(rotatorId) || new Set()).size;
    out.push({ rotatorId, name: rotatorName(state, rotatorId), serviceDayCount, stops });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Final view grouped by date → session → occurrence. */
export function outpatientScheduleByDateSession(state, block) {
  const coverage = clinicCoverageByOccurrence(state, block);
  const byDate = new Map();
  for (const entry of coverage) {
    const { date, session } = entry.occurrence;
    const key = date;
    const day = byDate.get(key) || { date, AM: [], PM: [] };
    if (SESSIONS.includes(session)) day[session].push(entry);
    byDate.set(key, day);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Clinic-level conflicts for the warnings panel. */
export function outpatientScheduleConflicts(state, block) {
  return detectClinicAssignmentConflicts(state, block);
}

/** One aggregate the Outpatient Schedule page consumes. */
export function buildOutpatientScheduleView(state, block) {
  return {
    byDateSession: outpatientScheduleByDateSession(state, block),
    byRotator: outpatientItineraryByRotator(state, block),
    unassigned: unassignedOutpatientRotatorsByDate(state, block),
    uncovered: uncoveredClinicOccurrences(state, block),
    conflicts: outpatientScheduleConflicts(state, block)
  };
}
