// Pure-computation helpers extracted from src/App.jsx during Phases
// 3.2 and 3.3 of the frontend/backend refactor. These functions take
// scheduler state (or pieces of it) and return derived view shapes —
// they're not React-coupled and can be called from either the frontend
// or the backend. Co-located tests in derived-views.test.js.

import {
  activeBlock,
  activeRotatorsOn,
  continuityClinicsForDate,
  dateRange,
  expandRotatorDatesInBlock,
  getRotator,
  getRotatorSegmentPhase,
  isPediatricNeurologyFellow,
  isRotatorUnavailable
} from "./scheduler.js";
import { outpatientDetailsForSession } from "./outpatient-details.js";

// Text patterns used by classifySession to bucket free-text outpatient
// clinic / provider strings. Order matters for first-match-wins
// classification (see classifySession).
export const STAY_TUNED_PATTERNS = ["stay tuned", "stay-tuned", "tbd", "to be decided", "tbd ", "?"];
export const CME_PATTERNS = ["cme"];
export const NO_CLINIC_PATTERNS = ["no clinic", "no-clinic", "closed"];
export const STUDENTS_OFF_PATTERNS = ["students off", "medical students off", "ms off"];
export const RESIDENTS_OFF_PATTERNS = ["residents off", "no residents"];

export function matchesAny(value, patterns) {
  const v = String(value || "").toLowerCase();
  return patterns.some((p) => v.includes(p));
}

/**
 * Classify a single outpatient session by the free-text "clinic" and
 * "provider" fields. Returns one of:
 *   "stay-tuned" | "cme" | "no-clinic" | "students-off" |
 *   "residents-off" | "scheduled"
 *
 * First-match-wins — STAY_TUNED beats CME beats NO_CLINIC, etc.
 */
export function classifySession(session) {
  const text = `${session.clinic || ""} ${session.provider || ""}`.toLowerCase();
  if (matchesAny(text, STAY_TUNED_PATTERNS)) return "stay-tuned";
  if (matchesAny(text, CME_PATTERNS)) return "cme";
  if (matchesAny(text, NO_CLINIC_PATTERNS)) return "no-clinic";
  if (matchesAny(text, STUDENTS_OFF_PATTERNS)) return "students-off";
  if (matchesAny(text, RESIDENTS_OFF_PATTERNS)) return "residents-off";
  return "scheduled";
}

/**
 * Parse a free-text clinic string to surface an optional patient count
 * ("Continuity clinic (12)" or "Continuity 12pts") and an optional
 * parenthetical location ("@South Campus"). Returns the cleaned name
 * plus the count and location when present.
 */
