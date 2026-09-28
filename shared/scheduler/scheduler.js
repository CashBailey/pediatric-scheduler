import { normalizeOutpatientDetails } from "./outpatient-details.js";

const STORAGE_VERSION = 2;

// Clinic-name placeholders the app writes when it auto-fills an outpatient
// session, named so the human-readable label has a single source of truth.
// IMPORTANT: these are DISPLAY-ONLY — neither outpatient detection
// (buildPlanningGrid counts OP by record presence) nor slot-identity dedupe
// (keys on date|rotator|period) reads the clinic string, so changing the text
// here is safe and cannot drift the schedule.
//   OP_PLACEHOLDER_CLINIC — generic "clinic not specified yet" placeholder from
//     applyRangeAssignment / pre-assignments. Previously the confusing
//     "Methodist Outpatient" that got stamped onto non-Methodist residents
//     (Coordinator: "why does it say Methodist outpatient?").
//   METHODIST_OP_CLINIC — the genuine label for a Methodist 14/14 outpatient
//     day (applyMethodistAutoAssign); kept meaningful, just no longer a raw
//     literal so it has one home too.
export const OP_PLACEHOLDER_CLINIC = "Outpatient (clinic TBD)";
export const METHODIST_OP_CLINIC = "Methodist Outpatient";

// Top-level workflow destinations (2026-05-28 redesign). The app is now
// separated into explicit stages: Configuration → Planning Grid (service-level
// truth) → Clinics (outpatient clinic placement) → Inpatient/Outpatient
// Schedule (read-only projections). Rotators/Attendings/Fellows are roster
// views; Reports/Settings consolidate the old Daily Report/Conflicts/Legend/
// Export and Rules/Block Setup/Sources pages respectively.
export const PAGES = [
  "Dashboard",
  "Configuration",
  "Rotators",
  "Sources",
  "Attendings",
  "Fellows",
  "Clinics",
  "Planning Grid",
  "Inpatient Schedule",
  "Outpatient Schedule",
  "Reports",
  "Settings"
];

// Default attending physicians staffing pediatric neurology clinics.
// Per Coordinator's 2026-05-20 round-4 message. Editable on the
// Configuration page.
export const DEFAULT_ATTENDINGS = [
  "Alder",
  "Birch",
  "Gum",
  "Dogwood",
  "Cedar",
  "Elm",
  "Hazel"
];

export const PROGRAMS = [
  "Methodist",
  "UT Adult Neuro",
  "UT Pediatrics",
  "UT Pediatric Neurology Fellow",
  "UT Med Student",
  "UT Psychiatry",
  "Other"
];

// Default scheduling rules. Defined once and shared by createInitialState
// (the fresh-state shape) and migrateLoadedState (which merges these UNDER
// any existing user values, so a user-set rule always wins — HLD-INV-010).
// Keep these in sync with the scheduler-state.v1 `rules` schema defaults.
export const DEFAULT_RULES = {
  // NOTE: `methodistOutpatientFirst` was removed 2026-06-01. It was a DEAD flag
  // (the Settings checkbox wrote it; nothing read it — getRotatorPhase is
  // hardcoded to the spec §9.1 outpatient-first split). Per decision D2 the
  // Methodist start-side is meant to be staffing-driven, not a static user
  // toggle, so the flag was deleted rather than wired. The staffing-driven
  // start-side lands later with the staffing-minimum rules (R10/R11).
  maxConsecutiveInpatientDays: 6,
  honorNoClinicHolidays: true
};

// Default poster metadata (2026-05-28 poster feature). These are the editable
// header/notes/locations/footer fields the clinic poster renders but the core
// data model does not own (Chief, Notes, Locations, tagline). Fellow name and
// block dates come from real data; everything here is boilerplate the user can
// edit on Settings → Poster. Merged UNDER existing values in migrateLoadedState
// so a user-edited value always wins. Keep in sync with the schema defaults.
export const DEFAULT_POSTER_SETTINGS = {
  programName: "Pediatric Neurology Residency",
  chief: "",
  notes: [
    "Please arrive 15 minutes before clinic starts.",
    "Check Epic for patient lists and clinic location details.",
    "Notify the chief of any schedule conflicts as soon as possible.",
    "This schedule is subject to change."
  ],
  locations: [
    { name: "Main Campus", address: "" }
  ],
  tagline: "Thank you for all you do for our patients!"
};

// Maps a program name (as listed in PROGRAMS) to its schoolType tag.
// Anything not in the table maps to "other". Used during migration and
// by the Excel importer so each rotator carries a stable program tag.
export function inferSchoolType(programName) {
  switch (programName) {
    case "Methodist": return "methodist";
    case "UT Adult Neuro": return "ut-adult";
    case "UT Pediatrics": return "ut-peds";
    case "UT Pediatric Neurology Fellow": return "ut-peds";
    case "UT Med Student": return "ut-student";
    case "UT Psychiatry": return "ut-psychiatry";
    default: return "other";
  }
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Normalize a segment-like input into {start,end,defaultPhase?}.
function normalizeSegment(seg) {
  if (!seg) return null;
  const start = seg.start || "";
  const end = seg.end || "";
  if (!start || !end) return null;
  const normalized = { start, end };
  if (seg.defaultPhase === "outpatient" || seg.defaultPhase === "inpatient") {
    normalized.defaultPhase = seg.defaultPhase;
  }
  return normalized;
}

// Normalize a segments-like input into a clean array of {start,end,defaultPhase?}.
// Drops empty entries and entries that have only one of start/end.
function normalizeSegments(segments) {
  if (!Array.isArray(segments)) return [];
  const out = [];
  for (const seg of segments) {
    const normalized = normalizeSegment(seg);
    if (normalized) out.push(normalized);
  }
  return out;
}

function normalizeDayOff(value) {
  if (!Array.isArray(value)) return [];
  const requested = new Set(value.filter((day) => WEEKDAYS.includes(day)));
  return WEEKDAYS.filter((day) => requested.has(day));
}

function normalizeUnavailableRanges(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const range of value) {
    if (!range || typeof range !== "object") continue;
    const { start, end } = range;
    if (!isIsoDate(start) || !isIsoDate(end) || end < start) continue;
    const normalized = { start, end };
    if (typeof range.label === "string" && range.label.trim()) {
      normalized.label = range.label.trim();
    }
    out.push(normalized);
  }
  return out;
}

function normalizeRotationStartDate(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return isIsoDate(trimmed) ? trimmed : "";
}

function normalizeMethodistStartSide(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "inpatient" || normalized === "outpatient" ? normalized : "";
}

function normalizeRotatorPatch(patch = {}) {
  const normalized = { ...patch };
  if ("dayOff" in normalized) normalized.dayOff = normalizeDayOff(normalized.dayOff);
  if ("unavailableRanges" in normalized) {
    normalized.unavailableRanges = normalizeUnavailableRanges(normalized.unavailableRanges);
  }
  if ("rotationStartDate" in normalized) {
    normalized.rotationStartDate = normalizeRotationStartDate(normalized.rotationStartDate);
  }
  if ("methodistStartSide" in normalized) {
    normalized.methodistStartSide = normalizeMethodistStartSide(normalized.methodistStartSide);
  }
  return normalized;
}

export function createInitialState(today = new Date()) {
  // `today` defaults to the real current date in the app; the fixture-freeze
  // script and its test pass a fixed date so the generated state is stable
  // across calendar days (the default block's start/end derive from it).
  const fourWeeksOut = new Date(today);
  fourWeeksOut.setDate(today.getDate() + 27);
  // Format from local Y-M-D rather than `toISOString()`. `toISOString` would
  // shift the date to UTC and could land on the wrong calendar day for a
  // user east of UTC creating a block late local-evening.
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const block = {
    id: "block-new",
    name: "New rotation block",
    startDate: iso(today),
    endDate: iso(fourWeeksOut),
    status: "Draft",
    generate: {
      inpatient: true,
      outpatient: true,
      dailyReport: true,
      legend: true,
      export: true
    },
    holidays: []
  };

  return {
    version: STORAGE_VERSION,
    activeBlockId: block.id,
    serviceBlocks: [block],
    sources: [],
    rotators: [],
    // Canonical profile-object shape — same as migrateLoadedState emits.
    // Must match attending.v1 so the backend persistence POST validates;
    // a bare-string form would 400 on save and silently lose data.
    attendings: DEFAULT_ATTENDINGS.map((name) => ({
      name,
      recurringClinics: [],
      oneOffDates: []
    })),
    expectedSourcePrograms: [...PROGRAMS],
    inpatientAssignments: [],
    outpatientSessions: [],
    // First-class AM/PM schedule facts imported from source schedules.
    // Whole-day inpatient/outpatient arrays remain the compatibility views.
    halfDayFacts: [],
    // Clinic-stage placements (2026-05-28 redesign). Additive: legacy states
    // without this field are backfilled in migrateLoadedState. Planning Grid
    // service truth stays in inpatientAssignments/outpatientSessions.
    clinicAssignments: [],
    // Editable poster metadata (2026-05-28 poster feature). Additive: legacy
    // states without this field are backfilled in migrateLoadedState.
    posterSettings: { ...DEFAULT_POSTER_SETTINGS },
    rules: { ...DEFAULT_RULES },
    notes: []
  };
}

// Build a rotator record. `segments` must be an array of {start,end}.
// Use an empty array if the rotator is being created without dates yet.
// The `schoolType` tag is inferred from the program name.
export function makeRotator(id, fullName, program, level, segments = []) {
  return {
    id,
    fullName,
    displayName: fullName,
    program,
    level,
    role: level === "Fellow" || program === "UT Pediatric Neurology Fellow" ? "Fellow" : level.startsWith("MS") ? "Student" : "Resident",
    segments: normalizeSegments(segments),
    schoolType: inferSchoolType(program),
    // Do not seed broad program defaults here; source-imported and manually
    // reviewed continuity slots are safer than guessing per-person clinic days.
    continuityClinic: program.includes("Adult") || program === "Methodist" ? "Tuesday PM" : "",
    dayOff: [],
    unavailableRanges: []
  };
}

// `Fellow` is the Pediatric Neurology coverage role in this scheduler, not a
// generic training level. Imported Psychiatry fellows still rotate as
// Psychiatry rotators, so they must not satisfy fellow-only coverage rules.
export function isPediatricNeurologyFellow(rotator) {
  if (!rotator) return false;
  const fellowSignal = rotator.role === "Fellow"
    || String(rotator.level || "").trim().toLowerCase() === "fellow";
  if (!fellowSignal) return false;
  const program = String(rotator.program || "").trim().toLowerCase();
  return program === "" || program === "other" || program.includes("pedi");
}

export function coverageRoleForRotator(rotator) {
  if (isPediatricNeurologyFellow(rotator)) return "Fellow";
  return rotator?.role === "Fellow" ? "Resident" : (rotator?.role || "Resident");
}

// True iff dateStr falls inside any segment in rotator.segments.
// Safe when segments is missing or empty: returns false.
export function isRotatorActiveOn(rotator, dateStr) {
  if (!rotator || !dateStr) return false;
  const segments = Array.isArray(rotator.segments) ? rotator.segments : [];
  for (const seg of segments) {
    if (!seg || !seg.start || !seg.end) continue;
    if (dateStr >= seg.start && dateStr <= seg.end) return true;
  }
  return false;
}

// All dates in block.startDate..block.endDate where the rotator is active.
// Returns [] if the block is missing endpoints or the rotator has no
// active days in the block window.
export function expandRotatorDatesInBlock(rotator, block) {
  if (!rotator || !block || !block.startDate || !block.endDate) return [];
  const dates = dateRange(block.startDate, block.endDate);
  return dates.filter((date) => isRotatorActiveOn(rotator, date));
}

// Rotators that are active on the given date. Used for date-aware UI
// pickers so we never offer a rotator who isn't actually present that
// day. Returns [] when state has no rotators.
export function activeRotatorsOn(state, dateStr) {
  if (!state || !Array.isArray(state.rotators)) return [];
  return state.rotators.filter((rotator) => isRotatorActiveOn(rotator, dateStr));
}

export function weekdayName(dateStr) {
  return WEEKDAYS[new Date(`${dateStr}T00:00:00`).getDay()];
}

export function isRotatorUnavailable(rotator, dateStr) {
  if (!rotator) return null;
  const dayOff = Array.isArray(rotator.dayOff) ? rotator.dayOff : [];
  const ranges = Array.isArray(rotator.unavailableRanges) ? rotator.unavailableRanges : [];
  const wd = weekdayName(dateStr);
  if (dayOff.includes(wd)) {
    return { reason: "day-off", label: wd };
  }
  const match = ranges.find(
    (range) => range && range.start && range.end && dateStr >= range.start && dateStr <= range.end
  );
  if (match) {
    return { reason: "range", label: `${match.start} to ${match.end}` };
  }
  return null;
}

export function updateRotator(state, rotatorId, patch) {
  const normalizedPatch = normalizeRotatorPatch(patch);
  return {
    ...state,
    rotators: state.rotators.map((rotator) =>
      rotator.id === rotatorId ? { ...rotator, ...normalizedPatch } : rotator
    )
  };
}

function assignment(date, rotatorId, role, source = "Manual") {
  return {
    id: `in-${date}-${rotatorId}-${role}`.replaceAll(" ", "-").toLowerCase(),
    date,
    rotatorId,
    role,
    source
  };
}

function session(date, period, clinic, provider, rotatorId) {
  return {
    id: `out-${date}-${period}-${rotatorId}`.toLowerCase(),
    date,
    period,
    clinic,
    provider,
    rotatorId,
    status: "Scheduled"
  };
}

export function activeBlock(state) {
  return state.serviceBlocks.find((block) => block.id === state.activeBlockId) ?? state.serviceBlocks[0];
}

/**
 * Create a new empty service block and append it to state.serviceBlocks.
 * Returns a new state with the new block selected as active. The new
 * block's dates default to 4 weeks starting the day after the latest
 * existing block ends (or today, if no blocks exist), so chains of
 * sequential blocks are easy to build.
 */
