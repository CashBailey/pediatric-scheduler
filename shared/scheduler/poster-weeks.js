// Poster week-model selector (2026-05-28 poster feature).
//
// Transforms the block's clinic data into a per-week, Mon–Fri, AM/PM card model
// that the clinic poster renderer consumes. Pure + deterministic so the layout
// math and content are unit-testable without touching jsPDF.
//
// One "week" = a Monday-anchored group of the block's weekday dates. Weekends
// are excluded entirely (clinics are weekday-only by construction). A block that
// spans 4 weeks yields 4 week-models; the renderer puts each on its own page,
// which IS the whole-block view. A single week can be selected by index.

import { dateRange, weekdayName, getRotator } from "./scheduler.js";
import { expandClinicOccurrences, getClinicAssignments } from "./clinic-selectors.js";
import { eligibleOutpatientRotatorsForDate } from "./clinic-selectors.js";
import { categoryForClinic } from "./clinic-categories.js";

const WEEKDAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function shortMonthDay(iso) {
  const parts = String(iso || "").split("-").map(Number);
  if (parts.length !== 3) return iso || "";
  return `${parts[1]}/${parts[2]}`;
}

// ISO date of the Monday on/before the given date (UTC-safe, no Date math drift).
function mondayOf(iso) {
  const parts = String(iso).split("-").map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const dow = d.getUTCDay(); // 0 Sun … 6 Sat
  const back = (dow + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - back);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function safeRotatorName(state, rotatorId) {
  const r = getRotator(state, rotatorId);
  return r?.displayName || r?.fullName || "[Removed]";
}

/**
 * Build the per-week poster model for a block.
 * Returns an array of week objects:
 *   { weekIndex, label, startDate, endDate, days: [...], rotators: [...] }
 * where each day is { date, weekday, dow, short, AM: [card], PM: [card] }
 * and each card is
 *   { occurrenceId, clinicName, attendingName, rotatorNames, category }.
 */
export function buildPosterWeeks(state, block) {
  if (!state || !block || !block.startDate || !block.endDate) return [];
  const range = { startDate: block.startDate, endDate: block.endDate };
  const allDates = dateRange(block.startDate, block.endDate).filter((d) =>
    WEEKDAY_ORDER.includes(weekdayName(d))
  );
  if (allDates.length === 0) return [];

  const occurrences = expandClinicOccurrences(state, range);
  const assignments = getClinicAssignments(state, range);
  // occurrenceId -> [rotatorName]
  const rotatorsByOcc = new Map();
  for (const a of assignments) {
    const list = rotatorsByOcc.get(a.clinicOccurrenceId) || [];
    list.push(safeRotatorName(state, a.rotatorId));
    rotatorsByOcc.set(a.clinicOccurrenceId, list);
  }
  // date -> session -> [card]
  const cardsByDateSession = new Map();
  for (const occ of occurrences) {
    const key = `${occ.date}|${occ.session}`;
    const list = cardsByDateSession.get(key) || [];
    list.push({
      occurrenceId: occ.id,
      clinicName: occ.clinicName || "",
      attendingName: occ.attendingName || "",
      rotatorNames: (rotatorsByOcc.get(occ.id) || []).slice().sort((x, y) => x.localeCompare(y)),
      category: categoryForClinic(occ.clinicName)
    });
    cardsByDateSession.set(key, list);
  }
  const sortCards = (a, b) =>
    (a.attendingName || "").localeCompare(b.attendingName || "") ||
    (a.clinicName || "").localeCompare(b.clinicName || "");

  // Group weekday dates into Monday-anchored weeks.
  const weekMap = new Map();
  for (const date of allDates) {
    const wk = mondayOf(date);
    const list = weekMap.get(wk) || [];
    list.push(date);
    weekMap.set(wk, list);
  }
  const weekStarts = Array.from(weekMap.keys()).sort();

  return weekStarts.map((weekStart, idx) => {
    const dates = weekMap.get(weekStart).slice().sort();
    const days = dates.map((date) => {
      const wd = weekdayName(date);
      return {
        date,
        weekday: wd,
        dow: wd.slice(0, 3).toUpperCase(),
        short: shortMonthDay(date),
        AM: (cardsByDateSession.get(`${date}|AM`) || []).slice().sort(sortCards),
        PM: (cardsByDateSession.get(`${date}|PM`) || []).slice().sort(sortCards)
      };
    });
    // Outpatient rotators active anywhere in the week (union across days).
    const rotById = new Map();
    for (const date of dates) {
      for (const r of eligibleOutpatientRotatorsForDate(state, date)) {
        if (!rotById.has(r.id)) {
          rotById.set(r.id, { rotatorId: r.id, name: r.displayName || r.fullName || r.id });
        }
      }
    }
    const first = dates[0];
    const last = dates[dates.length - 1];
    const rangeLabel = `${weekdayName(first).slice(0, 3)} ${shortMonthDay(first)} – ${weekdayName(last).slice(0, 3)} ${shortMonthDay(last)}`;
    const rotators = Array.from(rotById.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({ ...r, type: "OP", rangeLabel }));

    return {
      weekIndex: idx + 1,
      label: `Week ${idx + 1}`,
      startDate: first,
      endDate: last,
      days,
      rotators
    };
  });
}