export function parseClinicMeta(rawClinic) {
  const out = { name: String(rawClinic || "").trim(), count: null, location: null };
  if (!out.name) return out;
  const countMatch = out.name.match(/\((\d{1,3})\s*(?:pts?|patients?)?\)|\b(\d{1,3})\s*pts?\b/i);
  if (countMatch) {
    out.count = Number(countMatch[1] || countMatch[2]);
    out.name = out.name.replace(countMatch[0], "").trim();
  }
  const locMatch = out.name.match(/@\s*([^()]+?)(?:\s*\(|$)/);
  if (locMatch) {
    out.location = locMatch[1].trim();
    out.name = out.name.replace(locMatch[0], "").trim();
  }
  const parenLoc = out.name.match(/\(([^()]+)\)\s*$/);
  if (!out.location && parenLoc && !/^\d/.test(parenLoc[1])) {
    out.location = parenLoc[1].trim();
    out.name = out.name.replace(parenLoc[0], "").trim();
  }
  out.name = out.name.replace(/\s{2,}/g, " ").trim();
  if (!out.name) out.name = "Clinic";
  return out;
}

/**
 * Group planning-grid rows into 5 completion-state sections by scanning
 * each row's cell statuses. Returns an object with five arrays sorted
 * alphabetically by rotator.displayName:
 *   - needs:        any working-day cell is "unassigned" (unassigned cells
 *                   flagged offCalendar — weekends / no-clinic holidays — are
 *                   ignored: outpatient can't land there and no individual
 *                   rotator is expected to cover them)
 *   - mixed:        has both inpatient and outpatient days (no unassigned)
 *   - fullyIp:      has inpatient days only
 *   - fullyOp:      has outpatient days only
 *   - unavailable:  never present in any cell (or all "off" — defensive)
 *
 * "both" cells count toward both ip and op. "absent" cells mark
 * the rotator as not present that day.
 */
export function groupPlanningRowsBySection(rows) {
  function classify(cells) {
    let ip = 0;
    let op = 0;
    let unassigned = 0;
    let presentAtAll = false;
    for (const cell of cells) {
      if (cell.status !== "absent") presentAtAll = true;
      if (cell.status === "inpatient") ip += 1;
      else if (cell.status === "outpatient") op += 1;
      else if (cell.status === "both") { ip += 1; op += 1; }
      // An unassigned cell on a weekend / no-clinic holiday (offCalendar) is
      // not work the rotator "needs" — outpatient can't land there and no one
      // is individually expected to cover it — so it does not gate the row
      // into "needs". Only true working-day gaps count. (#6 regression fix:
      // before weekends rendered as cells, this filtering happened upstream.)
      else if (cell.status === "unassigned" && !cell.offCalendar) unassigned += 1;
    }
    if (!presentAtAll) return "unavailable";
    if (unassigned > 0) return "needs";
    if (ip > 0 && op > 0) return "mixed";
    if (ip > 0) return "fullyIp";
    if (op > 0) return "fullyOp";
    return "unavailable";
  }
  const buckets = { needs: [], mixed: [], fullyIp: [], fullyOp: [], unavailable: [] };
  for (const row of rows) {
    const section = classify(row.cells);
    buckets[section].push(row);
  }
  const byName = (a, b) =>
    String(a.rotator.displayName || "").toLowerCase()
      .localeCompare(String(b.rotator.displayName || "").toLowerCase());
  for (const key of Object.keys(buckets)) buckets[key].sort(byName);
  return buckets;
}

/**
 * Rotators that have at least one day on service inside the given
 * block window. Built on the existing expandRotatorDatesInBlock
 * overlap test, which Coordinator's spec semantics already match — a
 * rotator with even a single overlapping day counts as "active in
 * this block" (her phone-call words: "It's only the time they're
 * available to me... they would still show up for that block").
 *
 * Pure function: never mutates state; returns a new array.
 */
export function rotatorsActiveInBlock(state, block) {
  if (!state || !block) return [];
  return (state.rotators || []).filter((rotator) => {
    const dates = expandRotatorDatesInBlock(rotator, block);
    return dates.length > 0;
  });
}

function actualPhaseForDate(ipBucket, opBucket) {
  const realIp = ipBucket.filter((item) => item && item.role !== "Off");
  const markedOff = ipBucket.some((item) => item && item.role === "Off");
  const hasOp = opBucket.length > 0;

  if (realIp.length > 0 && hasOp) return "both";
  if (realIp.length > 0) return "inpatient";
  if (hasOp) return "outpatient";
  if (markedOff) return "off";
  return null;
}

function isNextIsoDate(previous, current) {
  if (!previous || !current) return false;
  return dateRange(previous, current).length === 2;
}

/**
 * Compare a rotator's profile preference (segments[].defaultPhase) with
 * explicit planning-grid records for a block/date range. Returns compact
 * mismatch ranges for profile summaries; outpatient AM/PM details stay out of
 * this slice by design.
 *
 * Blank dates are not returned. A difference means the grid has an explicit
 * IP, OP, both, or Off record whose day-level phase differs from the profile.
 */
export function preferenceVsActualSummary(state, rotator, range) {
  const summary = { ranges: [] };
  if (!state || !rotator || !range?.startDate || !range?.endDate) return summary;

  const ipByDate = new Map();
  for (const item of state.inpatientAssignments || []) {
    if (!item || item.rotatorId !== rotator.id) continue;
    const bucket = ipByDate.get(item.date) || [];
    bucket.push(item);
    ipByDate.set(item.date, bucket);
  }

  const opByDate = new Map();
  for (const item of state.outpatientSessions || []) {
    if (!item || item.rotatorId !== rotator.id) continue;
    const bucket = opByDate.get(item.date) || [];
    bucket.push(item);
    opByDate.set(item.date, bucket);
  }

  for (const date of dateRange(range.startDate, range.endDate)) {
    const preference = getRotatorSegmentPhase(rotator, date);
    if (preference !== "inpatient" && preference !== "outpatient") continue;

    const actual = actualPhaseForDate(
      ipByDate.get(date) || [],
      opByDate.get(date) || []
    );
    if (!actual || actual === preference) continue;

    const last = summary.ranges[summary.ranges.length - 1];
    if (
      last &&
      last.rotatorId === rotator.id &&
      last.preference === preference &&
      last.actual === actual &&
      isNextIsoDate(last.endDate, date)
    ) {
      last.endDate = date;
      last.days += 1;
    } else {
      summary.ranges.push({
        rotatorId: rotator.id,
        startDate: date,
        endDate: date,
        preference,
        actual,
        days: 1
      });
    }
  }

  return summary;
}

// --- Inpatient / outpatient day-data (Phase 3.3) --------------------
// Role-classification patterns used by classifyAssignmentRole. Mutually
// exclusive; first-match-wins.

const PULLOUT_AM_ROLES = ["am clinic pull-out", "am pull-out", "am clinic pullout", "am pullout", "am clinic"];
const PULLOUT_PM_ROLES = ["pm clinic pull-out", "pm pull-out", "pm clinic pullout", "pm pullout", "pm clinic"];
const TEAM_SENIOR_ROLES = ["team senior", "senior", "team-senior"];
const FELLOW_ROLES = ["fellow"];
const ACADEMIC_HALF_DAY_ROLES = ["academic half-day", "academic half day", "half-day", "academic"];
const OFF_ROLES = ["off", "off service", "off-service"];

/**
 * Map an inpatient-assignment role (free text) to one of the canonical
 * classification buckets used by inpatientDayData. Returns "on" when
 * none of the named patterns match — the default day-on-service bucket.
 */
export function classifyAssignmentRole(role) {
  const r = String(role || "").trim().toLowerCase();
  if (PULLOUT_AM_ROLES.includes(r)) return "am-pullout";
  if (PULLOUT_PM_ROLES.includes(r)) return "pm-pullout";
  if (TEAM_SENIOR_ROLES.includes(r)) return "team-senior";
  if (FELLOW_ROLES.includes(r)) return "fellow";
  if (ACADEMIC_HALF_DAY_ROLES.includes(r)) return "academic";
  if (OFF_ROLES.includes(r)) return "off";
  return "on";
}

/**
 * Compute the inpatient calendar-day view for a single date. Returns
 * a bucketed object the UI renders directly:
 *   { on, senior, fellow, amPullout, pmPullout, academic, off,
 *     continuityPullouts, holiday, isWeekend, dayConflicts }
 *
 * Stateless / pure. `conflictsByDate` is an object keyed by ISO date
 * whose values are arrays of conflict records — pass {} when conflicts
 * aren't pre-bucketed.
 */
export function inpatientDayData(state, date, conflictsByDate) {
  const inBlock = activeRotatorsOn(state, date);

  const buckets = {
    on: [], senior: [], fellow: [], amPullout: [], pmPullout: [],
    academic: [], offFromAssignments: []
  };
  const assignedIds = new Set();
  for (const a of state.inpatientAssignments) {
    if (a.date !== date) continue;
    const rotator = getRotator(state, a.rotatorId);
    if (!rotator) continue;
    assignedIds.add(rotator.id);
    const kind = classifyAssignmentRole(a.role);
    if (kind === "am-pullout") buckets.amPullout.push({ rotator, role: a.role });
    else if (kind === "pm-pullout") buckets.pmPullout.push({ rotator, role: a.role });
    else if (kind === "team-senior") {
      buckets.senior.push(rotator);
      buckets.on.push({ rotator, role: a.role });
    } else if (kind === "fellow") buckets.fellow.push(rotator);
    else if (kind === "academic") buckets.academic.push({ rotator, role: a.role });
    else if (kind === "off") buckets.offFromAssignments.push({ rotator, reason: a.role });
    else buckets.on.push({ rotator, role: a.role });
  }

  const offEntries = [];
  for (const rotator of inBlock) {
    if (assignedIds.has(rotator.id)) continue;
    const status = isRotatorUnavailable(rotator, date);
    if (status) {
      offEntries.push({
        rotator,
        reason: status.reason === "day-off" ? `day off (${status.label})` : `off ${status.label}`
      });
    } else {
      offEntries.push({ rotator, reason: "not on service" });
    }
  }
  for (const item of buckets.offFromAssignments) {
    offEntries.push({ rotator: item.rotator, reason: item.reason || "off" });
  }

  const contClinic = continuityClinicsForDate(state, date);
  const onIds = new Set(buckets.on.map((x) => x.rotator.id));
  const continuityPullouts = {
    AM: contClinic.AM.filter((r) => onIds.has(r.id)),
    PM: contClinic.PM.filter((r) => onIds.has(r.id))
  };

  const block = activeBlock(state);
  const dow = new Date(`${date}T00:00:00`).getDay();
  const holiday = (block?.holidays || []).find((h) => h.date === date);
  const isWeekend = dow === 0 || dow === 6;

  const dayConflicts = (conflictsByDate && conflictsByDate[date]) || [];

  return {
    on: buckets.on,
    senior: buckets.senior,
    fellow: buckets.fellow,
    amPullout: buckets.amPullout,
    pmPullout: buckets.pmPullout,
    academic: buckets.academic,
    off: offEntries,
    continuityPullouts,
    holiday,
    isWeekend,
    dayConflicts
  };
}

/**
 * Compute the outpatient calendar-day view for a single date. Returns
 * a bucketed object the UI renders directly:
 *   { sessions: {AM, PM}, students, studentsAssigned, studentsUnassigned,
 *     fellows, fellowsAssigned, continuityAM, continuityPM, cmeNotes,
 *     holiday, isNoClinicHoliday, studentsOff, residentsOff, dayConflicts }
 *
 * Stateless / pure. Mirrors inpatientDayData's contract.
 */
export function outpatientDayData(state, date, conflictsByDate) {
  const inBlock = activeRotatorsOn(state, date);
  const sessions = state.outpatientSessions.filter((s) => s.date === date);

  const bySession = { AM: [], PM: [] };
  for (const s of sessions) {
    const period = s.period === "PM" ? "PM" : "AM";
    const rotator = getRotator(state, s.rotatorId);
    const details = outpatientDetailsForSession(s);
    details.forEach((detail, index) => {
      const meta = parseClinicMeta(detail.clinic);
      const status = classifySession({
        clinic: detail.clinic,
        provider: detail.attending
      });
      const id = detail.synthetic && details.length === 1
        ? s.id
        : `${s.id}::detail-${index + 1}`;
      bySession[period].push({
        id,
        sessionId: s.id,
        detailIndex: index,
        detail,
        rotator,
        provider: detail.attending,
        attending: detail.attending,
        task: detail.task,
        notes: detail.notes,
        status,
        clinicName: meta.name || detail.task || "Clinic",
        count: meta.count,
        location: meta.location
      });
    });
  }

  const sessionRotatorIds = new Set(
    sessions.map((s) => s.rotatorId).filter(Boolean)
  );

  const students = inBlock.filter((r) => r.role === "Student");
  const studentsAssigned = students.filter((r) => sessionRotatorIds.has(r.id));
  const studentsUnassigned = students.filter((r) => !sessionRotatorIds.has(r.id));

  const fellows = inBlock.filter(isPediatricNeurologyFellow);
  const fellowsAssigned = fellows.filter((r) => sessionRotatorIds.has(r.id));

  const contClinic = continuityClinicsForDate(state, date);

  const cmeNotes = [
    ...bySession.AM, ...bySession.PM
  ].filter((s) => s.status === "cme");

  const block = activeBlock(state);
  const holiday = (block?.holidays || []).find((h) => h.date === date);
  const isNoClinicHoliday = holiday && holiday.noClinic;

  const studentsOff =
    bySession.AM.some((s) => s.status === "students-off") ||
    bySession.PM.some((s) => s.status === "students-off");
  const residentsOff =
    bySession.AM.some((s) => s.status === "residents-off") ||
    bySession.PM.some((s) => s.status === "residents-off");

  const dayConflicts = (conflictsByDate && conflictsByDate[date]) || [];

  return {
    sessions: bySession,
    students,
    studentsAssigned,
    studentsUnassigned,
    fellows,
    fellowsAssigned,
    continuityAM: contClinic.AM,
    continuityPM: contClinic.PM,
    cmeNotes,
    holiday,
    isNoClinicHoliday,
    studentsOff,
    residentsOff,
    dayConflicts
  };
}