export function addServiceBlock(state, overrides = {}) {
  const existing = state.serviceBlocks || [];
  const latestEnd = existing
    .map((b) => b.endDate)
    .filter(Boolean)
    .sort()
    .at(-1);
  const startDate = overrides.startDate
    || (latestEnd ? addDaysToIso(latestEnd, 1) : new Date().toISOString().slice(0, 10));
  const endDate = overrides.endDate || addDaysToIso(startDate, 27);
  const baseId = `block-${Date.now()}`;
  let id = baseId;
  let suffix = 2;
  while (existing.some((block) => block.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  const block = {
    id,
    name: overrides.name || "New rotation block",
    startDate,
    endDate,
    status: "Draft",
    generate: {
      inpatient: true,
      outpatient: true,
      dailyReport: true,
      legend: true,
      export: true
    },
    holidays: []
  };
  return {
    ...state,
    serviceBlocks: [...existing, block],
    activeBlockId: id
  };
}

/**
 * Switch the active block to the given id (no-op if id isn't in the list).
 */
export function setActiveBlock(state, blockId) {
  if (!state.serviceBlocks?.some((b) => b.id === blockId)) return state;
  return { ...state, activeBlockId: blockId };
}

/**
 * Remove a service block by id. Refuses to delete the last remaining
 * block (the app needs at least one block to render calendars against).
 * If the deleted block was the active one, switches active to the first
 * remaining block. Returns { state, ok, reason } so callers can show a
 * friendly message either way.
 *
 * Assignments and outpatient sessions that fell inside the deleted
 * block's date range stay in state — they're not block-scoped, just
 * keyed by date. A future block covering those dates would see them
 * again. No data loss.
 */
export function removeServiceBlock(state, blockId) {
  const existing = state.serviceBlocks || [];
  if (existing.length <= 1) {
    return { state, ok: false, reason: "Can't delete the only block. Add another block first, then delete this one." };
  }
  if (!existing.some((b) => b.id === blockId)) {
    return { state, ok: false, reason: "That block isn't in the list." };
  }
  const remaining = existing.filter((b) => b.id !== blockId);
  const nextActive = state.activeBlockId === blockId ? remaining[0].id : state.activeBlockId;
  return {
    state: { ...state, serviceBlocks: remaining, activeBlockId: nextActive },
    ok: true,
    reason: null
  };
}

// Pure calendar arithmetic on YYYY-MM-DD strings. Uses UTC throughout so the
// host timezone can't shift the answer — `new Date("2026-05-04T00:00:00")` is
// local midnight, and `toISOString()` converts back to UTC, dropping a day
// for any timezone east of UTC. UTC construction sidesteps that entirely.
function addDaysToIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  const pad = (x) => String(x).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Clamp an ISO date string (YYYY-MM-DD) into a block's [startDate, endDate]
 * range. Used to pick a sensible default date for the assignment/report
 * pickers: today if it falls inside the active block, otherwise the nearest
 * block edge — so opening a block never lands you on a day outside it (where
 * no rotators are active). ISO dates compare correctly as plain strings.
 * Returns the date unchanged if the block has no usable start/end.
 */
export function clampDateToBlock(date, block) {
  const start = block?.startDate;
  const end = block?.endDate;
  if (!start || !end) return date;
  if (!date) return start;
  if (date < start) return start;
  if (date > end) return end;
  return date;
}

/**
 * Return a copy of `block` whose end date is pushed `days` later, so the
 * Planning Grid can show a short window PAST the block end ("peek past block
 * end" — Coordinator's cross-block continuity ask). The Planning Grid uses a
 * fixed-size context window even when neighboring blocks are longer. Other
 * block fields are preserved.
 * No-ops (returns the block unchanged) if the block has no end date.
 */
export function extendBlockEnd(block, days) {
  if (!block || !block.endDate || !Number.isFinite(days)) return block;
  return { ...block, endDate: addDaysToIso(block.endDate, days) };
}

/**
 * Return a copy of `block` whose start date is pulled `days` earlier, so the
 * Planning Grid can show a short read-only window BEFORE the block start.
 * Other block fields are preserved. No-ops if the block has no start date.
 */
export function extendBlockStart(block, days) {
  if (!block || !block.startDate || !Number.isFinite(days)) return block;
  return { ...block, startDate: addDaysToIso(block.startDate, -days) };
}

export function dateRange(startDate, endDate) {
  const dates = [];
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const cursor = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));
  const pad = (x) => String(x).padStart(2, "0");
  while (cursor <= end) {
    dates.push(`${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Fold duplicate-named rotators into single records. For every set of
 * rotators sharing a lowercased fullName, keeps the first id and
 * concatenates the segments arrays (de-duplicated by start/end pair).
 * Returns { state, removedCount } so callers can show a friendly count.
 *
 * Useful after a user has accidentally chosen "Add all as new" on a
 * re-upload — they can run this to recover without losing any segment
 * data. Assignments and outpatient/clinic rows whose rotatorId pointed
 * at a removed duplicate are re-pointed at the kept profile so nothing
 * dangles.
 */
export function dedupeRotatorsByName(state) {
  const groups = new Map();
  for (const rotator of state.rotators || []) {
    const key = String(rotator.fullName || "").trim().toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rotator);
  }

  const dedupedRotators = [];
  const idRemap = new Map();
  let removedCount = 0;

  for (const group of groups.values()) {
    const keeper = group[0];
    const segmentKeys = new Set();
    const segments = [];
    for (const member of group) {
      idRemap.set(member.id, keeper.id);
      for (const seg of member.segments || []) {
        const normalized = normalizeSegment(seg);
        if (!normalized) continue;
        const sk = `${normalized.start}|${normalized.end}`;
        if (segmentKeys.has(sk)) {
          if (normalized.defaultPhase) {
            const existing = segments.find(
              (item) => item.start === normalized.start && item.end === normalized.end
            );
            if (existing && !existing.defaultPhase) existing.defaultPhase = normalized.defaultPhase;
          }
          continue;
        }
        segmentKeys.add(sk);
        segments.push(normalized);
      }
    }
    segments.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    dedupedRotators.push({ ...keeper, segments });
    removedCount += group.length - 1;
  }

  const repoint = (item) => idRemap.has(item.rotatorId) && idRemap.get(item.rotatorId) !== item.rotatorId
    ? { ...item, rotatorId: idRemap.get(item.rotatorId) }
    : item;

  return {
    state: {
      ...state,
      rotators: dedupedRotators,
      inpatientAssignments: (state.inpatientAssignments || []).map(repoint),
      outpatientSessions: (state.outpatientSessions || []).map(repoint),
      clinicAssignments: (state.clinicAssignments || []).map(repoint)
    },
    removedCount
  };
}

export function addRotator(state, input) {
  const id = `rot-${slug(input.fullName)}-${Date.now()}`;
  // Accept either a multi-segment `segments` array (new shape) or the
  // legacy single `startDate`/`endDate` pair the rotator form still uses.
  let segments;
  if (Array.isArray(input.segments)) {
    segments = input.segments;
  } else if (input.startDate && input.endDate) {
    segments = [{ start: input.startDate, end: input.endDate }];
  } else {
    segments = [];
  }
  const rotator = makeRotator(
    id,
    input.fullName.trim(),
    input.program,
    input.level,
    segments
  );
  if (input.continuityClinic != null) {
    rotator.continuityClinic = input.continuityClinic;
  }
  const rotationStartDate = normalizeRotationStartDate(input.rotationStartDate);
  if (rotationStartDate) {
    rotator.rotationStartDate = rotationStartDate;
  }
  const methodistStartSide = normalizeMethodistStartSide(input.methodistStartSide);
  if (methodistStartSide) {
    rotator.methodistStartSide = methodistStartSide;
  }
  if ("dayOff" in input) {
    rotator.dayOff = normalizeDayOff(input.dayOff);
  }
  if ("unavailableRanges" in input) {
    rotator.unavailableRanges = normalizeUnavailableRanges(input.unavailableRanges);
  }
  return {
    ...state,
    rotators: [...state.rotators, rotator]
  };
}

/**
 * Remove a rotator and any assignments/sessions that reference them.
 * Coordinator asked for per-row delete on the Who's On Pedi tab so she can
 * undo a mistaken import or remove someone who left the program.
 *
 * We strip records pointing at the rotator so the planning grid + IP/OP
 * pages don't keep stale rows. Pre-assignments live on `segments` which
 * are part of the rotator object itself, so they go away automatically.
 */
export function removeRotator(state, rotatorId) {
  return {
    ...state,
    rotators: (state.rotators || []).filter((r) => r.id !== rotatorId),
    inpatientAssignments: (state.inpatientAssignments || []).filter((a) => a.rotatorId !== rotatorId),
    outpatientSessions: (state.outpatientSessions || []).filter((s) => s.rotatorId !== rotatorId),
    clinicAssignments: (state.clinicAssignments || []).filter((a) => a.rotatorId !== rotatorId)
  };
}

/**
 * Bulk-remove rotators. Same shape as removeRotator but accepts an
 * array/Set of ids and runs the filter once per collection (O(N+M)
 * instead of O(N*M) from a removeRotator-per-id loop). Cascades to
 * inpatient assignments, outpatient sessions, and clinic assignments the
 * same way.
 *
 * Coordinator asked for multi-select delete on the Who's On Pedi page
 * (2026-05-22 phone call) so she can clear bulk-imported rotators
 * without 50 separate confirms.
 */
export function removeRotators(state, rotatorIds) {
  const ids = rotatorIds instanceof Set ? rotatorIds : new Set(rotatorIds || []);
  if (ids.size === 0) return state;
  return {
    ...state,
    rotators: (state.rotators || []).filter((r) => !ids.has(r.id)),
    inpatientAssignments: (state.inpatientAssignments || []).filter((a) => !ids.has(a.rotatorId)),
    outpatientSessions: (state.outpatientSessions || []).filter((s) => !ids.has(s.rotatorId)),
    clinicAssignments: (state.clinicAssignments || []).filter((a) => !ids.has(a.rotatorId))
  };
}

export function updateBlock(state, blockPatch) {
  return {
    ...state,
    serviceBlocks: state.serviceBlocks.map((block) =>
      block.id === state.activeBlockId ? { ...block, ...blockPatch } : block
    )
  };
}

export function updateRules(state, patch) {
  return {
    ...state,
    rules: { ...state.rules, ...patch }
  };
}

// Patch editable poster metadata (2026-05-28 poster feature). Shallow-merges
// over existing posterSettings (which migrateLoadedState guarantees is present).
export function updatePosterSettings(state, patch) {
  return {
    ...state,
    posterSettings: { ...DEFAULT_POSTER_SETTINGS, ...state.posterSettings, ...patch }
  };
}

/**
 * Remove a source by id. Does NOT touch rotators — providers added from
 * the source persist (per Coordinator's intent: "delete all these sources to
 * reset the profiles" is a two-step workflow if she wants both gone,
 * but most of the time she just wants to clear stale source records
 * without losing the providers she may have edited since).
 */
export function removeSource(state, sourceId) {
  return {
    ...state,
    sources: (state.sources || []).filter((source) => source.id !== sourceId)
  };
}

export function addSource(state, source) {
  const sources = Array.isArray(state.sources) ? state.sources : [];
  return {
    ...state,
    sources: [
      ...sources,
      {
        id: `source-${slug(source.fileName)}-${Date.now()}`,
        importedAt: new Date().toISOString().slice(0, 10),
        status: "Reviewed",
        content: "",
        parsedRows: [],
        ...source
      }
    ]
  };
}

function normalizeSourceRecord(source, index = 0) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  let changed = false;
  const normalized = { ...source };
  const fallbackFileName = source.fileName == null ? "Legacy source" : String(source.fileName);
  if (!source.id || typeof source.id !== "string") {
    normalized.id = String(source.id || `source-${slug(fallbackFileName)}-${index + 1}`);
    changed = true;
  }
  for (const field of ["importedAt", "status", "program", "fileName", "fileType", "content"]) {
    if (source[field] != null && typeof source[field] !== "string") {
      normalized[field] = String(source[field]);
      changed = true;
    }
  }
  if (source.parsedRows != null && !Array.isArray(source.parsedRows)) {
    delete normalized.parsedRows;
    changed = true;
  }
  for (const field of ["importedRotatorCount", "importWarningCount"]) {
    if (Number.isInteger(source[field]) && source[field] >= 0) {
      normalized[field] = source[field];
    } else if (Object.prototype.hasOwnProperty.call(source, field)) {
      delete normalized[field];
      changed = true;
    }
  }
  if (Array.isArray(source.importWarnings)) {
    const warnings = source.importWarnings.filter((warning) => typeof warning === "string");
    if (warnings.length !== source.importWarnings.length) {
      normalized.importWarnings = warnings;
      changed = true;
    }
  } else if (Object.prototype.hasOwnProperty.call(source, "importWarnings")) {
    delete normalized.importWarnings;
    changed = true;
  }
  return changed ? normalized : source;
}

export function applyImportedRoster(state, mergeResult, sourceMeta) {
  const sources = Array.isArray(state.sources) ? state.sources : [];
  let nextSources = sources;
  if (sourceMeta) {
    const todayIso = new Date().toISOString().slice(0, 10);
    const importedRotatorCount = mergeResult.added + mergeResult.updated;
    if (sourceMeta.replaceSourceId) {
      // Replace an existing source in place — keeps its id stable so other
      // state that might reference it stays valid. File info + parsed
      // rows + imported-at all refresh.
      nextSources = sources.map((source) =>
        source.id === sourceMeta.replaceSourceId
          ? {
              ...source,
              program: sourceMeta.program || source.program,
              fileName: sourceMeta.fileName,
              fileType: sourceMeta.fileType || source.fileType || "xlsx",
              content: "",
              parsedRows: mergeResult.parsedRows || [],
              importedAt: todayIso,
              importedRotatorCount
            }
          : source
      );
    } else {
      nextSources = [
        ...sources,
        {
          id: `source-${slug(sourceMeta.fileName)}-${Date.now()}`,
          importedAt: todayIso,
          status: "Reviewed",
          program: sourceMeta.program || "Other",
          fileName: sourceMeta.fileName,
          fileType: sourceMeta.fileType || "xlsx",
          content: "",
          parsedRows: mergeResult.parsedRows || [],
          importedRotatorCount
        }
      ];
    }
  }
  return {
    ...state,
    rotators: mergeResult.rotators,
    sources: nextSources
  };
}

export function scheduleInpatientAssignment(state, input) {
  const nextAssignment = assignment(input.date, input.rotatorId, input.role || "Resident", input.source);
  // Dedupe per (date, rotator, role). Two intentional consequences:
  //   1. Same rotator, same role, same day → upsert (one record).
  //   2. Same rotator, DIFFERENT role, same day → two records coexist.
  //   3. Different rotators, same role, same day → two records coexist
  //      (pediatric neurology routinely has multiple residents on
  //      inpatient simultaneously — the bug v1 fixed was rotatorId
  //      being missing from the key).
  // Consequence (2) is deliberate: the InpatientPage form lets a user
  // record a rotator in different roles within one calendar day (e.g.
  // morning Resident coverage transitioning to afternoon Team senior
  // handoff). Range-assign and Methodist auto, in contrast, use slot-
  // identity dedupe by (date, rotator) — only one record per cell —
  // because they fire over date ranges where multiple roles on one
  // day would be noise rather than intent.
  return {
    ...state,
    inpatientAssignments: [
      ...state.inpatientAssignments.filter(
        (item) => !(
          item.date === input.date &&
          item.rotatorId === input.rotatorId &&
          item.role === nextAssignment.role
        )
      ),
      nextAssignment
    ]
  };
}

export function scheduleOutpatientSession(state, input) {
  const details = normalizeOutpatientDetails(input.details);
  const nextSession = {
    ...session(
      input.date,
      input.period,
      input.clinic || "Continuity Clinic",
      input.provider || "",
      input.rotatorId
    ),
    ...(details.length > 0 ? { details } : {})
  };
  // Dedupe per (date, period, rotator). Multiple rotators can share the
  // same AM/PM clinic slot — the InpatientPage/OutpatientPage flows loop
  // this function across selected rotator IDs and would lose all but one
  // if we wiped by (date, period) alone.
  return {
    ...state,
    outpatientSessions: [
      ...state.outpatientSessions.filter(
        (item) => !(
          item.date === input.date &&
          item.period === input.period &&
          item.rotatorId === input.rotatorId
        )
      ),
      nextSession
    ]
  };
}

function clinicReportSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "x";
}

function clinicReportOccurrenceId(attendingName, templateId, date, session) {
  return `clinic-occurrence::${clinicReportSlug(attendingName)}::${templateId}::${date}::${session}`;
}

function isReportRealClinicName(clinic) {
  const name = String(clinic || "").trim();
  return name.length > 0 && name !== OP_PLACEHOLDER_CLINIC && name !== METHODIST_OP_CLINIC;
}

function normalizeReportCapacity(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const CLINIC_REPORT_ROLE_ORDER = ["Resident", "Fellow", "Student"];
const CLINIC_REPORT_ROLE_SET = new Set(CLINIC_REPORT_ROLE_ORDER);

function normalizeReportAllowedRoles(raw) {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/\s*,\s*/)
      : [];
  const seen = new Set();
  for (const value of values) {
    const role = String(value || "").trim();
    if (CLINIC_REPORT_ROLE_SET.has(role)) seen.add(role);
  }
  return CLINIC_REPORT_ROLE_ORDER.filter((role) => seen.has(role));
}

function clinicReportOccurrences(state, block) {
  if (!state || !block?.startDate || !block?.endDate) return [];
  const dates = dateRange(block.startDate, block.endDate);
  const datesByWeekday = new Map();
  for (const date of dates) {
    const wd = weekdayName(date);
    const list = datesByWeekday.get(wd) || [];
    list.push(date);
    datesByWeekday.set(wd, list);
  }
  const inRange = (d) => d >= block.startDate && d <= block.endDate;
  const byId = new Map();
  const add = (occ) => {
    if (!byId.has(occ.id)) byId.set(occ.id, occ);
  };

  for (const attending of state.attendings || []) {
    const name = attending?.name || "";
    const recurring = Array.isArray(attending?.recurringClinics) ? attending.recurringClinics : [];
    recurring.forEach((slot, index) => {
      if (!slot || slot.active === false) return;
      const session = slot.session ?? slot.period;
      if (!slot.weekday || !session) return;
      const clinicName = slot.clinicName ?? "";
      const templateId = slot.id ?? `${index}-${clinicReportSlug(slot.weekday)}-${session}-${clinicReportSlug(clinicName || "clinic")}`;
      for (const date of datesByWeekday.get(slot.weekday) || []) {
        add({
          id: clinicReportOccurrenceId(name, templateId, date, session),
          date,
          session,
          attendingName: name,
          clinicName,
          capacity: normalizeReportCapacity(slot.capacity),
          allowedRoles: normalizeReportAllowedRoles(slot.allowedRoles)
        });
      }
    });
    const oneOffs = Array.isArray(attending?.oneOffDates) ? attending.oneOffDates : [];
    oneOffs.forEach((slot, index) => {
      if (!slot) return;
      const session = slot.session ?? slot.period;
      if (!slot.date || !session || !inRange(slot.date)) return;
      const clinicName = slot.clinicName ?? "";
      const templateId = slot.id ?? `oneoff-${index}-${session}-${clinicReportSlug(clinicName || "clinic")}`;
      add({
        id: clinicReportOccurrenceId(name, templateId, slot.date, session),
        date: slot.date,
        session,
        attendingName: name,
        clinicName,
        capacity: normalizeReportCapacity(slot.capacity),
        allowedRoles: normalizeReportAllowedRoles(slot.allowedRoles)
      });
    });
  }

  for (const sessionRec of state.outpatientSessions || []) {
    if (!sessionRec || !inRange(sessionRec.date) || !isReportRealClinicName(sessionRec.clinic)) continue;
    const provider = sessionRec.provider || "";
    const templateId = `legacy-${clinicReportSlug(sessionRec.clinic)}-${clinicReportSlug(provider)}`;
    add({
      id: clinicReportOccurrenceId(provider, templateId, sessionRec.date, sessionRec.period),
      date: sessionRec.date,
      session: sessionRec.period,
      attendingName: provider,
      clinicName: sessionRec.clinic,
      capacity: null,
      allowedRoles: []
    });
  }

  return Array.from(byId.values());
}

function clinicReportAssignments(state, block) {
  if (!state || !block?.startDate || !block?.endDate) return [];
  const inRange = (d) => d >= block.startDate && d <= block.endDate;
  const persisted = Array.isArray(state.clinicAssignments) ? state.clinicAssignments : [];
  const out = persisted.filter((a) => a && inRange(a.date));
  const seen = new Set(out.map((a) => `${a.clinicOccurrenceId}|${a.rotatorId}`));

  for (const sessionRec of state.outpatientSessions || []) {
    if (!sessionRec || !inRange(sessionRec.date) || !isReportRealClinicName(sessionRec.clinic)) continue;
    if (!sessionRec.rotatorId || !sessionRec.period) continue;
    const provider = sessionRec.provider || "";
    const templateId = `legacy-${clinicReportSlug(sessionRec.clinic)}-${clinicReportSlug(provider)}`;
    const occId = clinicReportOccurrenceId(provider, templateId, sessionRec.date, sessionRec.period);
    const key = `${occId}|${sessionRec.rotatorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `legacy-clinic-${clinicReportSlug(sessionRec.id || key)}`,
      clinicOccurrenceId: occId,
      rotatorId: sessionRec.rotatorId,
      date: sessionRec.date,
      session: sessionRec.period,
      source: "legacy"
    });
  }
  return out;
}

function clinicReportRows(state, block) {
  const occById = new Map(clinicReportOccurrences(state, block).map((occ) => [occ.id, occ]));
  return clinicReportAssignments(state, block)
    .map((assignment) => {
      const occ = occById.get(assignment.clinicOccurrenceId);
      const rotator = getRotator(state, assignment.rotatorId);
      return {
        id: assignment.id,
        clinicOccurrenceId: assignment.clinicOccurrenceId,
        rotatorId: assignment.rotatorId,
        rotatorName: rotator?.displayName || rotator?.fullName || assignment.rotatorId || "[Removed]",
        date: assignment.date,
        session: assignment.session,
        clinicName: occ?.clinicName || "",
        attendingName: occ?.attendingName || "",
        source: assignment.source,
        stale: !occ
      };
    })
    .sort((a, b) =>
      a.date.localeCompare(b.date) ||
      a.session.localeCompare(b.session) ||
      a.attendingName.localeCompare(b.attendingName) ||
      a.clinicName.localeCompare(b.clinicName) ||
      a.rotatorName.localeCompare(b.rotatorName)
    );
}

function clinicReportLine(row) {
  let destination = row.clinicName || "Clinic";
  if (row.attendingName) destination = `${destination} with ${row.attendingName}`;
  if (row.stale) destination = "Removed clinic";
  return `${row.session} ${destination}: ${row.rotatorName}`;
}

function detectReportClinicAssignmentConflicts(state, block) {
  if (!state || !block?.startDate || !block?.endDate) return [];
  const occById = new Map(clinicReportOccurrences(state, block).map((occ) => [occ.id, occ]));
  const assignments = clinicReportAssignments(state, block);
  const conflicts = [];

  const bySessionRotator = new Map();
  for (const a of assignments) {
    const key = `${a.date}|${a.session}|${a.rotatorId}`;
    const list = bySessionRotator.get(key) || [];
    list.push(a);
    bySessionRotator.set(key, list);
  }
  for (const [key, list] of bySessionRotator) {
    if (list.length <= 1) continue;
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
    const allowedRoles = normalizeReportAllowedRoles(occurrence.allowedRoles);
    if (allowedRoles.length > 0 && !allowedRoles.includes(rotator?.role)) {
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

function clinicConflictSummary(state, conflict) {
  if (conflict.type === "clinic-double-book") {
    const rotator = getRotator(state, conflict.rotatorId);
    const label = rotator?.displayName || rotator?.fullName || "Rotator";
    return {
      id: `conflict-clinic-double-${conflict.date}-${conflict.session}-${conflict.rotatorId}`,
      severity: conflict.severity || "Critical",
      type: conflict.type,
      date: conflict.date,
      title: `${label} is double-booked in clinic`,
      detail: `Assigned to multiple clinic occurrences in the ${conflict.session} session.`,
      status: "Open",
      rotatorId: conflict.rotatorId,
      period: conflict.session,
      assignment: "clinic"
    };
  }
  if (conflict.type === "clinic-over-capacity") {
    return {
      id: `conflict-clinic-capacity-${conflict.clinicOccurrenceId}`,
      severity: conflict.severity || "Warning",
      type: conflict.type,
      date: conflict.date,
      title: `Clinic over capacity on ${conflict.date}`,
      detail: `${conflict.assigned} assigned for capacity ${conflict.capacity} in the ${conflict.session} session.`,
      status: "Open",
      period: conflict.session,
      assignment: "clinic"
    };
  }
  if (conflict.type === "clinic-role-mismatch") {
    const rotator = getRotator(state, conflict.rotatorId);
    const label = rotator?.displayName || rotator?.fullName || "Rotator";
    const allowed = Array.isArray(conflict.allowedRoles) && conflict.allowedRoles.length
      ? conflict.allowedRoles.join(", ")
      : "configured roles";
    return {
      id: `conflict-clinic-role-${conflict.date}-${conflict.session}-${conflict.rotatorId}`,
      severity: conflict.severity || "Warning",
      type: conflict.type,
      date: conflict.date,
      title: `${label} does not match clinic role policy`,
      detail: `Assigned role ${conflict.actualRole || "unknown"} is not in allowed roles: ${allowed}.`,
      status: "Open",
      rotatorId: conflict.rotatorId,
      period: conflict.session,
      assignment: "clinic"
    };
  }
  if (conflict.type === "clinic-stale-occurrence") {
    const rotator = getRotator(state, conflict.rotatorId);
    const label = rotator?.displayName || rotator?.fullName || "Rotator";
    return {
      id: `conflict-clinic-stale-${conflict.date}-${conflict.session}-${conflict.rotatorId}`,
      severity: conflict.severity || "Warning",
      type: conflict.type,
      date: conflict.date,
      title: `${label} has a removed clinic assignment`,
      detail: "Clinic assignment references an attending clinic occurrence that no longer exists.",
      status: "Open",
      rotatorId: conflict.rotatorId,
      period: conflict.session,
      assignment: "clinic"
    };
  }
  return null;
}

export function getRotator(state, id) {
  return state.rotators.find((rotator) => rotator.id === id);
}

export function groupedRoster(state) {
  return PROGRAMS.map((program) => ({
    program,
    rotators: state.rotators.filter((rotator) => rotator.program === program)
  })).filter((group) => group.rotators.length > 0);
}

function detectAssignmentConflicts(state) {
  const conflicts = [];
  const inpatientByDateAndRotator = new Set(
    state.inpatientAssignments.map((item) => `${item.date}:${item.rotatorId}`)
  );

  for (const outpatient of state.outpatientSessions) {
    if (inpatientByDateAndRotator.has(`${outpatient.date}:${outpatient.rotatorId}`)) {
      const rotator = getRotator(state, outpatient.rotatorId);
      conflicts.push({
        id: `conflict-double-${outpatient.date}-${outpatient.rotatorId}`,
        severity: "Critical",
        type: "double-booked",
        date: outpatient.date,
        title: `${rotator?.displayName ?? "Rotator"} is double-booked`,
        detail: "Assigned to inpatient coverage and outpatient clinic on the same day.",
        status: "Open",
        rotatorId: outpatient.rotatorId,
        period: outpatient.period,
        assignment: "outpatient"
      });
    }
  }

  for (const item of state.inpatientAssignments) {
    const rotator = getRotator(state, item.rotatorId);
    const status = isRotatorUnavailable(rotator, item.date);
    if (!status) continue;
    const reasonText =
      status.reason === "day-off"
        ? `their day off (${status.label})`
        : `time off (${status.label})`;
    conflicts.push({
      id: `conflict-unavailable-${item.date}-${item.rotatorId}-inpatient`,
      severity: "Critical",
      type: "rotator-unavailable",
      date: item.date,
      title: `${rotator?.displayName ?? "Rotator"} is scheduled on ${reasonText}`,
      detail: "Inpatient assignment falls on a day the rotator is marked unavailable.",
      status: "Open",
      rotatorId: item.rotatorId,
      assignment: "inpatient"
    });
  }

  for (const item of state.outpatientSessions) {
    const rotator = getRotator(state, item.rotatorId);
    const status = isRotatorUnavailable(rotator, item.date);
    if (!status) continue;
    const reasonText =
      status.reason === "day-off"
        ? `their day off (${status.label})`
        : `time off (${status.label})`;
    conflicts.push({
      id: `conflict-unavailable-${item.date}-${item.rotatorId}-outpatient-${item.period}`,
      severity: "Critical",
      type: "rotator-unavailable",
      date: item.date,
      title: `${rotator?.displayName ?? "Rotator"} is scheduled on ${reasonText}`,
      detail: `${item.period} ${item.clinic} session falls on a day the rotator is marked unavailable.`,
      status: "Open",
      rotatorId: item.rotatorId,
      period: item.period,
      assignment: "outpatient"
    });
  }

  return conflicts;
}

function detectClinicCalendarConflicts(state, block) {
  const conflicts = [];

  // Guard `holidays`: older saved states (created before the field existed)
  // can lack it, and migrateLoadedState backfills it — but detectConflicts
  // runs unconditionally during render, so read it defensively here too.
  // Mirrors the safe read at coverageDayType (`block?.holidays || []`).
  for (const holiday of (block?.holidays || [])) {
    if (!holiday.noClinic) continue;
    const clinic = state.outpatientSessions.find((item) => item.date === holiday.date);
    if (clinic) {
      conflicts.push({
        id: `conflict-holiday-${holiday.date}`,
        severity: "Warning",
        type: "holiday-clinic",
        date: holiday.date,
        title: `Clinic scheduled on ${holiday.label}`,
        detail: "Holiday is marked no-clinic, but an outpatient session exists.",
        status: "Open",
        rotatorId: clinic.rotatorId,
        period: clinic.period,
        assignment: "outpatient"
      });
    }
  }

  // A3 / SPEC rule 8: outpatient clinics are closed on weekends, so any
  // outpatient session landing on a Saturday or Sunday is a scheduling error
  // (a closed-clinic booking). Part of the consolidated validation report —
  // the data-validation subset that needs neither the auto-scheduler nor an
  // open decision. (IP/OP double-booking is already covered above.)
  for (const item of state.outpatientSessions) {
    const wd = weekdayName(item.date);
    if (wd !== "Saturday" && wd !== "Sunday") continue;
    const rotator = getRotator(state, item.rotatorId);
    conflicts.push({
      id: `conflict-weekend-op-${item.date}-${item.rotatorId}-${item.period}`,
      severity: "Warning",
      type: "outpatient-weekend",
      date: item.date,
      title: `${rotator?.displayName ?? "Rotator"} has a weekend clinic`,
      detail: `${item.period} ${item.clinic || "outpatient"} session is on ${wd}; outpatient clinics are closed on weekends.`,
      status: "Open",
      rotatorId: item.rotatorId,
      period: item.period,
      assignment: "outpatient"
    });
  }

  return conflicts;
}

function detectCoverageConflicts(state, block) {
  const conflicts = [];
  const blockDates = dateRange(block.startDate, block.endDate);

  // missing-coverage / understaffed: compare each day's real inpatient
  // headcount against the coverage demand model (coverageForDate). The
  // defaults (contract §1d: >=1 EVERY day — weekday, weekend, AND holiday,
  // since noClinic suppresses outpatient only, not inpatient demand) are
  // overridable per-block via block.coverage.
  //
  // Superset, not replacement: actual === 0 still emits the original
  // `missing-coverage` (Critical), preserving existing tests and the
  // conflict-jump mapping; a partially-staffed day (0 < actual < required)
  // emits the new `understaffed` (Warning). Role "Off" is not coverage.
  //
  // Gated on the block having at least one rotator (per Coordinator's 2026-05-20
  // Q3 answer): the checklist is only useful once her roster is in place, and
  // skipping when empty avoids a 20-row avalanche on a fresh install.
  const hasAnyRotators = (state.rotators?.length ?? 0) > 0;
  if (!hasAnyRotators) return conflicts;

  const inpatientHeadsByDate = new Map();
  for (const item of state.inpatientAssignments) {
    if (item.role === "Off") continue;
    if (!inpatientHeadsByDate.has(item.date)) {
      inpatientHeadsByDate.set(item.date, new Set());
    }
    inpatientHeadsByDate.get(item.date).add(item.rotatorId);
  }

  for (const date of blockDates) {
    const required = coverageForDate(block, date).count;
    if (required <= 0) continue;
    const actual = inpatientHeadsByDate.get(date)?.size || 0;
    if (actual >= required) continue;

    if (actual === 0) {
      conflicts.push({
        id: `conflict-missing-coverage-${date}`,
        severity: "Critical",
        type: "missing-coverage",
        date,
        title: `No inpatient coverage on ${date}`,
        detail: "No one is assigned to inpatient for this day in the block.",
        status: "Open",
        assignment: "inpatient"
      });
    } else {
      conflicts.push({
        id: `conflict-understaffed-${date}`,
        severity: "Warning",
        type: "understaffed",
        date,
        title: `Understaffed inpatient on ${date}`,
        detail: `${actual} of ${required} required inpatient ${required === 1 ? "body" : "bodies"} assigned for this day.`,
        status: "Open",
        assignment: "inpatient"
      });
    }
  }

  return conflicts;
}

function detectMissingLegendConflicts(state, block) {
  const conflicts = [];

  // missing-legend: rotators referenced by assignments/sessions inside
  // the block window but absent from the generated legend. We define
  // "referenced" rather than "active" because a legend generated from
  // active-in-block rotators is, by construction, a superset — so the
  // failure mode is a stale or removed legend entry that the schedule
  // still points at, or a rotator the block was scheduled against
  // before they were added to the legend.
  const legend = generateLegend(state, block);
  const legendRotatorIds = new Set(legend.entries.map((entry) => entry.rotatorId));
  const referencedInBlock = new Set();
  for (const item of state.inpatientAssignments) {
    if (item.date < block.startDate || item.date > block.endDate) continue;
    if (item.rotatorId) referencedInBlock.add(item.rotatorId);
  }
  for (const item of state.outpatientSessions) {
    if (item.date < block.startDate || item.date > block.endDate) continue;
    if (item.rotatorId) referencedInBlock.add(item.rotatorId);
  }
  for (const rotatorId of referencedInBlock) {
    if (legendRotatorIds.has(rotatorId)) continue;
    const rotator = getRotator(state, rotatorId);
    conflicts.push({
      id: `conflict-missing-legend-${rotatorId}`,
      severity: "Critical",
      type: "missing-legend",
      date: block.startDate,
      title: `${rotator?.displayName ?? "Rotator"} is on the schedule but not in the legend`,
      detail: "The numbered legend for this block has no entry for this rotator.",
      status: "Open",
      rotatorId
    });
  }

  return conflicts;
}

function detectContinuityClinicConflicts(state) {
  const conflicts = [];

  // continuity-clinic-conflict: rotator has continuity clinic on a
  // weekday (e.g. "Tuesday PM") and is also assigned inpatient on that
  // weekday. Spec §15.2 / §10.7 treats this as a Warning (the rotator
  // can be excused with a pull-out note in the daily report).
  for (const item of state.inpatientAssignments) {
    const rotator = getRotator(state, item.rotatorId);
    const unresolvedPeriods = continuityPeriodsNeedingWholeDayWarning(state, rotator, item.date);
    if (unresolvedPeriods.size === 0) continue;
    conflicts.push({
      id: `conflict-continuity-${item.date}-${item.rotatorId}`,
      severity: "Warning",
      type: "continuity-clinic-conflict",
      date: item.date,
      title: `${rotator?.displayName ?? "Rotator"} has continuity clinic on this day`,
      detail: `Inpatient assignment falls on ${rotator?.continuityClinic}; add a clinic pull-out note if this is intended.`,
      status: "Open",
      rotatorId: item.rotatorId,
      assignment: "inpatient"
    });
  }

  // outpatient-continuity-conflict (Coordinator-4, 2026-05-22): same idea
  // but for outpatient sessions. If a rotator's continuity clinic is
  // "Tuesday PM" and they're scheduled into a different outpatient
  // clinic on a Tuesday PM, surface a Warning. Sessions whose clinic
  // text mentions "continuity" are skipped — that's the expected case.
  for (const session of state.outpatientSessions) {
    const rotator = getRotator(state, session.rotatorId);
    const slots = parseContinuityClinicSlots(rotator?.continuityClinic);
    if (slots.length === 0) continue;
    if (!slots.some((s) => s.weekday === weekdayName(session.date) && s.period === session.period)) {
      continue;
    }
    if (String(session.clinic || "").toLowerCase().includes("continuity")) continue;
    conflicts.push({
      id: `conflict-continuity-out-${session.date}-${session.rotatorId}-${session.period}`,
      severity: "Warning",
      type: "continuity-clinic-conflict",
      date: session.date,
      title: `${rotator?.displayName ?? "Rotator"} has continuity clinic this period`,
      detail: `${session.period} ${session.clinic || "session"} on ${session.date} overlaps the rotator's continuity clinic (${rotator?.continuityClinic}).`,
      status: "Open",
      rotatorId: session.rotatorId,
      period: session.period,
      assignment: "outpatient"
    });
  }

  return conflicts;
}

function detectAttendingClinicConflicts(state, block) {
  const conflicts = [];

  for (const clinicConflict of detectReportClinicAssignmentConflicts(state, block)) {
    const summary = clinicConflictSummary(state, clinicConflict);
    if (summary) conflicts.push(summary);
  }

  return conflicts;
}

export function detectConflicts(state) {
  const block = activeBlock(state);
  return [
    ...detectAssignmentConflicts(state),
    ...detectClinicCalendarConflicts(state, block),
    ...detectCoverageConflicts(state, block),
    ...detectMissingLegendConflicts(state, block),
    ...detectContinuityClinicConflicts(state),
    ...detectAttendingClinicConflicts(state, block)
  ];
}

// Length of the consecutive-calendar-day inpatient run that `date` would
// belong to for this rotator — existing real (non-"Off") inpatient
// assignments in `state` plus `date` itself. Enforces
// rules.maxConsecutiveInpatientDays. Because proposeSchedule threads its
// in-progress working state through validateDrop, this automatically sees
// assignments made earlier in the same generation pass.
function consecutiveInpatientRun(state, rotatorId, date) {
  const assigned = new Set(
    (state.inpatientAssignments || [])
      .filter((i) => i.rotatorId === rotatorId && i.role !== "Off")
      .map((i) => i.date)
  );
  assigned.add(date);
  let len = 1;
  let cur = addDaysToIso(date, -1);
  while (assigned.has(cur)) { len += 1; cur = addDaysToIso(cur, -1); }
  cur = addDaysToIso(date, 1);
  while (assigned.has(cur)) { len += 1; cur = addDaysToIso(cur, 1); }
  return len;
}

/**
 * Validity check for a drag-drop assignment. Pure function — returns
 * { valid: true } if the rotator can be assigned to the date, otherwise
 * { valid: false, reason: "..." }.
 *
 * Used by drag-drop's chess-style mechanic: cells where validateDrop
 * fails are marked `disabled` on their `useDroppable`, so the dnd-kit
 * collision system filters them out before they can ever become a drop
 * target. The drop literally cannot land there.
 *
 * Conditions for valid:
 *   - state and arguments are present
 *   - rotator exists in state.rotators
 *   - rotator's segments cover the date (they are on service)
 *   - rotator is not on day-off or in an unavailable range that day
 *
 * Idempotency (rotator already inpatient-assigned this date) is NOT
 * treated as invalid here — applyDrop / scheduleInpatientAssignment
 * already handle the no-op / multi-role case correctly.
 */
// The other half of the weekend: Sat -> its Sunday, Sun -> its Saturday.
function weekendPairDate(dateStr) {
  const wd = weekdayName(dateStr);
  if (wd === "Saturday") return addDaysToIso(dateStr, 1);
  if (wd === "Sunday") return addDaysToIso(dateStr, -1);
  return null;
}

export function validateDrop(state, rotatorId, date, options = {}) {
  if (!state || !rotatorId || !date) {
    return { valid: false, reason: "Missing arguments" };
  }
  const rotator = getRotator(state, rotatorId);
  if (!rotator) {
    return { valid: false, reason: "Rotator not found" };
  }
  if (!isRotatorActiveOn(rotator, date)) {
    return { valid: false, reason: `${rotator.displayName ?? "Rotator"} is not on service on ${date}` };
  }
  const unavail = isRotatorUnavailable(rotator, date);
  if (unavail) {
    return { valid: false, reason: `${rotator.displayName ?? "Rotator"} is unavailable on ${date} (${unavail.label ?? unavail.reason})` };
  }
  // Always-on hard rules (added for the auto-draft work). These also tighten
  // drag-drop, which is correct: you should not be able to drop a rotator
  // onto a day that double-books them or breaks the consecutive-day cap.
  const doubleBooked = (state.outpatientSessions || []).some(
    (s) => s.date === date && s.rotatorId === rotatorId
  );
  if (doubleBooked) {
    return { valid: false, reason: `${rotator.displayName ?? "Rotator"} already has an outpatient session on ${date}` };
  }
  const maxConsec = state.rules?.maxConsecutiveInpatientDays;
  if (Number.isFinite(maxConsec) && maxConsec > 0 && consecutiveInpatientRun(state, rotatorId, date) > maxConsec) {
    return { valid: false, reason: `${rotator.displayName ?? "Rotator"} would exceed ${maxConsec} consecutive inpatient days` };
  }
  // Coordinator 2026-07-29 #6b: one day off per weekend — no rotator works both
  // Saturday and Sunday of the same weekend on inpatient.
  const weekendPair = weekendPairDate(date);
  if (
    weekendPair &&
    (state.inpatientAssignments || []).some(
      (item) => item.date === weekendPair && item.rotatorId === rotatorId && item.role !== "Off"
    )
  ) {
    return { valid: false, reason: `${rotator.displayName ?? "Rotator"} already works ${weekdayName(weekendPair)} this weekend and needs one day off` };
  }
  // Opt-in checks. Plain drag-drop leaves these OFF so its existing
  // "excusable warning" model is preserved — Coordinator may still manually place
  // an inpatient day on a continuity-clinic day with a pull-out note. The
  // auto-draft turns them ON (avoidContinuity / requiredRole) so it never
  // CREATES avoidable warnings or assigns a rotator who fails a slot's role.
  if (options.avoidContinuity) {
    const weekday = weekdayName(date);
    if (continuityPeriodsNeedingWholeDayWarning(state, rotator, date).size > 0) {
      return { valid: false, reason: `${rotator.displayName ?? "Rotator"} has continuity clinic on ${weekday}` };
    }
  }
  const matchesRequiredRole = options.requiredRole === "Fellow"
    ? isPediatricNeurologyFellow(rotator)
    : rotator.role === options.requiredRole;
  if (options.requiredRole && !matchesRequiredRole) {
    return { valid: false, reason: `${rotator.displayName ?? "Rotator"} is not a ${options.requiredRole}` };
  }
  return { valid: true };
}

/**
 * Apply a drag-drop assignment to state. Defensively re-validates via
 * validateDrop and returns the state unchanged if invalid (the UI's
 * chess-style mechanic should prevent invalid drops from reaching here,
 * but the guard catches any future caller that bypasses the UI).
 *
 * Creates an Inpatient assignment with role "Resident" and source
 * "Drag-Drop". For Outpatient sessions, use the paint-tool path.
 */
export function applyDrop(state, rotatorId, date) {
  const check = validateDrop(state, rotatorId, date);
  if (!check.valid) return state;
  return scheduleInpatientAssignment(state, {
    date,
    rotatorId,
    role: "Resident",
    source: "Drag-Drop"
  });
}

/**
 * Per the multi-team conflict-jump plan (2026-05-22): map a conflict
 * to the page the user should land on to fix it. Returns null for
 * conflict types where the destination is ambiguous; the UI uses null
 * as the cue to skip the jump-button.
 *
 * The mapping uses the `assignment` field if present (most conflicts),
 * with the missing-legend type as the only one routing to the Legend
 * page instead.
 */
export function focusTargetForConflict(conflict) {
  if (!conflict) return null;
  // 2026-05-28 redesign: jump targets point at the new top-level
  // destinations. Legend/report problems live under Reports; service-level
  // inpatient problems are fixed in Planning Grid (service truth) and reviewed
  // in Inpatient Schedule; outpatient problems land on Outpatient Schedule.
  if (conflict.type === "missing-legend") {
    return { page: "Reports", rotatorId: conflict.rotatorId };
  }
  // Clinic-assignment problems are fixed on the Clinics page (plan §4).
  if (typeof conflict.type === "string" && conflict.type.startsWith("clinic-")) {
    return { page: "Clinics", date: conflict.date, rotatorId: conflict.rotatorId };
  }
  if (conflict.assignment === "inpatient") {
    return {
      page: "Inpatient Schedule",
      date: conflict.date,
      rotatorId: conflict.rotatorId
    };
  }
  if (conflict.assignment === "outpatient") {
    return {
      page: "Outpatient Schedule",
      date: conflict.date,
      rotatorId: conflict.rotatorId,
      period: conflict.period
    };
  }
  return null;
}

export function generateDailyReport(state, date) {
  const block = activeBlock(state);
  const inpatient = state.inpatientAssignments
    .filter((item) => item.date === date)
    .map((item) => `${item.role}: ${getRotator(state, item.rotatorId)?.displayName ?? "[Removed]"}`);
  const outpatient = state.outpatientSessions
    .filter((item) => item.date === date)
    .map((item) => `${item.period} ${item.clinic}: ${getRotator(state, item.rotatorId)?.displayName ?? "[Removed]"}`);
  const clinics = clinicReportRows(state, block)
    .filter((item) => item.date === date)
    .map(clinicReportLine);

  return [
    `Daily Team Report`,
    `${block.name}`,
    `${date}`,
    "",
    "Inpatient",
    inpatient.length ? inpatient.join("\n") : "No inpatient assignments.",
    "",
    "Outpatient",
    outpatient.length ? outpatient.join("\n") : "No outpatient sessions.",
    "",
    "Clinic Assignments",
    clinics.length ? clinics.join("\n") : "No clinic assignments.",
    "",
    "Conflicts",
    detectConflicts(state).filter((item) => item.date === date).length
      ? detectConflicts(state).filter((item) => item.date === date).map((item) => item.title).join("\n")
      : "No conflicts for this date."
  ].join("\n");
}

/**
 * Build the rotator × date planning grid for the given block.
 *
 * Returns { dates, rows, totals } where rows is one entry per rotator in
 * the same order as state.rotators, and totals is one entry per date.
 *
 * Each cell carries a status string:
 *   "absent"     — rotator has no segment covering this date
 *   "off"        — rotator is active but unavailable (day-off, unavailable
 *                  range, or an explicit inpatient role of "Off")
 *   "inpatient"  — rotator has at least one inpatient assignment whose
 *                  role isn't "Off"
 *   "outpatient" — rotator has at least one outpatient session
 *   "both"       — rotator has BOTH a real inpatient assignment AND an
 *                  outpatient session on the same date (conflict — Coordinator
 *                  needs to see this, not have it hidden)
 *   "unassigned" — rotator is active and available but has no IP/OP record
 *
 * The "Off" inpatient role is a marker that the user explicitly placed
 * the rotator off-service on that day; it is NOT a real inpatient shift
 * and must not increase the inpatient count. Methodist auto-fill and
 * pre-assignment placeholders write real outpatient sessions (clinic ""
 * or "Methodist Outpatient") and so count as outpatient cells.
 *
 * Daily totals only count rotators who are present that day (status !==
 * "absent" and status !== "off"). "Unassigned" is the action item — the
 * UI should flag positive Unassigned counts loudly so the user spots
 * coverage gaps at a glance.
 */
export function buildPlanningGrid(state, block) {
  if (!state || !block || !block.startDate || !block.endDate) {
    return { dates: [], rows: [], totals: [] };
  }
  const dates = dateRange(block.startDate, block.endDate);
  const rotators = Array.isArray(state.rotators) ? state.rotators : [];

  const ipByKey = indexByDateAndRotator(state.inpatientAssignments);
  const opByKey = indexByDateAndRotator(state.outpatientSessions);

  // Weekends + no-clinic holidays are "off-calendar" days: outpatient is
  // structurally unavailable and no individual rotator is expected to be
  // assigned there, so an *unassigned* off-calendar cell must NOT push the
  // rotator into the "needs assignment" section. Before #6 these days were
  // masked out of the grid entirely; now that they render as cells, the
  // unassigned cell carries this flag so groupPlanningRowsBySection can
  // ignore it. (Block-level inpatient demand on these days is still enforced
  // separately by detectConflicts / coverageForDate.)
  const noClinicHolidays = new Set(
    (block.holidays || []).filter((h) => h && h.noClinic).map((h) => h.date)
  );
  const isWeekend = (date) => {
    const wd = weekdayName(date);
    return wd === "Saturday" || wd === "Sunday";
  };
  const isOffCalendar = (date) => isWeekend(date) || noClinicHolidays.has(date);

  // Coordinator #1: a rotator whose OUTPATIENT assignment spans a weekend reads as
  // OFF on that weekend (clinic doesn't run Sat/Sun), unless explicitly
  // overridden by a real assignment. We test OUTPATIENT phase specifically —
  // by imported-segment phase or the Methodist 14/14 phase — so an
  // inpatient-phase rotator (hospital runs 24/7) is never falsely marked off.
  // A boundary weekend (OP ends Fri, IP starts Mon) falls in neither phase
  // segment, so it is left available rather than guessed off.
  const isOutpatientPhaseOn = (rotator, date) =>
    getRotatorSegmentPhase(rotator, date) === "outpatient" ||
    getRotatorPhase(rotator, date) === "outpatient";

  const rows = rotators.map((rotator) => ({
    rotator,
    cells: dates.map((date) =>
      classifyPlanningCell(rotator, date, ipByKey, opByKey, { isWeekend, isOffCalendar, isOutpatientPhaseOn })
    ),
  }));

  return { dates, rows, totals: computePlanningTotals(dates, rows) };
}

/** Bucket assignment-shaped records into a `${date}|${rotatorId}` map. */
function indexByDateAndRotator(items) {
  const byKey = new Map();
  for (const item of items || []) {
    const key = `${item.date}|${item.rotatorId}`;
    const bucket = byKey.get(key) || [];
    bucket.push(item);
    byKey.set(key, bucket);
  }
  return byKey;
}

/**
 * Classify one rotator/date planning cell. See the buildPlanningGrid doc
 * comment for the status vocabulary; `calendar` carries the block-scoped
 * date classifiers so this stays a pure function of its arguments.
 */
function classifyPlanningCell(rotator, date, ipByKey, opByKey, calendar) {
  const { isWeekend, isOffCalendar, isOutpatientPhaseOn } = calendar;
  if (!isRotatorActiveOn(rotator, date)) {
    return { date, status: "absent" };
  }
  const unavailable = isRotatorUnavailable(rotator, date);
  const ipBucket = ipByKey.get(`${date}|${rotator.id}`) || [];
  const opBucket = opByKey.get(`${date}|${rotator.id}`) || [];
  const realIp = ipBucket.filter((item) => item.role !== "Off");
  const markedOff = ipBucket.some((item) => item.role === "Off");

  if (unavailable && realIp.length === 0 && opBucket.length === 0) {
    return { date, status: "off", reason: unavailable.reason, label: unavailable.label };
  }
  if (markedOff && realIp.length === 0 && opBucket.length === 0) {
    return { date, status: "off", reason: "marked-off" };
  }
  if (realIp.length > 0 && opBucket.length > 0) {
    return { date, status: "both", ip: realIp, op: opBucket };
  }
  if (realIp.length > 0) {
    return { date, status: "inpatient", ip: realIp };
  }
  if (opBucket.length > 0) {
    return { date, status: "outpatient", op: opBucket };
  }
  // No real assignment on this empty cell. If it's a weekend the rotator's
  // outpatient stretch spans, surface it as OFF (Coordinator #1); otherwise the
  // ordinary unassigned cell (flagged off-calendar on weekends/no-clinic
  // holidays so it doesn't count as "needs assignment").
  if (isWeekend(date) && isOutpatientPhaseOn(rotator, date)) {
    return { date, status: "off", reason: "weekend-op" };
  }
  return { date, status: "unassigned", offCalendar: isOffCalendar(date) };
}

/** Per-date totals over classified rows; only present rotators count. */
function computePlanningTotals(dates, rows) {
  return dates.map((date, dateIdx) => {
    let ip = 0;
    let op = 0;
    let both = 0;
    let unassigned = 0;
    let present = 0;
    for (const row of rows) {
      const cell = row.cells[dateIdx];
      if (cell.status === "absent" || cell.status === "off") continue;
      present += 1;
      if (cell.status === "inpatient") ip += 1;
      else if (cell.status === "outpatient") op += 1;
      else if (cell.status === "both") { ip += 1; op += 1; both += 1; }
      else if (cell.status === "unassigned") unassigned += 1;
    }
    return { date, ip, op, both, unassigned, present };
  });
}

// --- Coverage demand model (auto-draft, piece 1 of 4) ----------------------
// How many inpatient bodies a given day needs, and (optionally) a minimum
// per-role mix. Stored additively on the service block as `block.coverage`:
//
//   block.coverage = {
//     weekday:  { ip: { count: 2, byRole: { Resident: 1 } } },
//     saturday: { ip: { count: 1 } },
//     sunday:   { ip: { count: 1 } },
//     holiday:  { ip: { count: 1 } }
//   }
//
// service-block.v1 is additionalProperties:true, so no schema change is
// needed and old blocks without `coverage` keep working via the defaults
// below.

// The default demand when a block has no explicit `coverage`. Contract v2
// §1d (Coordinator #6, 2026-06-02): the inpatient side requires AT LEAST TWO bodies
// EVERY day — including weekends and holidays. `noClinic` holidays suppress
// OUTPATIENT clinic only, not inpatient demand, so a no-clinic holiday left
// understaffed flags missing coverage. The fellow counts toward the two when
// on service (headcount is role-agnostic). Still overridable per-block via
// block.coverage.
const DEFAULT_COVERAGE_COUNT = { weekday: 2, saturday: 2, sunday: 2, holiday: 2 };

// Classify a date within a block into a coverage day-type.
function coverageDayType(block, dateStr) {
  const holidayDates = new Set((block?.holidays || []).map((h) => h.date));
  if (holidayDates.has(dateStr)) return "holiday";
  const wd = weekdayName(dateStr);
  if (wd === "Saturday") return "saturday";
  if (wd === "Sunday") return "sunday";
  return "weekday";
}

// Resolve the inpatient demand for a single date: { count, byRole }.
// Falls back to DEFAULT_COVERAGE_COUNT when the block has no `coverage`
// or no entry for this day-type, so behavior is unchanged until set.
export function coverageForDate(block, dateStr) {
  const dayType = coverageDayType(block, dateStr);
  const ip = block?.coverage?.[dayType]?.ip;
  const count = Number.isFinite(ip?.count) ? ip.count : DEFAULT_COVERAGE_COUNT[dayType];
  const byRole = ip && ip.byRole && typeof ip.byRole === "object" ? ip.byRole : null;
  return { count: Math.max(0, count), byRole };
}

// The engine's default inpatient demand for a coverage day-type, exposed so
// UI (Block-Setup form) shows the SAME number the scheduler enforces — no
// drift between "form says 0" and "engine requires 2". Unknown types -> 0.
export function defaultCoverageCount(dayType) {
  return DEFAULT_COVERAGE_COUNT[dayType] ?? 0;
}

// Pure setter: attach/replace a block's coverage demand. Additive — leaves
// every other block field untouched.
export function setBlockCoverage(state, blockId, coverage) {
  if (!state) return state;
  return {
    ...state,
    serviceBlocks: (state.serviceBlocks || []).map((b) =>
      b.id === blockId ? { ...b, coverage } : b
    )
  };
}

// Suggest a coverage object by reading a (typically prior) block's actual
// inpatient totals from buildPlanningGrid. Weekday count = rounded average of
// that block's non-empty weekday inpatient headcounts; every day-type is
// floored at the engine's hard minimum (Coordinator #6: at least two inpatient
// bodies EVERY day incl. weekends/holidays) so "prefill from grid" can never
// propose coverage below the always-staff-inpatient rule. Used to pre-fill the
// Block-Setup form so Coordinator edits a sensible starting point, not a blank one.
export function suggestCoverageFromGrid(state, block) {
  const grid = buildPlanningGrid(state, block);
  const weekdayIp = grid.totals
    .filter((t) => {
      const wd = weekdayName(t.date);
      return wd !== "Saturday" && wd !== "Sunday";
    })
    .map((t) => t.ip)
    .filter((n) => n > 0);
  const typical = weekdayIp.length
    ? Math.round(weekdayIp.reduce((a, b) => a + b, 0) / weekdayIp.length)
    : 0;
  return {
    weekday: { ip: { count: Math.max(defaultCoverageCount("weekday"), typical) } },
    saturday: { ip: { count: defaultCoverageCount("saturday") } },
    sunday: { ip: { count: defaultCoverageCount("sunday") } },
    holiday: { ip: { count: defaultCoverageCount("holiday") } }
  };
}

// --- Deterministic fair-fill engine (auto-draft, piece 3 of 4) -------------
// proposeSchedule(state, block) -> { proposedState, unmet[] }
//
// Generates a complete, legal inpatient draft. Pure + deterministic: same
// input always yields the same output. NO AI, NO randomness, NO search.
//
// LOCK SEMANTIC: every existing assignment (Manual, Drag-Drop, Auto-Methodist,
// Range-Assigned, Auto-Preassigned, ...) counts toward demand and is NEVER
// removed or overwritten. Auto-Draft only fills the remaining gap.
//
// Procedure (per GOAL): for each required-but-open slot, ordered
// most-constrained-first (fewest eligible residents, then earliest date),
// assign the eligible resident with the lightest current inpatient load
// (deterministic tiebreak: stable sort by id). Every assignment is checked
// against the in-progress working state via validateDrop, so max-consecutive
// and double-book are honored as the draft grows. Slots with no eligible
// resident are left in unmet[] with a reason — never fabricated.
export function proposeSchedule(state, block, options = {}) {
  if (!state || !block || !block.startDate || !block.endDate) {
    return { proposedState: state, unmet: [] };
  }
  const excludedSlots = options.excludedSlots || new Set();
  let working = state;
  const unmet = [];
  const dates = dateRange(block.startDate, block.endDate);

  // Distinct rotator ids with a real (non-"Off") inpatient assignment on a
  // date, read from the given (working) state.
  const headcount = (s, date) => {
    const set = new Set();
    for (const i of s.inpatientAssignments || []) {
      if (i.date === date && i.role !== "Off") set.add(i.rotatorId);
    }
    return set;
  };
  // Block-window inpatient load = count of distinct inpatient days for a
  // rotator inside this block. Used for lightest-load selection.
  const loadOf = (s, rid) => {
    const days = new Set();
    for (const i of s.inpatientAssignments || []) {
      if (i.rotatorId === rid && i.role !== "Off" && i.date >= block.startDate && i.date <= block.endDate) {
        days.add(i.date);
      }
    }
    return days.size;
  };
  // Rotators eligible to take `date` under every hard rule, excluding any
  // already covering that date. avoidContinuity is ON (auto-draft must not
  // create avoidable continuity warnings). requiredRole optional.
  // A Methodist rotator in their OUTPATIENT fortnight is off our inpatient
  // service (Coordinator #8 / D1b): never fair-fill them as inpatient backup, even
  // on weekends/holidays where they hold no clinic. getRotatorPhase returns
  // null for everyone else (non-Methodist, or Methodist with no
  // rotationStartDate), so this only narrows the Methodist OP-fortnight set.
  const eligibleFor = (s, date, requiredRole) => {
    const already = headcount(s, date);
    return (s.rotators || []).filter(
      (r) =>
        !already.has(r.id) &&
        !excludedSlots.has(`${date}|${r.id}`) &&
        getRotatorPhase(r, date) !== "outpatient" &&
        getRotatorSegmentPhase(r, date) !== "outpatient" &&
        validateDrop(s, r.id, date, { avoidContinuity: true, requiredRole }).valid
    );
  };
  // Assign the lightest-loaded eligible rotator; stable tiebreak by id.
  // Returns true if one was assigned, false if none eligible.
  const fillOne = (date, requiredRole) => {
    const eligible = eligibleFor(working, date, requiredRole);
    if (eligible.length === 0) return false;
    eligible.sort((a, b) => loadOf(working, a.id) - loadOf(working, b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const chosen = eligible[0];
    working = scheduleInpatientAssignment(working, {
      date,
      rotatorId: chosen.id,
      role: chosen.role || "Resident",
      source: "Auto-Draft"
    });
    return true;
  };

  // Order open dates most-constrained-first using the INITIAL eligible counts
  // (fewest first), tiebreak earliest date. Filling re-checks feasibility
  // against working, so ordering only affects which scarce resident lands
  // where — never legality.
  const openDates = [];
  for (const date of dates) {
    const required = coverageForDate(block, date).count;
    if (required <= 0) continue;
    if (headcount(working, date).size >= required) continue;
    openDates.push({ date, eligibleCount: eligibleFor(working, date).length });
  }
  openDates.sort((a, b) => a.eligibleCount - b.eligibleCount || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const { date } of openDates) {
    const demand = coverageForDate(block, date);
    // Role minimums first (if the demand specifies byRole), then fill to the
    // total count with anyone eligible.
    if (demand.byRole && typeof demand.byRole === "object") {
      for (const [role, min] of Object.entries(demand.byRole)) {
        let have = [...headcount(working, date)].filter((rid) => getRotator(working, rid)?.role === role).length;
        while (have < min) {
          if (!fillOne(date, role)) {
            unmet.push({ date, reason: `No eligible ${role} available on ${date}`, requiredRole: role });
            break;
          }
          have += 1;
        }
      }
    }
    let guard = 0;
    while (headcount(working, date).size < demand.count && guard++ < 64) {
      if (!fillOne(date, null)) {
        const short = demand.count - headcount(working, date).size;
        unmet.push({ date, reason: `No eligible resident available on ${date} (${short} short)`, short });
        break;
      }
    }
  }

  // --- Deterministic swap-repair (one pass) --------------------------------
  // Greedy fill can spend a scarce rotator early and strand a later date. For
  // each still-unmet total-count slot, try ONE move at a time: take rotator R
  // off a day d where R was placed by THIS pass (`source: "Auto-Draft"` only —
  // never a manual, imported, Methodist or split record), put R on the unmet
  // date u, and backfill d with another eligible rotator. Every step
  // re-validates, ordering is fully deterministic, and there is no search
  // tree — a single bounded pass, so this stays a repair, not a solver.
  // Role-minimum shortfalls and role-constrained donor days are skipped
  // (moving role-specific coverage safely needs role-aware backfill).
  const removeOne = (s, rid, date) => ({
    ...s,
    inpatientAssignments: (s.inpatientAssignments || []).filter(
      (i) => !(i.rotatorId === rid && i.date === date)
    )
  });
  const stillUnmet = [];
  for (const u of unmet) {
    if (u.requiredRole) {
      stillUnmet.push(u);
      continue;
    }
    let short = Math.max(1, u.short || 1);
    while (short > 0) {
      let moved = false;
      for (const d of dates) {
        if (d === u.date || coverageForDate(block, d).byRole) continue;
        const donors = (working.inpatientAssignments || [])
          .filter((i) => i.date === d && i.source === "Auto-Draft" && i.role !== "Off")
          .sort((a, b) => (a.rotatorId < b.rotatorId ? -1 : a.rotatorId > b.rotatorId ? 1 : 0));
        for (const donor of donors) {
          // A donor already covering the unmet date would just upsert into
          // their own record — no new coverage. Skip them.
          if (headcount(working, u.date).has(donor.rotatorId)) continue;
          if (excludedSlots.has(`${u.date}|${donor.rotatorId}`)) continue;
          const removed = removeOne(working, donor.rotatorId, d);
          if (!validateDrop(removed, donor.rotatorId, u.date, { avoidContinuity: true }).valid) {
            continue;
          }
          const afterMove = scheduleInpatientAssignment(removed, {
            date: u.date,
            rotatorId: donor.rotatorId,
            role: donor.role || "Resident",
            source: "Auto-Draft"
          });
          const backfills = eligibleFor(afterMove, d, null);
          if (backfills.length === 0) continue;
          backfills.sort(
            (a, b) =>
              loadOf(afterMove, a.id) - loadOf(afterMove, b.id) ||
              (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
          );
          working = scheduleInpatientAssignment(afterMove, {
            date: d,
            rotatorId: backfills[0].id,
            role: backfills[0].role || "Resident",
            source: "Auto-Draft"
          });
          moved = true;
          break;
        }
        if (moved) break;
      }
      if (!moved) break;
      short -= 1;
    }
    if (short > 0) stillUnmet.push({ ...u, short });
  }

  return { proposedState: working, unmet: stillUnmet };
}

export function generateExportManifest(state, precomputed = {}) {
  const block = activeBlock(state);
  const dates = block ? dateRange(block.startDate, block.endDate) : [];
  const conflicts = precomputed.conflicts ?? detectConflicts(state);
  const inpatientCalendar = precomputed.inpatientCalendar ?? buildInpatientCalendar(state, block);
  const outpatientCalendar = precomputed.outpatientCalendar ?? buildOutpatientCalendar(state, block);
  const legend = precomputed.legend ?? generateLegend(state, block);
  const sourceSummary = precomputed.sourceSummary ?? buildSourceSummary(state);
  return {
    exportVersion: 2,
    generatedAt: new Date().toISOString(),
    block: block?.name || "",
    blockId: block?.id || "",
    dateRange: { startDate: block?.startDate || "", endDate: block?.endDate || "" },
    files: [
      { name: "manifest.json", key: "manifest", label: "Export manifest", rows: 1, format: "json" },
      { name: "roster.json", key: "roster", label: "Provider roster", rows: state.rotators.length, format: "json" },
      { name: "roster.csv", key: "rosterCsv", label: "Provider roster CSV", rows: state.rotators.length, format: "csv" },
      { name: "inpatient-calendar.json", key: "inpatientCalendar", label: "Inpatient calendar", rows: inpatientCalendar.length, format: "json" },
      { name: "inpatient-calendar.csv", key: "inpatientCalendarCsv", label: "Inpatient calendar CSV", rows: inpatientCsvRows(inpatientCalendar).length, format: "csv" },
      { name: "outpatient-calendar.json", key: "outpatientCalendar", label: "Outpatient calendar", rows: outpatientCalendar.length, format: "json" },
      { name: "outpatient-calendar.csv", key: "outpatientCalendarCsv", label: "Outpatient calendar CSV", rows: outpatientCsvRows(outpatientCalendar).length, format: "csv" },
      { name: "daily-reports.txt", key: "dailyReports", label: "Daily reports", rows: dates.length, format: "text" },
      { name: "legend.json", key: "legend", label: "Rotator legend", rows: legend.entries.length, format: "json" },
      { name: "legend.csv", key: "legendCsv", label: "Rotator legend CSV", rows: legend.entries.length, format: "csv" },
      { name: "conflicts.json", key: "conflicts", label: "Conflict summary", rows: conflicts.length, format: "json" },
      { name: "conflicts.csv", key: "conflictsCsv", label: "Conflict summary CSV", rows: conflicts.length, format: "csv" },
      {
        name: "source-import-summary.json",
        key: "sourceSummary",
        label: "Source import summary",
        rows: sourceSummary.expectedPrograms.length + sourceSummary.sources.length,
        format: "json"
      },
      {
        name: "source-import-summary.csv",
        key: "sourceSummaryCsv",
        label: "Source import summary CSV",
        rows: sourceSummary.expectedPrograms.length + sourceSummary.sources.length,
        format: "csv"
      },
      { name: "schedule-package.json", key: "schedulePackage", label: "Full scheduler state", rows: 1, format: "json" }
    ]
  };
}

function csvCell(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(csvCell).join(" | ");
  if (typeof value === "object") {
    return Object.keys(value).sort().map((key) => `${key}: ${csvCell(value[key])}`).join("; ");
  }
  return String(value);
}

function csvText(rows, columns) {
  const encode = (value) => {
    const text = csvCell(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => encode(row[column])).join(","))
  ].join("\n") + "\n";
}

function segmentLabel(segment) {
  let label = `${segment?.start || ""} to ${segment?.end || ""}`;
  if (segment?.defaultPhase) label += ` (${segment.defaultPhase})`;
  return label;
}

function buildRosterCsv(state) {
  const rows = (state.rotators || []).map((rotator) => ({
    id: rotator.id,
    fullName: rotator.fullName,
    displayName: rotator.displayName,
    program: rotator.program,
    level: rotator.level,
    role: rotator.role,
    schoolType: rotator.schoolType,
    continuityClinic: rotator.continuityClinic,
    dayOff: rotator.dayOff || [],
    segments: (rotator.segments || []).map(segmentLabel),
    unavailableRanges: (rotator.unavailableRanges || []).map(segmentLabel)
  }));
  return csvText(rows, ["id", "fullName", "displayName", "program", "level", "role", "schoolType", "continuityClinic", "dayOff", "segments", "unavailableRanges"]);
}

function inpatientCsvRows(inpatientCalendar) {
  return (inpatientCalendar || []).flatMap((day) => {
    const assignments = day.assignments || [];
    if (assignments.length === 0) return [{ date: day.date }];
    return assignments.map((assignment) => ({
      date: day.date,
      assignmentId: assignment.id,
      rotatorId: assignment.rotatorId,
      rotatorName: assignment.rotatorName,
      role: assignment.role,
      source: assignment.source
    }));
  });
}

function buildInpatientCalendarCsv(inpatientCalendar) {
  return csvText(inpatientCsvRows(inpatientCalendar), ["date", "assignmentId", "rotatorId", "rotatorName", "role", "source"]);
}

function outpatientCsvRows(outpatientCalendar) {
  return (outpatientCalendar || []).flatMap((day) => {
    const rows = [];
    for (const session of day.sessions || []) {
      rows.push({
        date: day.date,
        kind: "service",
        sessionId: session.id,
        period: session.period,
        clinic: session.clinic,
        provider: session.provider,
        rotatorId: session.rotatorId,
        rotatorName: session.rotatorName,
        status: session.status,
        source: session.source
      });
    }
    for (const assignment of day.clinicAssignments || []) {
      rows.push({
        date: day.date,
        kind: "clinic",
        assignmentId: assignment.id,
        period: assignment.session,
        clinic: assignment.clinicName,
        provider: assignment.attendingName,
        rotatorId: assignment.rotatorId,
        rotatorName: assignment.rotatorName,
        source: assignment.source
      });
    }
    return rows.length > 0 ? rows : [{ date: day.date }];
  });
}

function buildOutpatientCalendarCsv(outpatientCalendar) {
  return csvText(outpatientCsvRows(outpatientCalendar), ["date", "kind", "sessionId", "assignmentId", "period", "clinic", "provider", "rotatorId", "rotatorName", "status", "source"]);
}

function buildLegendCsv(legend) {
  return csvText(legend.entries || [], ["number", "rotatorId", "displayLabel", "dateRange", "continuityClinic"]);
}

function buildConflictsCsv(conflicts) {
  return csvText(conflicts || [], ["id", "type", "severity", "title", "detail", "date", "rotatorId", "status", "assignment", "period"]);
}

function sourceSummaryCsvRows(sourceSummary) {
  return [
    ...(sourceSummary.expectedPrograms || []).map((item) => ({
      kind: "expectedProgram",
      program: item.program,
      status: item.status
    })),
    ...(sourceSummary.sources || []).map((source) => ({
      kind: "source",
      id: source.id,
      fileName: source.fileName,
      fileType: source.fileType,
      program: source.program,
      status: source.status,
      importedAt: source.importedAt,
      importedRotatorCount: source.importedRotatorCount,
      rows: source.rows,
      importWarningCount: source.importWarningCount
    }))
  ];
}

function buildSourceSummaryCsv(sourceSummary) {
  return csvText(sourceSummaryCsvRows(sourceSummary), ["kind", "id", "fileName", "fileType", "program", "status", "importedAt", "importedRotatorCount", "rows", "importWarningCount"]);
}

function rotatorNameForExport(state, rotatorId) {
  const rotator = getRotator(state, rotatorId);
  return rotator?.displayName || rotator?.fullName || rotatorId || "";
}

function withRotatorNameForExport(state, item) {
  return {
    ...item,
    rotatorName: rotatorNameForExport(state, item?.rotatorId)
  };
}

function clinicOccurrenceIdForExport(attendingName, templateId, date, session) {
  return `clinic-occurrence::${slug(attendingName)}::${templateId}::${date}::${session}`;
}

function isRealClinicNameForExport(clinic) {
  const name = String(clinic || "").trim();
  return name.length > 0 && name !== OP_PLACEHOLDER_CLINIC && name !== METHODIST_OP_CLINIC;
}

function effectiveClinicAssignmentsForExport(state, block) {
  const persisted = Array.isArray(state.clinicAssignments) ? state.clinicAssignments : [];
  const startDate = block?.startDate;
  const endDate = block?.endDate;
  const inRange = (date) => (!startDate || date >= startDate) && (!endDate || date <= endDate);
  const seen = new Set(persisted.map((item) => `${item.clinicOccurrenceId}|${item.rotatorId}`));
  const out = persisted.filter((item) => inRange(item.date));

  for (const session of state.outpatientSessions || []) {
    if (!session || !inRange(session.date)) continue;
    if (!isRealClinicNameForExport(session.clinic)) continue;
    if (!session.rotatorId || !session.period) continue;
    const provider = session.provider || "";
    const templateId = `legacy-${slug(session.clinic)}-${slug(provider)}`;
    const clinicOccurrenceId = clinicOccurrenceIdForExport(provider, templateId, session.date, session.period);
    const key = `${clinicOccurrenceId}|${session.rotatorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `legacy-clinic-${slug(session.id || key)}`,
      clinicOccurrenceId,
      rotatorId: session.rotatorId,
      date: session.date,
      session: session.period,
      source: "legacy"
    });
  }

  return out;
}

export function buildInpatientCalendar(state, block = activeBlock(state)) {
  const dates = block ? dateRange(block.startDate, block.endDate) : [];
  return dates.map((date) => ({
    date,
    assignments: (state.inpatientAssignments || [])
      .filter((item) => item.date === date && item.role !== "Off")
      .map((item) => withRotatorNameForExport(state, item))
  }));
}

export function buildOutpatientCalendar(state, block = activeBlock(state)) {
  const dates = block ? dateRange(block.startDate, block.endDate) : [];
  const clinicAssignments = effectiveClinicAssignmentsForExport(state, block);
  return dates.map((date) => ({
    date,
    sessions: (state.outpatientSessions || [])
      .filter((item) => item.date === date)
      .map((item) => withRotatorNameForExport(state, item)),
    clinicAssignments: clinicAssignments
      .filter((item) => item.date === date)
      .map((item) => withRotatorNameForExport(state, item))
  }));
}

export function buildSourceSummary(state) {
  const sources = Array.isArray(state.sources) ? state.sources : [];
  const expectedPrograms = Array.isArray(state.expectedSourcePrograms) ? state.expectedSourcePrograms : [];
  const presentPrograms = new Set(sources.map((source) => source.program).filter(Boolean));
  return {
    expectedPrograms: expectedPrograms.map((program) => ({
      program,
      status: presentPrograms.has(program) ? "present" : "missing"
    })),
    sources: sources.map((source) => ({
      id: source.id,
      fileName: source.fileName,
      fileType: source.fileType,
      program: source.program,
      status: source.status,
      importedAt: source.importedAt,
      importedRotatorCount: source.importedRotatorCount,
      rows: Array.isArray(source.parsedRows) ? source.parsedRows.length : 0,
      importWarningCount: source.importWarningCount ?? (Array.isArray(source.importWarnings) ? source.importWarnings.length : 0)
    }))
  };
}

export function buildExportPackage(state) {
  const block = activeBlock(state);
  const dates = block ? dateRange(block.startDate, block.endDate) : [];
  const reports = dates
    .map((date) => generateDailyReport(state, date))
    .join("\n\n---\n\n");
  const inpatientCalendar = buildInpatientCalendar(state, block);
  const outpatientCalendar = buildOutpatientCalendar(state, block);
  const legend = generateLegend(state, block);
  const conflicts = detectConflicts(state);
  const sourceSummary = buildSourceSummary(state);
  return {
    manifest: generateExportManifest(state, {
      inpatientCalendar,
      outpatientCalendar,
      legend,
      conflicts,
      sourceSummary
    }),
    roster: state.rotators,
    rosterCsv: buildRosterCsv(state),
    inpatientCalendar,
    inpatientCalendarCsv: buildInpatientCalendarCsv(inpatientCalendar),
    outpatientCalendar,
    outpatientCalendarCsv: buildOutpatientCalendarCsv(outpatientCalendar),
    dailyReports: reports,
    legend,
    legendCsv: buildLegendCsv(legend),
    conflicts,
    conflictsCsv: buildConflictsCsv(conflicts),
    sourceSummary,
    sourceSummaryCsv: buildSourceSummaryCsv(sourceSummary),
    schedulePackage: state
  };
}

export function serializeState(state) {
  return JSON.stringify({ ...state, version: STORAGE_VERSION }, null, 2);
}

export function parseState(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed.rotators) || !Array.isArray(parsed.serviceBlocks)) {
    throw new Error("This file doesn't look like a backup from this app. Please choose a backup file you saved here.");
  }
  const merged = { ...createInitialState(), ...parsed, version: STORAGE_VERSION };
  return migrateLoadedState(merged);
}

// One-time, idempotent rotator schema upgrade.
//
// Old shape:   { ..., startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }
// New shape:   { ..., segments: [{start, end}], schoolType: "..." }
//
// Running this twice on the same state must return an equivalent
// rotator each time (idempotent). Legacy rotators with only one of
// startDate/endDate map to an empty segments array (we can't invent
// a missing endpoint); the partial field is discarded.
export function migrateLoadedState(state) {
  if (!state || !Array.isArray(state.rotators)) return state;
  let changed = false;
  const normalizedPsychiatryFellowIds = new Set();
  const nextRotators = state.rotators.map((rotator) => {
    if (!rotator) return rotator;
    let next = rotator;
    if (!Array.isArray(next.segments)) {
      changed = true;
      const segments = (next.startDate && next.endDate)
        ? [{ start: next.startDate, end: next.endDate }]
        : [];
      next = { ...next, segments };
    }
    if (Object.prototype.hasOwnProperty.call(next, "startDate") ||
        Object.prototype.hasOwnProperty.call(next, "endDate")) {
      changed = true;
      next = { ...next };
      delete next.startDate;
      delete next.endDate;
    }
    if (!next.schoolType) {
      changed = true;
      next = { ...next, schoolType: inferSchoolType(next.program) };
    }
    // Older versions promoted PGY-5 rows from mixed Psychiatry/Pedi Neuro
    // workbooks into the Pediatric Neurology Fellow role. Correct that stored
    // data once on load; keep the academic level and opaque IDs unchanged.
    if (
      next.role === "Fellow"
      && String(next.program || "").trim().toLowerCase() === "ut psychiatry"
    ) {
      changed = true;
      normalizedPsychiatryFellowIds.add(next.id);
      next = { ...next, role: "Resident", schoolType: "ut-psychiatry" };
    }
    return next;
  });
  // Add new top-level fields with safe defaults when absent on older
  // persisted state. These are additive — never remove an existing value.
  let next = state;
  if (changed) next = { ...next, rotators: nextRotators };
  if (normalizedPsychiatryFellowIds.size > 0 && Array.isArray(next.inpatientAssignments)) {
    let assignmentsChanged = false;
    const inpatientAssignments = next.inpatientAssignments.map((assignment) => {
      if (
        assignment?.role === "Fellow"
        && normalizedPsychiatryFellowIds.has(assignment.rotatorId)
      ) {
        assignmentsChanged = true;
        return { ...assignment, role: "Resident" };
      }
      return assignment;
    });
    if (assignmentsChanged) {
      next = { ...next, inpatientAssignments };
      changed = true;
    }
  }
  if (!Array.isArray(next.attendings)) {
    // DEFAULT_ATTENDINGS is a string[] — convert each name into a profile
    // matching the lifted-from-string branch below. The previous spread
    // `{ ...a, ... }` over a string threw on `[...undefined]` and the
    // resulting parse failure silently wiped saved state via the
    // try/catch in loadSchedulerState.
    next = {
      ...next,
      attendings: DEFAULT_ATTENDINGS.map((name) => ({
        name,
        recurringClinics: [],
        oneOffDates: []
      }))
    };
    changed = true;
  } else {
    // Lift older string[]-shaped attendings into profile objects.
    // Empty recurringClinics + oneOffDates; Coordinator fills them on
    // the Configuration page.
    const lifted = next.attendings.map((entry) => {
      if (typeof entry === "string") {
        return { name: entry, recurringClinics: [], oneOffDates: [] };
      }
      if (entry && typeof entry === "object") {
        return {
          name: String(entry.name || ""),
          recurringClinics: Array.isArray(entry.recurringClinics) ? entry.recurringClinics : [],
          oneOffDates: Array.isArray(entry.oneOffDates) ? entry.oneOffDates : []
        };
      }
      return null;
    }).filter(Boolean);
    if (lifted.length !== next.attendings.length || lifted.some((p, i) => p !== next.attendings[i])) {
      next = { ...next, attendings: lifted };
      changed = true;
    }
  }
  if (!Array.isArray(next.expectedSourcePrograms)) {
    next = { ...next, expectedSourcePrograms: [...PROGRAMS] };
    changed = true;
  }
  if (!Array.isArray(next.sources)) {
    next = { ...next, sources: [] };
    changed = true;
  } else {
    const normalizedSources = next.sources
      .map((source, index) => normalizeSourceRecord(source, index))
      .filter(Boolean);
    if (
      normalizedSources.length !== next.sources.length ||
      normalizedSources.some((source, index) => source !== next.sources[index])
    ) {
      next = { ...next, sources: normalizedSources };
      changed = true;
    }
  }
  if (!Array.isArray(next.halfDayFacts)) {
    next = { ...next, halfDayFacts: [] };
    changed = true;
  }
  // Backfill clinic-stage placements (2026-05-28 redesign). Additive only —
  // attendings/outpatientSessions are NOT mutated here (clinic selectors
  // tolerate the legacy attending shape and synthesize legacy clinic data on
  // read), keeping the migration surface minimal.
  if (!Array.isArray(next.clinicAssignments)) {
    next = { ...next, clinicAssignments: [] };
    changed = true;
  }
  // Backfill poster metadata (2026-05-28 poster feature). Merge defaults UNDER
  // existing values so a user-edited field always wins, and only rewrite when a
  // default key is actually missing (so a complete posterSettings returns the
  // original reference — same reference-equality discipline as `rules`).
  const existingPoster = (next.posterSettings && typeof next.posterSettings === "object")
    ? next.posterSettings
    : null;
  if (!existingPoster) {
    next = { ...next, posterSettings: { ...DEFAULT_POSTER_SETTINGS } };
    changed = true;
  } else {
    const missingPosterKey = Object.keys(DEFAULT_POSTER_SETTINGS).some(
      (key) => !Object.prototype.hasOwnProperty.call(existingPoster, key)
    );
    if (missingPosterKey) {
      next = { ...next, posterSettings: { ...DEFAULT_POSTER_SETTINGS, ...existingPoster } };
      changed = true;
    }
  }
  // Descend into service blocks: backfill `holidays` to [] when an older
  // block (created before the field existed) lacks it. detectConflicts and
  // coverageDayType read block.holidays, so a missing value would otherwise
  // throw on load (ENG-001). Only `holidays` is read UNGUARDED elsewhere, so
  // it's the only block field backfilled here. Spread the original block so
  // unknown/extra fields (e.g. `coverage`) survive; only add the missing key.
  if (Array.isArray(next.serviceBlocks)) {
    let blocksChanged = false;
    const nextBlocks = next.serviceBlocks.map((block) => {
      if (block && typeof block === "object" && !Array.isArray(block.holidays)) {
        blocksChanged = true;
        return { ...block, holidays: [] };
      }
      return block;
    });
    if (blocksChanged) {
      next = { ...next, serviceBlocks: nextBlocks };
      changed = true;
    }
  }
  // Ensure `state.rules` carries every default key, merging defaults UNDER
  // existing values so a user-set rule (e.g. maxConsecutiveInpatientDays: 9)
  // always wins (HLD-INV-010). maxConsecutiveInpatientDays is read at the
  // consecutive-day cap via optional chaining; a missing key silently
  // disabled the cap (ENG-002). Only rewrite when a default key is actually
  // missing, so a complete `rules` object returns the original reference.
  const existingRules = (next.rules && typeof next.rules === "object") ? next.rules : {};
  const missingRuleKey = Object.keys(DEFAULT_RULES).some(
    (key) => !Object.prototype.hasOwnProperty.call(existingRules, key)
  );
  if (missingRuleKey) {
    next = { ...next, rules: { ...DEFAULT_RULES, ...existingRules } };
    changed = true;
  }
  return changed ? next : state;
}

/**
 * Returns attending profiles whose recurring pattern or one-off dates
 * include the given (date, period). Used by the Outpatient form to
 * narrow the attending dropdown to people actually available for that
 * slot.
 *
 * If period is null/undefined, returns attendings available in EITHER
 * AM or PM on that date.
 */
export function attendingsAvailableOn(state, dateStr, period = null) {
  if (!state || !dateStr) return [];
  const attendings = Array.isArray(state.attendings) ? state.attendings : [];
  const weekday = weekdayName(dateStr);
  return attendings.filter((a) => {
    if (!a) return false;
    const recurring = Array.isArray(a.recurringClinics) ? a.recurringClinics : [];
    const oneOffs = Array.isArray(a.oneOffDates) ? a.oneOffDates : [];
    const recurringMatch = recurring.some((slot) =>
      slot && slot.weekday === weekday && (!period || slot.period === period)
    );
    if (recurringMatch) return true;
    const oneOffMatch = oneOffs.some((slot) =>
      slot && slot.date === dateStr && (!period || slot.period === period)
    );
    return oneOffMatch;
  });
}

/**
 * Replace the attendings list. Empty list is allowed (user can clear it
 * intentionally), but the array structure is required.
 */
export function setAttendings(state, attendings) {
  return { ...state, attendings: Array.isArray(attendings) ? attendings : [] };
}

export function setExpectedSourcePrograms(state, programs) {
  return { ...state, expectedSourcePrograms: Array.isArray(programs) ? programs : [] };
}

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
];

/**
 * Parse a continuity-clinic free-text label (e.g. "Tuesday PM") into a
 * structured { weekday, period } pair. Returns null when the string is
 * empty, malformed, or doesn't include both a recognizable weekday and
 * a recognizable AM/PM marker. Case- and whitespace-insensitive;
 * tolerates either ordering (e.g. "PM Tuesday").
 */
export function parseContinuityClinic(str) {
  if (typeof str !== "string") return null;
  const cleaned = str.trim().toLowerCase();
  if (!cleaned) return null;

  const tokens = cleaned.split(/[\s,/\-]+/).filter(Boolean);
  let weekday = null;
  let period = null;

  for (const token of tokens) {
    if (!weekday) {
      const match = WEEKDAY_NAMES.find((name) => name === token || (token.length >= 3 && name.startsWith(token)));
      if (match) {
        weekday = match.charAt(0).toUpperCase() + match.slice(1);
        continue;
      }
    }
    if (!period) {
      if (token === "am" || token === "a.m." || token === "morning") period = "AM";
      else if (token === "pm" || token === "p.m." || token === "afternoon") period = "PM";
    }
  }

  if (!weekday || !period) return null;
  return { weekday, period };
}

/**
 * Parse a continuity-clinic label that may carry MULTIPLE slots
 * (contract §1e, Coordinator #1) into an array of { weekday, period } pairs.
 * Slots are separated by commas or the word "and" (case-insensitive);
 * each chunk is parsed with the existing single-slot parseContinuityClinic
 * so the per-slot token logic (weekday/period detection, ordering
 * tolerance) stays identical. Unparseable chunks are dropped. Results are
 * deduped by `${weekday}|${period}` and kept in first-seen order.
 *
 * e.g. "Tuesday PM, Thursday AM" -> [{Tuesday,PM},{Thursday,AM}].
 */
export function parseContinuityClinicSlots(str) {
  if (typeof str !== "string") return [];
  const chunks = str.split(/\s*,\s*|\s+and\s+/i).filter((c) => c.trim());
  const slots = [];
  const seen = new Set();
  for (const chunk of chunks) {
    const parsed = parseContinuityClinic(chunk);
    if (!parsed) continue;
    const key = `${parsed.weekday}|${parsed.period}`;
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push(parsed);
  }
  return slots;
}

export function continuityPeriodsForWeekday(value, weekday) {
  const target = String(weekday || "").trim().toLowerCase();
  return new Set(
    parseContinuityClinicSlots(value)
      .filter((slot) => slot.weekday.toLowerCase() === target)
      .map((slot) => slot.period)
  );
}

function isHalfDayContinuityPulloutFact(fact) {
  if (!fact || typeof fact !== "object") return false;
  const status = String(fact.status || "").trim().toUpperCase();
  if (["OP", "OFF", "UNAVAILABLE"].includes(status)) return true;
  const text = [
    fact.kind,
    fact.label,
    fact.source,
    fact.sourceText
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return /\b(continuity|clinic|ahd|op|off)\b/.test(text);
}

function hasHalfDayContinuityPulloutFact(state, rotatorId, date, period) {
  return (state?.halfDayFacts || []).some((fact) => (
    fact?.date === date
    && fact?.rotatorId === rotatorId
    && fact?.period === period
    && isHalfDayContinuityPulloutFact(fact)
  ));
}

function continuityPeriodsNeedingWholeDayWarning(state, rotator, date) {
  const periods = continuityPeriodsForWeekday(rotator?.continuityClinic, weekdayName(date));
  if (periods.size === 0) return periods;
  // Two continuity half-days amount to a whole-day commitment; keep the
  // original whole-day inpatient block/warning even if imported facts exist.
  if (periods.has("AM") && periods.has("PM")) return periods;
  const unresolved = new Set();
  for (const period of periods) {
    if (!hasHalfDayContinuityPulloutFact(state, rotator?.id, date, period)) {
      unresolved.add(period);
    }
  }
  return unresolved;
}

/**
 * Canonical serializer for a list of continuity-clinic slots (contract
 * §1e). Produces the comma-joined canonical string, e.g.
 * "Tuesday PM, Thursday AM". Empty/invalid input → "". Round-trip
 * invariant: for canonical input s, formatContinuityClinicSlots(
 * parseContinuityClinicSlots(s)) === s; and parseContinuityClinicSlots(
 * formatContinuityClinicSlots(x)) deep-equals x for valid x.
 */
export function formatContinuityClinicSlots(slots) {
  if (!Array.isArray(slots)) return "";
  return slots
    .filter((s) => s && s.weekday && s.period)
    .map((s) => `${s.weekday} ${s.period}`)
    .join(", ");
}

/**
 * For a given ISO date (yyyy-mm-dd), return the continuity-clinic
 * commitments that fall on that day for any rotator whose block window
 * covers it. Grouped by period so the calendar can render AM and PM
 * hints separately.
 */
export function continuityClinicsForDate(state, date) {
  const target = new Date(`${date}T00:00:00`);
  const buckets = { AM: [], PM: [] };
  if (Number.isNaN(target.getTime())) return buckets;
  const weekday = WEEKDAY_NAMES[target.getDay()];

  for (const rotator of state.rotators || []) {
    const slots = parseContinuityClinicSlots(rotator.continuityClinic);
    if (slots.length === 0) continue;
    const matchingPeriods = slots
      .filter((s) => s.weekday.toLowerCase() === weekday)
      .map((s) => s.period);
    if (matchingPeriods.length === 0) continue;
    // A rotator only counts toward continuity clinics on dates inside
    // one of their segments. Rotators with no segments are skipped so
    // brand-new entries don't accidentally inflate clinic coverage.
    if (!Array.isArray(rotator.segments) || rotator.segments.length === 0) continue;
    if (!isRotatorActiveOn(rotator, date)) continue;
    // A rotator with both AM and PM slots on the same weekday counts in
    // both buckets.
    for (const period of new Set(matchingPeriods)) {
      buckets[period].push(rotator);
    }
  }

  return buckets;
}

export function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "item";
}

// ============================================================================
// Sub-team B additions — Program-specific scheduling rules
//
// Spec references:
//   §8     External Schedule Sources
//   §9.1   Methodist Adult Neurology Rule (28-day: 14 outpatient + 14 inpatient)
//   §9.2   Psychiatry Rule (use actual dates)
//   §9.3   Pediatrics Resident Rule (use actual dates)
//   §9.4   UT Houston Adult Neurology Rule (short ranges within block)
//   §9.5   Medical Student Rule (preserve predetermined assignment)
//   §14.2  Assignment Algorithm (Methodist branch)
//   §14.3  Inpatient Generation Algorithm
//   §25.3  Methodist Rule acceptance criterion
//   §25.4  Cross-Block Continuity acceptance criterion
//
// These functions read the extended rotator schema (segments, schoolType,
// rotationStartDate) defined in SHARED_CONTRACT.md. They tolerate the
// pre-contract shape (startDate/endDate, missing schoolType) so they can
// run on un-migrated data and stay green on this branch before ST-A's
// schema migration is merged in.
// ============================================================================

const METHODIST_ROTATION_LENGTH_DAYS = 28;
const METHODIST_OUTPATIENT_DAYS = 14;
// Days 0..13 of the rotator's own 28-day rotation are outpatient.
// Days 14..27 are inpatient. Day 14 is the first inpatient day.

/**
 * Compute the number of whole calendar days between two ISO date strings
 * (yyyy-mm-dd). Result is `to - from`; negative when `to` precedes
 * `from`. Returns null if either date is missing or unparseable.
 * Constructs both dates at local midnight (`T00:00:00`) and uses
 * Math.round to absorb the ±1-hour shift on DST transition days, so the
 * result is stable across timezone configs.
 */
function daysBetween(fromStr, toStr) {
  if (!fromStr || !toStr) return null;
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

// Use ST-A's canonical classifier from earlier in this file. Honors an
// explicit rotator.schoolType when present (so manually-set classifications
// stick) and falls back to inferring from the program name.
function classifyRotator(rotator) {
  if (!rotator) return "other";
  if (rotator.schoolType) return rotator.schoolType;
  return inferSchoolType(rotator.program);
}

/**
 * Resolve a Methodist rotator's effective rotation window (Coordinator,
 * 2026-07-10): an explicit `rotationStartDate` always wins; without one the
 * rotator's first scheduled day (earliest segment start) is day 1. Rotations
 * shorter than 28 days split in half — a 26-day block is 13/13, an odd length
 * puts the extra day on the first side — while spans of 28+ keep the
 * historical 14/14 fortnights.
 *
 * Returns { start, cycle, half, derived } or null when the rotator is not
 * Methodist or no start is resolvable (no rotationStartDate AND no segments).
 * `derived` is true when the start came from segments rather than an explicit
 * rotationStartDate — report checks use it to surface the assumption.
 */
export function methodistRotationWindow(rotator) {
  if (!rotator || classifyRotator(rotator) !== "methodist") return null;
  const segments = Array.isArray(rotator.segments)
    ? rotator.segments.filter((s) => s && s.start && s.end)
    : [];
  const segmentStarts = segments.map((s) => s.start).sort();
  const start = rotator.rotationStartDate || segmentStarts[0] || rotator.startDate || null;
  if (!start) return null;
  const segmentEnds = segments.map((s) => s.end).sort();
  const lastEnd = segmentEnds[segmentEnds.length - 1] || rotator.endDate || null;
  let cycle = METHODIST_ROTATION_LENGTH_DAYS;
  if (lastEnd) {
    const span = daysBetween(start, lastEnd);
    if (span !== null && span >= 0) {
      cycle = Math.min(METHODIST_ROTATION_LENGTH_DAYS, span + 1);
    }
  }
  return {
    start,
    cycle,
    half: Math.ceil(cycle / 2),
    derived: !rotator.rotationStartDate
  };
}

/**
 * Inline segment-active check. Returns true when dateStr falls inside
 * any { start, end } segment on the rotator. Falls back to the legacy
 * startDate/endDate window when segments is absent — so this stays
 * correct on both pre- and post-migration data.
 *
 * Intentionally does NOT call ST-A's `isRotatorActiveOn` so tests on
 * this sub-team's branch pass before the ST-A merge.
 */
function rotatorActiveOnInline(rotator, dateStr) {
  if (!rotator || !dateStr) return false;
  const segments = Array.isArray(rotator.segments) ? rotator.segments : null;
  if (segments && segments.length > 0) {
    return segments.some(
      (segment) =>
        segment &&
        segment.start &&
        segment.end &&
        dateStr >= segment.start &&
        dateStr <= segment.end
    );
  }
  // Legacy single-window fallback.
  if (rotator.startDate && rotator.endDate) {
    return dateStr >= rotator.startDate && dateStr <= rotator.endDate;
  }
  return false;
}

/**
 * For a Methodist rotator with a known `rotationStartDate`, return
 * "outpatient" for days 0–13 of their 28-day rotation and "inpatient"
 * for days 14–27. Outside [day 0, day 27] returns null. For any
 * non-methodist rotator, or a methodist rotator missing
 * `rotationStartDate`, returns null — the manual assignment flow stays
 * in charge.
 *
 * Spec §9.1 worked example:
 *   rotationStartDate = "2026-05-20"  (day 0, outpatient)
 *   "2026-06-02"  → day 13, outpatient
 *   "2026-06-03"  → day 14, inpatient  (boundary)
 *   "2026-06-16"  → day 27, inpatient  (last day)
 *   "2026-06-17"  → day 28, null       (rotation ended)
 *   "2026-05-19"  → day -1, null       (before rotation)
 */
export function getRotatorPhase(rotator, dateStr) {
  if (!rotator || !dateStr) return null;
  // Coordinator 2026-07-10: the window resolves a derived start (first scheduled
  // day) when rotationStartDate is unset, and shrinks the split for rotations
  // shorter than 28 days (26-day block → 13/13). See methodistRotationWindow.
  const window = methodistRotationWindow(rotator);
  if (!window) return null;
  const dayIndex = daysBetween(window.start, dateStr);
  if (dayIndex === null) return null;
  if (dayIndex < 0 || dayIndex >= window.cycle) return null;
  // Rule 5b (Coordinator): the start side is normally outpatient-first (spec §9.1
  // worked example), but a staffing-driven choice can flip it. The choice is
  // persisted on the rotator as `methodistStartSide` ("inpatient" |
  // "outpatient") — set by the user or by chooseMethodistStartSide during
  // generateDraft. Absent/unknown values keep the historical OP-first split.
  const inpatientFirst = rotator.methodistStartSide === "inpatient";
  if (dayIndex < window.half) {
    return inpatientFirst ? "inpatient" : "outpatient";
  }
  return inpatientFirst ? "outpatient" : "inpatient";
}

/**
 * Rule 5b — staffing-driven Methodist start side. Put the inpatient
 * fortnight on whichever half of the rotator's own 28-day rotation has MORE
 * days inside the block (maximizes hospital coverage the block can actually
 * see). Tie — including the common full-overlap case — keeps the spec §9.1
 * outpatient-first default, so fully-contained rotations never change
 * behavior. Pure function of (rotator dates, block dates) only, so the
 * choice is stable across re-runs (generateDraft stays idempotent).
 */
export function chooseMethodistStartSide(rotator, block) {
  const window = methodistRotationWindow(rotator);
  if (!window || !block?.startDate || !block?.endDate) return "outpatient";
  const daysInBlock = (offset, length) => {
    let n = 0;
    for (let i = 0; i < length; i += 1) {
      const d = addDaysToIso(window.start, offset + i);
      if (d >= block.startDate && d <= block.endDate) n += 1;
    }
    return n;
  };
  return daysInBlock(0, window.half) > daysInBlock(window.half, window.cycle - window.half)
    ? "inpatient"
    : "outpatient";
}

/**
 * Walk every Methodist rotator with a known rotationStartDate and add
 * inpatient/outpatient assignments to the state for any dates that
 * fall within the given pedi service block AND within their own 28-day
 * rotation window AND within their segments.
 *
 * Idempotent: an assignment is added only if no entry with the same
 * (date, rotatorId, role) tuple already exists, so re-running on the
 * same state is a no-op and pre-existing manual entries are preserved
 * unchanged. Auto-added entries are tagged `source: "Auto-Methodist"`
 * to distinguish them from manual entries (`source: "Manual"`).
 *
 * Spec refs: §9.1 (Methodist 28-day rule), §14.2 (Methodist branch of
 * assignment algorithm), §25.3 / §25.4 (cross-block continuity).
 */
/**
 * Per-segment pre-assignment lookup. Returns the segment.defaultPhase
 * for the segment that contains dateStr, or null if no such segment
 * exists or no phase is set on it.
 *
 * Pre-assignments are stored on the segment itself:
 *   { start: "YYYY-MM-DD", end: "YYYY-MM-DD", defaultPhase?: "outpatient" | "inpatient" }
 *
 * Semantics ratified by Coordinator (2026-05-20, option c):
 *   - The phase value RESTRICTS the rotator's availability — dropdowns
 *     for the opposite phase exclude them on those dates
 *   - The phase value also AUTO-FILLS placeholder sessions on the
 *     calendar (via applyPreassignments below) when the block is opened
 */
export function getRotatorSegmentPhase(rotator, dateStr) {
  if (!rotator || !dateStr) return null;
  const segments = Array.isArray(rotator.segments) ? rotator.segments : [];
  for (const seg of segments) {
    if (!seg?.start || !seg?.end) continue;
    if (dateStr < seg.start || dateStr > seg.end) continue;
    if (seg.defaultPhase === "outpatient" || seg.defaultPhase === "inpatient") {
      return seg.defaultPhase;
    }
    return null;
  }
  return null;
}

/**
 * Apply user-marked per-segment pre-assignments across the given block.
 * For each rotator + segment with defaultPhase set, walks the weekdays
 * in the (block ∩ segment) overlap and creates placeholder inpatient
 * assignments or outpatient sessions tagged `source: "Auto-Preassigned"`.
 * Idempotent — never overwrites existing records on the same date for
 * the same rotator. Continuity-clinic AM/PM preservation matches the
 * Methodist auto-assign (skips the period that overlaps a known
 * continuity clinic on that weekday).
 *
 * Returns the same state reference when no new records would be added.
 */
export function applyPreassignments(state, block) {
  if (!state || !block) return state;
  const blockDates = dateRange(block.startDate, block.endDate);
  if (blockDates.length === 0) return state;

  // Outpatient clinic is closed on no-clinic holidays (contract §6 / §1d).
  // The OP-placeholder branch below skips these dates, matching the paint path
  // (applyRangeAssignment) and applyMethodistAutoAssign. Preassigned inpatient
  // is not skipped on holidays — hospital coverage runs 24/7.
  const noClinicHolidays = new Set(
    (block.holidays || []).filter((h) => h && h.noClinic).map((h) => h.date)
  );

  // Slot-identity keys: any existing record for (date, rotator) blocks an
  // inpatient add; any existing record for (date, rotator, period) blocks
  // an outpatient add. Previously these keys included role / clinic, so
  // running this together with applyMethodistAutoAssign — which writes a
  // different clinic string ("Methodist Outpatient" vs the generic OP
  // placeholder) — created
  // duplicate OP records for the same slot. Same applied if a manual IP
  // entry used a different role than rotator.role: Methodist would add
  // a second IP record alongside it. Slot-identity dedupe matches the
  // visible calendar model (one record per cell) and lets manual entries
  // always win.
  const existingInpatient = new Set(
    (state.inpatientAssignments || []).map(
      (item) => `${item.date}|${item.rotatorId}`
    )
  );
  const existingOutpatient = new Set(
    (state.outpatientSessions || []).map(
      (item) => `${item.date}|${item.rotatorId}|${item.period}`
    )
  );

  const newInpatient = [];
  const newOutpatient = [];

  for (const rotator of state.rotators || []) {
    const segments = Array.isArray(rotator.segments) ? rotator.segments : [];
    for (const seg of segments) {
      if (!seg?.start || !seg?.end) continue;
      const phase = seg.defaultPhase;
      if (phase !== "outpatient" && phase !== "inpatient") continue;

      for (const date of blockDates) {
        if (date < seg.start || date > seg.end) continue;
        const weekday = weekdayName(date);
        if (weekday === "Saturday" || weekday === "Sunday") continue;

        if (phase === "inpatient") {
          const role = coverageRoleForRotator(rotator);
          const key = `${date}|${rotator.id}`;
          if (existingInpatient.has(key)) continue;
          existingInpatient.add(key);
          newInpatient.push({
            id: `in-pre-${date}-${rotator.id}`.replaceAll(" ", "-").toLowerCase(),
            date,
            rotatorId: rotator.id,
            role,
            source: "Auto-Preassigned"
          });
        } else {
          // No outpatient clinic on no-clinic holidays (preassigned inpatient
          // above still fires for those dates — hospital coverage is 24/7).
          if (noClinicHolidays.has(date)) continue;
          const continuityPeriods = continuityPeriodsForWeekday(rotator.continuityClinic, weekday);
          const periods = ["AM", "PM"].filter((p) => !continuityPeriods.has(p));
          for (const period of periods) {
            const clinic = OP_PLACEHOLDER_CLINIC;
            const key = `${date}|${rotator.id}|${period}`;
            if (existingOutpatient.has(key)) continue;
            existingOutpatient.add(key);
            newOutpatient.push({
              id: `out-pre-${date}-${period}-${rotator.id}`.toLowerCase(),
              date,
              period,
              clinic,
              provider: "",
              rotatorId: rotator.id,
              status: "Scheduled",
              source: "Auto-Preassigned"
            });
          }
        }
      }
    }
  }

  if (newInpatient.length === 0 && newOutpatient.length === 0) return state;
  return {
    ...state,
    inpatientAssignments: [...(state.inpatientAssignments || []), ...newInpatient],
    outpatientSessions: [...(state.outpatientSessions || []), ...newOutpatient]
  };
}

/**
 * Shared iteration plan used by both previewRangeAssignment (for toast
 * text) and applyRangeAssignment (for the actual mutation). Returns the
 * dates that will be touched, the dates inside the requested range that
 * were rejected (rotator absent or unavailable), and the clamped bounds.
 */
function computeRangePlan(state, block, args) {
  const result = {
    rotator: null,
    applyDates: [],
    skippedDates: [],
    clampedStart: null,
    clampedEnd: null,
    wasClamped: false
  };
  if (!state || !block || !args) return result;
  if (!args.rotatorId || !args.startDate || !args.endDate) return result;
  if (!block.startDate || !block.endDate) return result;

  const rotator = (state.rotators || []).find((r) => r.id === args.rotatorId);
  if (!rotator) return result;
  result.rotator = rotator;

  const clampedStart = args.startDate < block.startDate ? block.startDate : args.startDate;
  const clampedEnd = args.endDate > block.endDate ? block.endDate : args.endDate;
  if (clampedStart > clampedEnd) return result;
  result.clampedStart = clampedStart;
  result.clampedEnd = clampedEnd;
  result.wasClamped = clampedStart !== args.startDate || clampedEnd !== args.endDate;

  // Days that already carry an IP/OP record for this rotator stay paintable
  // even when the profile marks them unavailable — the grid renders the
  // existing record as a normal cell, and visible cells must be settable
  // (repainting is how a stale assignment on a now-unavailable day gets
  // corrected). Brand-new assignments on unavailable days are still skipped.
  const assignedDates = new Set([
    ...(state.inpatientAssignments || [])
      .filter((item) => item.rotatorId === args.rotatorId)
      .map((item) => item.date),
    ...(state.outpatientSessions || [])
      .filter((item) => item.rotatorId === args.rotatorId)
      .map((item) => item.date)
  ]);

  for (const date of dateRange(clampedStart, clampedEnd)) {
    if (!isRotatorActiveOn(rotator, date)) {
      result.skippedDates.push(date);
      continue;
    }
    if (isRotatorUnavailable(rotator, date) && !assignedDates.has(date)) {
      result.skippedDates.push(date);
      continue;
    }
    result.applyDates.push(date);
  }
  return result;
}

/**
 * Preview what applyRangeAssignment would do without mutating state.
 * Used by the planning-grid's range-assign form to compose the toast text
 * (applied count, skipped count, clamp note) before committing.
 */
export function previewRangeAssignment(state, block, args) {
  return computeRangePlan(state, block, args);
}

/**
 * Non-mutating profile-override assessment (contract §1c, Coordinator #2).
 *
 * For each date the assignment would touch (the SAME applyDates that
 * applyRangeAssignment uses, via computeRangePlan), compare the
 * rotator's per-segment pre-assign signal (segment.defaultPhase, read
 * via getRotatorSegmentPhase) against the phase the user is attempting.
 * When the profile has a non-null phase that differs from the attempted
 * phase, emit a warn-and-allow warning so the UI (B) can show a toast +
 * persistent cell badge. The caller applies anyway — this does NOT block.
 *
 * attemptedPhase is args.phase verbatim ("inpatient"|"outpatient"|"off"|
 * "clear"). Because profilePhase is only ever "inpatient"|"outpatient",
 * a non-null profile naturally contradicts "off" and "clear" too.
 * Null defaultPhase → no warning for that date.
 *
 * Returns { warnings: [{ rotatorId, date, kind:"profile-override",
 *   profilePhase, attemptedPhase, message }] }.
 */
export function assessRangeAssignment(state, block, args) {
  const warnings = [];
  if (!state || !args) return { warnings };
  const plan = computeRangePlan(state, block, args);
  const rotator = plan.rotator;
  if (!rotator || plan.applyDates.length === 0) return { warnings };

  const attemptedPhase = args.phase;
  for (const date of plan.applyDates) {
    const profilePhase = getRotatorSegmentPhase(rotator, date);
    if (profilePhase == null) continue;
    if (profilePhase === attemptedPhase) continue;
    warnings.push({
      rotatorId: rotator.id,
      date,
      kind: "profile-override",
      profilePhase,
      attemptedPhase,
      message: `${rotator.displayName ?? "Rotator"} is pre-assigned ${profilePhase} on ${date} by their rotation profile; this ${attemptedPhase} paint overrides it.`
    });
  }
  return { warnings };
}

/**
 * Apply an explicit "set this rotator to IP / OP / clear" intent across a
 * date range. Writes ONLY to inpatientAssignments and outpatientSessions —
 * never touches segments or defaultPhase. This is the planning-grid's
 * range-assign action (Coordinator's "I can assign them inpatient or
 * outpatient by date range" ask); mid-segment phase changes flow through
 * this helper rather than splitting segments.
 *
 * Behavior per phase, for each in-range, active, available date:
 *   - "inpatient": strip ALL existing IP and OP records for that rotator
 *     + date, then add ONE IP record with the chosen role (default
 *     comes from rotator.role; falls back to "Resident"). Mutual
 *     exclusion is intentional — a day can't be both IP and OP.
 *   - "outpatient": strip existing IP records for the rotator in range
 *     (IP/OP mutual exclusion still holds), but OP records are MERGED
 *     using slot-identity dedupe: any (rotatorId, date, period) cell
 *     that already has an OP record (e.g. a manually-added Continuity
 *     Clinic) is left untouched; empty cells get the generic OP
 *     placeholder. This matches applyMethodistAutoAssign +
 *     applyPreassignments — re-running range-assign over a date range
 *     that's already been hand-tuned no longer wipes those edits.
 *     Saturdays / Sundays AND noClinic holidays are skipped (no weekend
 *     or no-clinic-holiday outpatient clinics — contract §6 / §1d). The
 *     continuity-clinic period on the weekday is also skipped (the
 *     clinic commitment wins).
 *   - "clear": strip both IP and OP for the rotator in range; no
 *     additions. True blank slate.
 *   - "off" (#7): strip both IP (incl. existing role:"Off") and OP in
 *     range, then add ONE inpatient record per date with role:"Off",
 *     source:"Range-Assigned". OFF is stored as a role:"Off" inpatient
 *     record (contract §1a) — the coverage loop excludes it, and the
 *     same-day strip guarantees OFF⊻IP⊻OP exclusivity.
 *
 * Out-of-block dates are silently clamped to block.startDate / endDate.
 * Days where isRotatorActiveOn is false (no segment covers the date) or
 * isRotatorUnavailable returns a reason (dayOff / unavailableRanges) are
 * skipped silently — same filter buildPlanningGrid uses to render the
 * "absent" / "off" cells, so what the user can SEE is what they can SET.
 *
 * Returns the same state reference (===) when the request would produce
 * no mutation (empty applyDates or invalid phase), so callers can detect
 * no-ops.
 */
export function applyRangeAssignment(state, block, args) {
  if (!state || !args) return state;
  const phase = args.phase;
  if (
    phase !== "inpatient" &&
    phase !== "outpatient" &&
    phase !== "clear" &&
    phase !== "off"
  ) {
    return state;
  }

  const plan = computeRangePlan(state, block, args);
  if (plan.applyDates.length === 0) return state;

  const applySet = new Set(plan.applyDates);
  const rotatorId = args.rotatorId;
  const rotator = (state.rotators || []).find((r) => r.id === rotatorId);
  const role = args.role || coverageRoleForRotator(rotator);
  // Generic placeholder when the caller didn't name a clinic (range-assign /
  // pre-assignment). Display-only; see OP_PLACEHOLDER_CLINIC.
  const clinic = args.clinic ?? OP_PLACEHOLDER_CLINIC;

  // Default behavior: strip rotator's IP + OP records in range. OP phase
  // overrides the OP strip below because OP→OP transitions should be
  // additive (preserves Continuity Clinic edits the user made on top of
  // a coarse range-assign mark).
  let nextIp = (state.inpatientAssignments || []).filter(
    (item) => !(item.rotatorId === rotatorId && applySet.has(item.date))
  );
  let nextOp = (state.outpatientSessions || []).filter(
    (item) => !(item.rotatorId === rotatorId && applySet.has(item.date))
  );

  if (phase === "inpatient") {
    for (const date of plan.applyDates) {
      nextIp.push({
        id: `in-range-${date}-${rotatorId}-${role}`.replaceAll(" ", "-").toLowerCase(),
        date,
        rotatorId,
        role,
        source: "Range-Assigned"
      });
    }
  } else if (phase === "outpatient") {
    // Restore the OP records we just stripped — OP phase is additive.
    // IP strip stays (IP/OP mutual exclusion still applies on the same day).
    nextOp = state.outpatientSessions || [];
    // OP is blocked on weekends AND noClinic holidays (contract §6 / §1d:
    // noClinic suppresses OUTPATIENT clinic). Reuse the same defensive
    // holiday read as coverageDayType / detectConflicts (`block?.holidays
    // || []` + `noClinic` flag) so section-header drops can't write OP
    // sessions onto a no-clinic holiday.
    const noClinicHolidays = new Set(
      (block?.holidays || []).filter((h) => h.noClinic).map((h) => h.date)
    );
    const existingOpSlots = new Set(
      nextOp
        .filter((item) => item.rotatorId === rotatorId)
        .map((item) => `${item.date}|${item.period}`)
    );
    const additions = [];
    for (const date of plan.applyDates) {
      const weekday = weekdayName(date);
      if (weekday === "Saturday" || weekday === "Sunday") continue;
      if (noClinicHolidays.has(date)) continue;
      const continuityPeriods = continuityPeriodsForWeekday(rotator?.continuityClinic, weekday);
      const periods = ["AM", "PM"].filter((p) => !continuityPeriods.has(p));
      for (const p of periods) {
        const key = `${date}|${p}`;
        if (existingOpSlots.has(key)) continue;
        existingOpSlots.add(key);
        additions.push({
          id: `out-range-${date}-${p}-${rotatorId}`.toLowerCase(),
          date,
          period: p,
          clinic,
          provider: "",
          rotatorId,
          status: "Scheduled",
          source: "Range-Assigned"
        });
      }
    }
    nextOp = [...nextOp, ...additions];
  } else if (phase === "off") {
    // OFF (#7): the unconditional IP+OP strip above already removed any
    // prior IP (incl. role:"Off") and OP records for this rotator in range,
    // enforcing OFF⊻IP⊻OP same-day exclusivity. Push one role:"Off"
    // inpatient record per in-range date. Readers (buildPlanningGrid,
    // coverage loop, classifyAssignmentRole) already understand role:"Off".
    for (const date of plan.applyDates) {
      nextIp.push({
        id: `off-${date}-${rotatorId}`.replaceAll(" ", "-").toLowerCase(),
        date,
        rotatorId,
        role: "Off",
        source: "Range-Assigned"
      });
    }
  }
  // For "clear", nextIp / nextOp already had the rotator's range stripped.

  return { ...state, inpatientAssignments: nextIp, outpatientSessions: nextOp };
}

export function applyMethodistAutoAssign(state, block) {
  if (!state || !block) return state;
  const blockDates = dateRange(block.startDate, block.endDate);
  if (blockDates.length === 0) return state;

  // Outpatient clinic is closed on no-clinic holidays (contract §6 / §1d:
  // noClinic suppresses OUTPATIENT clinic). The OP-placeholder branch below
  // skips these dates, mirroring applyRangeAssignment's paint path. Inpatient
  // is NOT skipped — hospital coverage runs 24/7 on holidays.
  const noClinicHolidays = new Set(
    (block.holidays || []).filter((h) => h && h.noClinic).map((h) => h.date)
  );

  // Slot-identity keys — same rationale as applyPreassignments above. A
  // manual IP entry with role="Team senior" plus rotator.role="Resident"
  // used to produce two IP records on the same day; now Methodist auto
  // skips the slot entirely if any IP record already exists there.
  const existingInpatient = new Set(
    (state.inpatientAssignments || []).map(
      (item) => `${item.date}|${item.rotatorId}`
    )
  );
  const existingOutpatient = new Set(
    (state.outpatientSessions || []).map(
      (item) => `${item.date}|${item.rotatorId}|${item.period}`
    )
  );

  const newInpatient = [];
  const newOutpatient = [];

  for (const rotator of state.rotators || []) {
    if (classifyRotator(rotator) !== "methodist") continue;
    if (!methodistRotationWindow(rotator)) continue;

    for (const date of blockDates) {
      const phase = getRotatorPhase(rotator, date);
      if (!phase) continue;
      if (!rotatorActiveOnInline(rotator, date)) continue;

      if (phase === "inpatient") {
        const role = coverageRoleForRotator(rotator);
        const key = `${date}|${rotator.id}`;
        if (existingInpatient.has(key)) continue;
        existingInpatient.add(key);
        newInpatient.push({
          id: `in-auto-${date}-${rotator.id}`.replaceAll(" ", "-").toLowerCase(),
          date,
          rotatorId: rotator.id,
          role,
          source: "Auto-Methodist"
        });
      } else {
        // Methodist outpatient days are auto-recorded as a full-day
        // "Methodist Outpatient" placeholder. We register both AM and
        // PM so downstream calendar logic can render either column;
        // each is idempotent per (date, rotator, period).
        //
        // Skip Saturdays / Sundays — outpatient clinics don't run on
        // weekends, so an OP placeholder there is clinically
        // nonsensical and noisy in the planning grid. Inpatient
        // Methodist days are NOT skipped on weekends (the IP branch
        // above still fires) because hospital coverage runs 24/7.
        //
        // BUT: if the rotator already has a continuity-clinic
        // commitment in a given AM/PM session on that weekday, leave
        // that period alone — the continuity-clinic commitment wins,
        // and the auto-rule must not double-book over it. This
        // preserves spec §15.2 ("A rotator in continuity clinic cannot
        // be assigned elsewhere during the same session unless
        // approved") by construction at write time, rather than
        // leaving it to the conflict detector to flag every Tuesday.
        const dateWeekday = weekdayName(date);
        if (dateWeekday === "Saturday" || dateWeekday === "Sunday") continue;
        // No outpatient clinic on no-clinic holidays (the IP branch above still
        // fires for those dates — hospital coverage is 24/7).
        if (noClinicHolidays.has(date)) continue;
        const continuityPeriods = continuityPeriodsForWeekday(rotator.continuityClinic, dateWeekday);
        const periods = ["AM", "PM"].filter((period) => !continuityPeriods.has(period));
        for (const period of periods) {
          const clinic = METHODIST_OP_CLINIC;
          const key = `${date}|${rotator.id}|${period}`;
          if (existingOutpatient.has(key)) continue;
          existingOutpatient.add(key);
          newOutpatient.push({
            id: `out-auto-${date}-${period}-${rotator.id}`.toLowerCase(),
            date,
            period,
            clinic,
            provider: "",
            rotatorId: rotator.id,
            status: "Scheduled",
            source: "Auto-Methodist"
          });
        }
      }
    }
  }

  if (newInpatient.length === 0 && newOutpatient.length === 0) return state;

  return {
    ...state,
    inpatientAssignments: [...(state.inpatientAssignments || []), ...newInpatient],
    outpatientSessions: [...(state.outpatientSessions || []), ...newOutpatient]
  };
}

// ---------------------------------------------------------------------------
// Length-based split seeding — SPEC rules 3 (UT peds/adult), 4 (anti-burnout
// pattern) and 7 (psychiatry). One formula covers all lengths:
//
//   weeks   = round(segmentDays / 7), min 1
//   ipWeeks = ceil(weeks / 2)               (≈ half IP / half OP, IP ≥ OP)
//   opLead  = floor((weeks - ipWeeks) / 2)  (OP weeks split around one IP run)
//
// which yields exactly the canonical shapes:
//   1 wk  → IP                (single side; inpatient is the hard constraint)
//   2 wk  → IP / OP
//   3 wk  → IP / IP / OP
//   4 wk  → OP / IP / IP / OP
//   5 wk  → OP / IP / IP / IP / OP   (rule 4's anti-burnout pattern verbatim)
//
// The IP weeks are always ONE consecutive run, so a rule-4 "sandwich"
// (an isolated IP week between OP weeks) is impossible by construction.
// ---------------------------------------------------------------------------

/**
 * Week-level phase plan for one rotator segment. Returns
 * [{ start, end, phase }] chunks covering the whole segment (the last chunk
 * absorbs the remainder days). Pure; [] for invalid segments.
 */
export function segmentSplitPlan(segment) {
  if (!segment?.start || !segment?.end) return [];
  const days = daysBetween(segment.start, segment.end);
  if (days === null || days < 0) return [];
  const weeks = Math.max(1, Math.round((days + 1) / 7));
  const ipWeeks = Math.ceil(weeks / 2);
  const opLead = Math.floor((weeks - ipWeeks) / 2);
  const plan = [];
  for (let w = 0; w < weeks; w += 1) {
    plan.push({
      start: addDaysToIso(segment.start, w * 7),
      end: w === weeks - 1 ? segment.end : addDaysToIso(segment.start, w * 7 + 6),
      phase: w >= opLead && w < opLead + ipWeeks ? "inpatient" : "outpatient"
    });
  }
  return plan;
}

// School types the length-based split applies to. Fellows are excluded
// everywhere (rule 2 governs fellows); methodist has its own 14/14 rule;
// ut-student assignments are predetermined and preserved (§9.5); "other"
// stays manual.
const LENGTH_SPLIT_SCHOOL_TYPES = new Set(["ut-peds", "ut-adult", "ut-psychiatry"]);

function isFellowRotator(rotator) {
  return isPediatricNeurologyFellow(rotator);
}

/**
 * Seed IP/OP calendar records for UT peds / UT adult / psychiatry rotators
 * from their segment split plan (rules 3/4/7). Mirrors
 * applyMethodistAutoAssign's writer exactly: slot-identity dedupe so ANY
 * existing record wins (manual, imported, Methodist, preassigned), inpatient
 * fires 7 days a week, outpatient skips weekends and no-clinic holidays and
 * leaves a continuity-clinic period alone. Segments the user already gave a
 * defaultPhase keep that phase (applyPreassignments is in charge of those).
 * Auto entries are tagged `source: "Auto-Split"`. Idempotent.
 */
export function applyLengthSplitAutoAssign(state, block) {
  if (!state || !block) return state;
  const blockDates = dateRange(block.startDate, block.endDate);
  if (blockDates.length === 0) return state;

  const noClinicHolidays = new Set(
    (block.holidays || []).filter((h) => h && h.noClinic).map((h) => h.date)
  );
  const existingInpatient = new Set(
    (state.inpatientAssignments || []).map((item) => `${item.date}|${item.rotatorId}`)
  );
  const existingOutpatient = new Set(
    (state.outpatientSessions || []).map(
      (item) => `${item.date}|${item.rotatorId}|${item.period}`
    )
  );
  // Any-period outpatient presence: a day the rotator already spends in
  // clinic (imported or manual) is a user decision — the split must not
  // stack an inpatient day on top of it (and vice versa below).
  const existingOutpatientDay = new Set(
    (state.outpatientSessions || []).map((item) => `${item.date}|${item.rotatorId}`)
  );

  const newInpatient = [];
  const newOutpatient = [];

  for (const rotator of state.rotators || []) {
    if (!LENGTH_SPLIT_SCHOOL_TYPES.has(classifyRotator(rotator))) continue;
    if (isFellowRotator(rotator)) continue;
    const segments = Array.isArray(rotator.segments) ? rotator.segments : [];
    for (const seg of segments) {
      if (seg?.defaultPhase === "outpatient" || seg?.defaultPhase === "inpatient") continue;
      for (const chunk of segmentSplitPlan(seg)) {
        for (const date of blockDates) {
          if (date < chunk.start || date > chunk.end) continue;
          if (chunk.phase === "inpatient") {
            const key = `${date}|${rotator.id}`;
            if (existingInpatient.has(key)) continue;
            if (existingOutpatientDay.has(key)) continue;
            existingInpatient.add(key);
            newInpatient.push({
              id: `in-split-${date}-${rotator.id}`.replaceAll(" ", "-").toLowerCase(),
              date,
              rotatorId: rotator.id,
              role: coverageRoleForRotator(rotator),
              source: "Auto-Split"
            });
          } else {
            const dateWeekday = weekdayName(date);
            if (dateWeekday === "Saturday" || dateWeekday === "Sunday") continue;
            if (noClinicHolidays.has(date)) continue;
            if (existingInpatient.has(`${date}|${rotator.id}`)) continue;
            const continuityPeriods = continuityPeriodsForWeekday(rotator.continuityClinic, dateWeekday);
            for (const period of ["AM", "PM"].filter((p) => !continuityPeriods.has(p))) {
              const key = `${date}|${rotator.id}|${period}`;
              if (existingOutpatient.has(key)) continue;
              existingOutpatient.add(key);
              newOutpatient.push({
                id: `out-split-${date}-${period}-${rotator.id}`.toLowerCase(),
                date,
                period,
                clinic: OP_PLACEHOLDER_CLINIC,
                provider: "",
                rotatorId: rotator.id,
                status: "Scheduled",
                source: "Auto-Split"
              });
            }
          }
        }
      }
    }
  }

  if (newInpatient.length === 0 && newOutpatient.length === 0) return state;
  return {
    ...state,
    inpatientAssignments: [...(state.inpatientAssignments || []), ...newInpatient],
    outpatientSessions: [...(state.outpatientSessions || []), ...newOutpatient]
  };
}

/**
 * Rule 2 / A2 — fellow seeding. For each block date with inpatient demand:
 *   - exactly ONE active fellow with no assignment and no template phase →
 *     seed them inpatient (rule 10's weekday minimum is "fellow + 2");
 *   - TWO OR MORE such fellows → never guess: leave the date open and report
 *     the candidate NAMES ("Coordinator / Eden"), so the report can show a
 *     pickable list instead of a bare "unresolved". Selection happens on the
 *     Fellows page (decision D4).
 * Template (segments[].defaultPhase) always wins — a fellow whose template
 * covers the date is not "blank" and is skipped here.
 * Returns { state, candidates: [{ date, names }] }. Pure + idempotent.
 */
export function seedFellowInpatient(state, block) {
  if (!state || !block) return { state, candidates: [] };
  const candidates = [];
  let working = state;

  for (const date of dateRange(block.startDate, block.endDate)) {
    if (coverageForDate(block, date).count <= 0) continue;
    const assignedIp = new Set(
      (working.inpatientAssignments || [])
        .filter((i) => i.date === date && i.role !== "Off")
        .map((i) => i.rotatorId)
    );
    const assignedOp = new Set(
      (working.outpatientSessions || [])
        .filter((s) => s.date === date)
        .map((s) => s.rotatorId)
    );
    const blankFellows = (working.rotators || []).filter(
      (r) =>
        isFellowRotator(r) &&
        isRotatorActiveOn(r, date) &&
        !assignedIp.has(r.id) &&
        !assignedOp.has(r.id) &&
        !getRotatorSegmentPhase(r, date)
    );
    if (blankFellows.length === 1) {
      const fellow = blankFellows[0];
      if (validateDrop(working, fellow.id, date, { avoidContinuity: true }).valid) {
        working = scheduleInpatientAssignment(working, {
          date,
          rotatorId: fellow.id,
          role: coverageRoleForRotator(fellow),
          source: "Auto-Draft"
        });
      }
    } else if (blankFellows.length > 1) {
      candidates.push({
        date,
        names: blankFellows
          .map((f) => f.displayName || f.name || f.id)
          .sort(),
        rotatorIds: blankFellows
          .map((f) => f.id)
          .filter(Boolean)
          .sort()
      });
    }
  }
  return { state: working, candidates };
}

export function fellowCandidateSlotKeys(candidates = []) {
  const keys = new Set();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate?.date) continue;
    for (const rotatorId of Array.isArray(candidate.rotatorIds) ? candidate.rotatorIds : []) {
      if (rotatorId) keys.add(`${candidate.date}|${rotatorId}`);
    }
  }
  return keys;
}

// Rule 11's outpatient target is "OP fellow + 2–3 rotators".
// ponytail: enforce the floor of 2; "prefer 3" stays a human call — raise
// here if Coordinator wants the engine to chase 3.
export const OUTPATIENT_TARGET_ROTATORS = 2;

/**
 * Rule 11 — outpatient fair-fill. Runs AFTER inpatient fill (rule 10:
 * staff inpatient before outpatient). For every clinic weekday in the block
 * with fewer than OUTPATIENT_TARGET_ROTATORS distinct outpatient rotators,
 * add placeholder AM/PM sessions (continuity period preserved) for eligible
 * rotators — active, not inpatient that day, no session that day, not in a
 * Methodist inpatient fortnight, not template-restricted to inpatient, not
 * unavailable — lightest outpatient load first, id tiebreak. Tagged
 * `source: "Auto-Draft"`. Pure, deterministic, idempotent.
 */
export function fillOutpatientTarget(state, block, options = {}) {
  if (!state || !block) return state;
  const excludedSlots = options.excludedSlots || new Set();
  const noClinicHolidays = new Set(
    (block.holidays || []).filter((h) => h && h.noClinic).map((h) => h.date)
  );
  let working = state;

  const opLoad = (s, rid) => {
    const days = new Set();
    for (const o of s.outpatientSessions || []) {
      if (o.rotatorId === rid && o.date >= block.startDate && o.date <= block.endDate) {
        days.add(o.date);
      }
    }
    return days.size;
  };

  for (const date of dateRange(block.startDate, block.endDate)) {
    const dateWeekday = weekdayName(date);
    if (dateWeekday === "Saturday" || dateWeekday === "Sunday") continue;
    if (noClinicHolidays.has(date)) continue;

    const opRotators = new Set(
      (working.outpatientSessions || []).filter((s) => s.date === date).map((s) => s.rotatorId)
    );
    if (opRotators.size >= OUTPATIENT_TARGET_ROTATORS) continue;

    const ipRotators = new Set(
      (working.inpatientAssignments || [])
        .filter((i) => i.date === date && i.role !== "Off")
        .map((i) => i.rotatorId)
    );
    const eligible = (working.rotators || [])
      .filter(
        (r) =>
          !opRotators.has(r.id) &&
          !ipRotators.has(r.id) &&
          !excludedSlots.has(`${date}|${r.id}`) &&
          isRotatorActiveOn(r, date) &&
          !isRotatorUnavailable(r, date) &&
          getRotatorPhase(r, date) !== "inpatient" &&
          getRotatorSegmentPhase(r, date) !== "inpatient"
      )
      .sort(
        (a, b) =>
          opLoad(working, a.id) - opLoad(working, b.id) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      );

    const newSessions = [];
    let added = 0;
    for (const rotator of eligible) {
      if (opRotators.size + added >= OUTPATIENT_TARGET_ROTATORS) break;
      const continuityPeriods = continuityPeriodsForWeekday(rotator.continuityClinic, dateWeekday);
      for (const period of ["AM", "PM"].filter((p) => !continuityPeriods.has(p))) {
        newSessions.push({
          id: `out-fill-${date}-${period}-${rotator.id}`.toLowerCase(),
          date,
          period,
          clinic: OP_PLACEHOLDER_CLINIC,
          provider: "",
          rotatorId: rotator.id,
          status: "Scheduled",
          source: "Auto-Draft"
        });
      }
      added += 1;
    }
    if (newSessions.length > 0) {
      working = {
        ...working,
        outpatientSessions: [...(working.outpatientSessions || []), ...newSessions]
      };
    }
  }
  return working;
}

// ---------------------------------------------------------------------------
// ST-D: Legend generation (spec §7.6, §13.13, §14.5, §16.4, §25.5).
// ---------------------------------------------------------------------------
//
// Use ST-A's canonical helpers from earlier in this file.
const rotatorActiveOnDate = isRotatorActiveOn;

function rotatorBlockDates(rotator, block) {
  if (!rotator || !block) return [];
  return expandRotatorDatesInBlock(rotator, block);
}

// Format a list of active dates into a human-readable date range. Handles
// multi-segment rotators by detecting non-contiguous runs and joining them
// with ", " (e.g., "May 4 to May 17, May 24 to May 31").
function formatLegendDateRange(dates) {
  if (dates.length === 0) return "Not in this block";
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  const formatOne = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime()) ? iso : formatter.format(d);
  };
  const nextDay = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  // Walk the (already-sorted) date list, splitting on gaps.
  const runs = [];
  let runStart = dates[0];
  let runEnd = dates[0];
  for (let i = 1; i < dates.length; i += 1) {
    if (dates[i] === nextDay(runEnd)) {
      runEnd = dates[i];
    } else {
      runs.push([runStart, runEnd]);
      runStart = dates[i];
      runEnd = dates[i];
    }
  }
  runs.push([runStart, runEnd]);

  return runs
    .map(([start, end]) => (start === end ? formatOne(start) : `${formatOne(start)} to ${formatOne(end)}`))
    .join(", ");
}

// Returns the human-facing number for a rotator in the legend.
// Residents get sequential 1, 2, 3...; Fellows render "Fellow";
// medical students render "MS" (per spec §7.6 example).
function legendNumberFor(rotator, residentCounter) {
  const role = rotator.role || "";
  const level = rotator.level || "";
  if (isPediatricNeurologyFellow(rotator)) return "Fellow";
  if (role === "Student" || level.startsWith("MS")) return "MS";
  return String(residentCounter.next());
}

/**
 * Build the numbered legend for a service block. Returns an object with
 * an `entries` array; each entry carries the legend number, the rotator
 * id, the display label, the human-readable date range covered in the
 * block, and the continuity-clinic note (empty string when none).
 *
 * Ordering is deterministic so the legend stays stable across renders:
 * earliest active date ascending, then displayName ascending.
 */
export function generateLegend(state, block) {
  if (!block) return { entries: [] };
  const dates = dateRange(block.startDate, block.endDate);
  if (dates.length === 0) return { entries: [] };

  const activeRotators = (state.rotators || []).filter((rotator) =>
    dates.some((date) => rotatorActiveOnDate(rotator, date))
  );

  const withMeta = activeRotators.map((rotator) => {
    const activeDates = rotatorBlockDates(rotator, block);
    return {
      rotator,
      firstActiveDate: activeDates[0] || block.endDate,
      activeDates
    };
  });

  withMeta.sort((a, b) => {
    if (a.firstActiveDate !== b.firstActiveDate) {
      return a.firstActiveDate < b.firstActiveDate ? -1 : 1;
    }
    const aName = a.rotator.displayName || "";
    const bName = b.rotator.displayName || "";
    return aName.localeCompare(bName);
  });

  let counter = 0;
  const residentCounter = {
    next() {
      counter += 1;
      return counter;
    }
  };

  const entries = withMeta.map(({ rotator, activeDates }) => ({
    number: legendNumberFor(rotator, residentCounter),
    rotatorId: rotator.id,
    displayLabel: rotator.displayName,
    dateRange: formatLegendDateRange(activeDates),
    continuityClinic: rotator.continuityClinic || ""
  }));

  return { entries };
}
