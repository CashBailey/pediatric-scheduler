// Excel roster ingest for the Pediatric Neurology scheduler.
//
// Parses an .xlsx or .xlsm roster spreadsheet entirely in the browser
// using SheetJS and turns each row into a rotator-shaped record that the
// rest of the app can store. No network calls; SheetJS runs locally.
//
// Expected columns (header names are matched loosely, case- and
// whitespace-insensitive, and several common synonyms are accepted):
//
//   Name              -> fullName        (required)
//   Program           -> program         (mapped to a known program; falls back to "Other")
//   Level             -> level           (free text, e.g. "PGY-2", "MS-4", "Fellow")
//   Start             -> segments[0].start (YYYY-MM-DD; accepts Excel date cells)
//   End               -> segments[0].end   (YYYY-MM-DD; accepts Excel date cells)
//   Continuity Clinic -> continuityClinic (free text, e.g. "Tuesday PM")
//   Day Off           -> dayOff          (weekday names: "Mon", "Wed/Fri", etc.)
//   Unavailable       -> unavailableRanges (date ranges like "2026-05-10 to 2026-05-14");
//                        weekday-only values are treated as Day Off with a warning
//   Rotation Start    -> rotationStartDate (YYYY-MM-DD; Methodist rotators only —
//                        ignored for every other program)
//
// Each row produces a single-segment rotator. Multi-segment rotators
// (a rotator with two disjoint date ranges) can be expressed by adding
// a second row with the same Name; mergeRotators will fold them.
//
// On parse the module returns { rows, warnings } where each row is a
// well-formed rotator-shaped object. Errors thrown from this module are
// already written in plain English suitable for showing to a physician.

import * as XLSX from "xlsx";
import { PROGRAMS, inferSchoolType, makeRotator, slug } from "./scheduler.js";

export const BROWSER_EXCEL_EXTENSIONS = [".xlsx", ".xlsm"];
export const ROSTER_FILE_EXTENSIONS = [".csv", ".json", ...BROWSER_EXCEL_EXTENSIONS];
export const BROWSER_EXCEL_ACCEPT = BROWSER_EXCEL_EXTENSIONS.join(",");
export const BROWSER_EXCEL_DESCRIPTION = BROWSER_EXCEL_EXTENSIONS.join(" or ");

export const COLUMN_SYNONYMS = {
  fullName: ["name", "full name", "rotator", "rotator name", "provider", "provider name", "resident", "resident name", "trainee"],
  program: ["program", "service", "track", "rotation", "department"],
  level: ["level", "pgy", "pgy level", "year", "training level", "role"],
  // Wide synonym net — Coordinator reported start/end dates not pulling from
  // her template, almost always because the header column name didn't
  // match. Cover the common variants ("rotation start", "service start",
  // "on service", "block start", "startdate" without space, etc).
  startDate: [
    "start", "start date", "startdate", "begin", "begins", "from",
    "rotation start", "service start", "block start",
    "on service", "on service date", "on service start", "starts",
    "first day", "starting", "starting date", "from date",
    "arrival", "arrival date", "in", "in date"
  ],
  endDate: [
    "end", "end date", "enddate", "finish", "finishes", "to", "thru", "through",
    "rotation end", "service end", "block end",
    "off service", "off service date", "off service end", "ends",
    "last day", "ending", "ending date", "to date",
    "departure", "departure date", "out", "out date"
  ],
  continuityClinic: ["continuity clinic", "clinic", "continuity", "clinic day"],
  dayOff: ["day off", "days off", "off day", "off days"],
  unavailableRanges: ["unavailable", "unavailable dates", "out", "out of office", "ooo", "away", "leave"],
  // Explicit rotation-start column for Methodist rotators, whose IP/OP side
  // alternates from a single anchor date (see computeMethodistStartPhase).
  // Only applied when the row classifies as Methodist; ignored otherwise.
  // Deliberately excludes "rotation start"/"rotation start date": those are
  // segment-start synonyms above, and reusing them here would silently turn a
  // segment date into a 14/14 anchor. Only unmistakably-Methodist headers map.
  // ("14 14 start" is "14/14 Start" after normalizeHeader folds the slash.)
  rotationStartDate: ["methodist start", "methodist start date", "methodist rotation start", "cycle start", "14 14 start", "methodist rotation start date"]
};

export const WEEKDAYS = [
  ["sun", "sunday"],
  ["mon", "monday"],
  ["tue", "tues", "tuesday"],
  ["wed", "weds", "wednesday"],
  ["thu", "thur", "thurs", "thursday"],
  ["fri", "friday"],
  ["sat", "saturday"]
];

export const WEEKDAY_CANONICAL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const PROGRAM_ALIASES = {
  "methodist adult neurology": "Methodist",
  "methodist adult neuro": "Methodist",
  "adult neurology": "UT Adult Neuro",
  "adult neuro": "UT Adult Neuro",
  "pediatrics rotators template format corrected years": "UT Pediatrics",
  "ut houston adult neurology": "UT Adult Neuro",
  "ut adult neurology": "UT Adult Neuro",
  "ut houston pediatrics": "UT Pediatrics",
  "ut houston pediatric": "UT Pediatrics",
  "ut pediatric neurology": "UT Pediatrics",
  "ut pediatric neuro": "UT Pediatrics",
  "pediatric neurology": "UT Pediatrics",
  "pedi neuro": "UT Pediatrics",
  "ut pediatric neurology fellow": "UT Pediatric Neurology Fellow",
  "pediatric neurology fellow": "UT Pediatric Neurology Fellow",
  "pediatric neurology fellowship": "UT Pediatric Neurology Fellow",
  "pedi neuro fellow": "UT Pediatric Neurology Fellow",
  "peds fellow": "UT Pediatric Neurology Fellow",
  "ut houston psychiatry intern": "UT Psychiatry",
  "ut houston psychiatry": "UT Psychiatry",
  "uth child psychiatry fellow": "UT Psychiatry",
  "child psychiatry fellow": "UT Psychiatry"
};

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_\-./]+/g, " ").replace(/\s+/g, " ");
}

function normalizeProgramText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function buildColumnMap(headerRow) {
  // Returns { map, warnings }. When two columns both match a field's
  // synonyms (e.g., a sheet with both "Provider Name" and "Rotator
  // Name"), the first is used and a warning names the conflict so the
  // user can correct via the column-mapping UI. The previous version
  // silently dropped the second column.
  const map = {};
  const warnings = [];
  const normalized = headerRow.map(normalizeHeader);
  for (const [field, candidates] of Object.entries(COLUMN_SYNONYMS)) {
    const indices = [];
    normalized.forEach((header, i) => {
      if (candidates.includes(header)) indices.push(i);
    });
    if (indices.length > 0) {
      map[field] = indices[0];
      if (indices.length > 1) {
        const names = indices.map((i) => headerRow[i]).join(", ");
        warnings.push(
          `Columns "${names}" all look like the "${field}" field. We used the first one (${headerRow[indices[0]]}). Open Column Mapping to pick a different column if that's wrong.`
        );
      }
    }
  }
  return { map, warnings };
}

function matchProgram(value) {
  const text = String(value ?? "").trim();
  if (!text) return "Other";
  const lower = text.toLowerCase();
  // direct match
  for (const program of PROGRAMS) {
    if (program.toLowerCase() === lower) return program;
  }
  const alias = PROGRAM_ALIASES[normalizeProgramText(text)];
  if (alias) return alias;
  // fuzzy: pick the program with the most overlapping words
  let best = null;
  let bestScore = 0;
  for (const program of PROGRAMS) {
    const programWords = program.toLowerCase().split(/\s+/);
    const score = programWords.filter((word) => lower.includes(word)).length;
    if (score > bestScore) {
      best = program;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : "Other";
}

export function inferProgramFromSourceText(value, fallback = "Other") {
  const text = normalizeProgramText(value);
  if (!text) return fallback || "Other";
  if (/\bmethodist\b/.test(text)) return "Methodist";
  // In mixed filenames, the named cohort wins over the service destination:
  // "Psych Residents - Pedi Neuro" is a Psychiatry roster.
  if (/\bpsych(?:iatry)?\b/.test(text) && /\b(?:residents?|interns?|fellows?)\b/.test(text)) {
    return "UT Psychiatry";
  }
  if (/\bpedi(?:atric|atrics)?\b|\bpeds\b|\bpedi\s+neuro\b/.test(text)) return "UT Pediatrics";
  if (/\bpsych(?:iatry)?\b|\bpsychiatry\b/.test(text)) return "UT Psychiatry";
  if (/\badult\b.*\bneuro(?:logy)?\b|\bneuro(?:logy)?\b.*\badult\b/.test(text)) return "UT Adult Neuro";
  const direct = matchProgram(value);
  if (direct !== "Other") return direct;
  return fallback || "Other";
}

function programFromCells(programCell, options = {}) {
  const explicit = matchProgram(programCell);
  if (explicit !== "Other") return explicit;
  const hinted = inferProgramFromSourceText(
    `${options.sourceLabel || ""} ${options.fileName || ""} ${options.sourceFileName || ""}`,
    "Other"
  );
  if (hinted !== "Other") return hinted;
  const fallback = options.defaultProgram || options.programHint || options.defaultProgramOverride;
  return PROGRAMS.includes(fallback) ? fallback : "Other";
}

function expandTwoDigitYear(yy) {
  // Sliding window pivoting on the current calendar year: any 2-digit
  // year more than 5 years in the future is interpreted as 19xx
  // (handles birthdate-style cells). Anything else stays 20xx. So in
  // 2026, "25" → 2025, "30" → 2030, "99" → 1999.
  const n = Number(yy);
  if (!Number.isInteger(n) || n < 0 || n > 99) return `20${yy}`;
  const currentCentury = Math.floor(new Date().getFullYear() / 100) * 100;
  const currentTwoDigit = new Date().getFullYear() - currentCentury;
  return n <= currentTwoDigit + 5
    ? String(currentCentury + n)
    : String(currentCentury - 100 + n);
}

function toIsoDate(value) {
  if (value == null || value === "") return "";
  // SheetJS, when cellDates: true, returns JS Date objects
  if (value instanceof Date && !isNaN(value)) {
    return formatDate(value);
  }
  if (typeof value === "number") {
    // Excel serial date
    const parsed = XLSX.SSF?.parse_date_code?.(value);
    if (parsed) {
      const date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
      return formatDate(date);
    }
  }
  const text = String(value).trim();
  if (!text) return "";
  // common formats: 2026-05-04, 5/4/2026, 5/4/26, May 4 2026
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${pad(isoMatch[2])}-${pad(isoMatch[3])}`;
  }
  const slashMatch = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashMatch) {
    let [, m, d, y] = slashMatch;
    if (y.length === 2) y = expandTwoDigitYear(y);
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  const parsed = new Date(text);
  if (!isNaN(parsed)) {
    // `new Date("May 4 2026")` parses to local-midnight. Reading
    // back via getUTC* in formatDate would drop one calendar day for
    // any timezone east of UTC. Re-emit from local components so the
    // ISO date matches what a human sees in the cell.
    const pad2 = (n) => String(n).padStart(2, "0");
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  }
  return text; // give up — pass through so user can spot the bad cell
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  return `${y}-${m}-${d}`;
}

function findWeekdayIndex(token) {
  const cleaned = token.trim().toLowerCase();
  if (!cleaned) return -1;
  return WEEKDAYS.findIndex((aliases) => aliases.some((alias) => cleaned === alias || cleaned.startsWith(alias)));
}

function parseDayOff(value) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const days = new Set();
  // Split on list separators AND on range markers. A bare "Mon-Fri" used
  // to leave the entire string as one token; `startsWith("mon")` then
  // matched only Monday, silently dropping Tue/Wed/Thu/Fri. The split
  // below tokenizes both list and range forms; range expansion follows.
  const tokens = text.split(/[,;/&\-–—]| and | to | through | thru /i);
  for (const part of tokens) {
    const idx = findWeekdayIndex(part);
    if (idx >= 0) days.add(WEEKDAY_CANONICAL[idx]);
  }
  // If the input looks like a single range ("Mon-Fri", "Tue through Thu"),
  // fill the inclusive interval rather than just the endpoints. Hyphen
  // forms allow tight "Mon-Fri" without whitespace; word forms require
  // whitespace on both sides so "tuesdaythroughfriday" doesn't false-match.
  const rangeMatch = text.match(/^\s*([A-Za-z]+)\s*(?:[-–—]\s*|\s+(?:to|through|thru)\s+)([A-Za-z]+)\s*$/i);
  if (rangeMatch) {
    const start = findWeekdayIndex(rangeMatch[1]);
    const end = findWeekdayIndex(rangeMatch[2]);
    if (start >= 0 && end >= 0) {
      // Walk forward from start to end (modulo 7) so "Saturday to Sunday"
      // expands to just the weekend instead of the entire week.
      let i = start;
      for (let safety = 0; safety < 8; safety++) {
        days.add(WEEKDAY_CANONICAL[i]);
        if (i === end) break;
        i = (i + 1) % 7;
      }
    }
  }
  return [...days];
}

function parseWeekdayOnlyList(value) {
  const text = String(value ?? "").trim();
  if (!text || /\d/.test(text) || /\b(?:am|pm)\b/i.test(text)) return [];
  const days = parseDayOff(text);
  if (days.length === 0) return [];
  const tokens = text.split(/[,;/&\-–—]| and | to | through | thru /i).map((part) => part.trim()).filter(Boolean);
  if (tokens.length === 0) return [];
  return tokens.every((token) => findWeekdayIndex(token) >= 0) ? days : [];
}

function parseUnavailableCell(value) {
  const text = String(value ?? "").trim();
  if (!text) return { ranges: [], weekdayDays: [], invalidValues: [] };
  const ranges = [];
  const weekdayDays = new Set();
  const invalidValues = [];
  for (const part of text.split(/[;,]/)) {
    const cleaned = part.trim();
    if (!cleaned) continue;
    const weekdayOnly = parseWeekdayOnlyList(cleaned);
    if (weekdayOnly.length) {
      weekdayOnly.forEach((day) => weekdayDays.add(day));
      continue;
    }
    const match = cleaned.match(/^(.+?)\s+(?:to|through|thru|–|—|-)\s+(.+)$/i);
    if (match) {
      const start = toIsoDate(match[1]);
      const end = toIsoDate(match[2]);
      if (isIsoDate(start) && isIsoDate(end)) {
        ranges.push({ start, end });
      } else {
        invalidValues.push(cleaned);
      }
    } else {
      const single = toIsoDate(cleaned);
      if (isIsoDate(single)) {
        ranges.push({ start: single, end: single });
      } else {
        invalidValues.push(cleaned);
      }
    }
  }
  return { ranges, weekdayDays: [...weekdayDays], invalidValues };
}

function roleSignalFromSource(programCell, levelText, sourceLabel = "") {
  const source = `${programCell ?? ""} ${levelText ?? ""} ${sourceLabel ?? ""}`;
  if (/\bfellows?\b|\bfellowship\b/i.test(source)) return "Fellow";
  return "";
}

function applyRoleSignals(rotator, programCell, levelText, sourceLabel = "") {
  // Fellow is the Pediatric Neurology coverage role here. A Psychiatry
  // trainee remains a resident rotator even when the academic title or mixed
  // source filename contains "fellow" or "pedi neuro".
  if (rotator.program === "UT Psychiatry" && rotator.role !== "Student") {
    rotator.role = "Resident";
    return rotator;
  }
  const role = roleSignalFromSource(programCell, levelText, sourceLabel);
  const level = String(levelText ?? "").trim().toUpperCase();
  const inferredPgy5Fellow = rotator.program === "UT Pediatrics" && /^PGY\s*-?\s*5$/.test(level);
  if ((role === "Fellow" || inferredPgy5Fellow) && rotator.role !== "Student") {
    rotator.role = "Fellow";
    // Fellow signal wins the label too: ambiguous buckets get the
    // fellow-specific program so the Fellows page and staff rows read
    // "UT Pediatric Neurology Fellow" instead of "UT Pediatrics".
    if (["", "Other", "UT Pediatrics"].includes(rotator.program ?? "")) {
      rotator.program = "UT Pediatric Neurology Fellow";
      rotator.schoolType = inferSchoolType(rotator.program);
    }
  }
  return rotator;
}

function mergeWeekdays(...lists) {
  const seen = new Set();
  for (const list of lists) {
    for (const day of Array.isArray(list) ? list : []) {
      if (WEEKDAY_CANONICAL.includes(day)) seen.add(day);
    }
  }
  return [...seen];
}

function getCell(row, index) {
  if (index == null || index < 0) return "";
  return row[index] ?? "";
}

function rowIsEmpty(row) {
  return row.every((cell) => cell == null || String(cell).trim() === "");
}

/**
 * Parse an Excel workbook (ArrayBuffer or Uint8Array) into rotator-shaped rows.
 *
 * Auto-detects between two supported layouts:
 *   1. Template layout: header row with named columns (Name, Start, End, etc.)
 *      One row per rotator.
 *   2. Matrix layout: first 1-3 rows are date headers across columns
 *      (M/D format, one column per week of the academic year);
 *      subsequent rows are rotators with presence flags ("B", "!B")
 *      in each week column they're on service.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {{ defaultStart?: string, defaultEnd?: string }} [options]
 * @returns {{ rows: Array, warnings: string[], columnsFound: string[] }}
 */
export function parseRosterWorkbook(buffer, options = {}) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch (error) {
    throw new Error(`We couldn't open that spreadsheet. Please make sure it's a valid ${BROWSER_EXCEL_DESCRIPTION} file saved from Excel or Google Sheets.`);
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("That spreadsheet doesn't have any sheets. Please add a roster sheet and try again.");
  }
  const sheet = workbook.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd" });

  // Always attempt both branches when possible so the UI's layout-toggle
  // can flip between matrix/template views without re-reading the file.
  // The auto-detected branch (matrix wins if it returned non-null) feeds
  // the top-level rows/warnings/columnsFound for backward compat.
  const matrixResult = tryParseMatrixWorkbook(grid, options);
  const templateResult = tryParseTemplateWorkbook(grid, options);

  if (!matrixResult && !templateResult) {
    throw new Error("We couldn't find a name column in this spreadsheet. The first sheet needs a header row with at least a 'Name' column, or a row of week-start dates across the top. You can download the template to see the expected layout.");
  }

  const chosen = matrixResult || templateResult;
  return {
    ...chosen,
    isMatrix: matrixResult != null,
    templateParse: templateResult,
    matrixParse: matrixResult ? { rows: matrixResult.rows, warnings: matrixResult.warnings } : null
  };
}

/**
 * Internal: parse the template-layout branch (header row + named columns).
 * Returns { rows, warnings, columnsFound, headers, dataRows, detectedMapping,
 * headerRowIndex } or null if no header row containing a Name synonym was
 * found. Same per-row logic as before — factored out so applyColumnMapping
 * can be reused by the UI's remap-on-change loop.
 */
function tryParseTemplateWorkbook(grid, options = {}) {
  // Find the header row: the first non-empty row that contains a recognizable column name.
  let headerIndex = -1;
  let columnMap = {};
  let headerWarnings = [];
  for (let i = 0; i < grid.length && i < 10; i++) {
    if (rowIsEmpty(grid[i])) continue;
    const { map: candidate, warnings: dupWarnings } = buildColumnMap(grid[i]);
    if (candidate.fullName != null) {
      headerIndex = i;
      columnMap = candidate;
      headerWarnings = dupWarnings;
      break;
    }
  }
  if (headerIndex < 0) return null;

  const headers = (grid[headerIndex] || []).map((cell) => String(cell ?? "").trim());
  const dataRows = grid.slice(headerIndex + 1);
  const { rows, warnings } = applyColumnMapping(headers, dataRows, columnMap, {
    ...options,
    headerRowIndex: headerIndex
  });
  // Prepend buildColumnMap's duplicate-synonym warnings so they appear
  // ahead of per-row warnings in the import summary.
  warnings.unshift(...headerWarnings);

  if (rows.length === 0) {
    throw new Error("We found a header row but no rotator rows below it. Please add at least one row with a name and try again.");
  }

  // Surface missing Methodist start dates at import time — otherwise they only
  // appear later as methodist-no-start warnings in the Draft Report.
  const missingStart = rows
    .filter((row) => row.schoolType === "methodist" && !row.rotationStartDate)
    .map((row) => String(row.fullName || ""));
  if (missingStart.length > 0) {
    warnings.push(
      `${missingStart.length} Methodist rotator(s) imported without a rotation start date ` +
        `(${missingStart.join(", ")}) — their first scheduled day will count as day 1 of the ` +
        "inpatient/outpatient split unless you set one (Planning Grid > Methodist Setup)."
    );
  }

  return {
    rows,
    warnings,
    columnsFound: Object.keys(columnMap),
    headers,
    dataRows,
    detectedMapping: columnMap,
    headerRowIndex: headerIndex
  };
}

/**
 * Apply a user-chosen column mapping to raw spreadsheet data rows and
 * produce rotator-shaped records. The UI calls this on every dropdown
 * flip so the live preview re-derives instantly without re-reading the
 * file. Same coercions as the original template branch:
 * matchProgram / toIsoDate / parseDayOff / parseUnavailableCell /
 * makeRotator. Mapping values are column indices (not header names) so
 * duplicate/blank headers stay unambiguous.
 *
 * @param {string[]} headers
 * @param {Array<Array<any>>} dataRows  // rows below the header row
 * @param {{fullName?:number, program?:number, level?:number,
 *          startDate?:number, endDate?:number, continuityClinic?:number,
 *          dayOff?:number, unavailableRanges?:number,
 *          rotationStartDate?:number}} mapping
 * @param {{ defaultStart?:string, defaultEnd?:string,
 *           headerRowIndex?:number }} [options]
 * @returns {{ rows: Array, warnings: string[] }}
 */
export function applyColumnMapping(headers, dataRows, mapping, options = {}) {
  const warnings = [];
  const rows = [];
  const headerRowIndex = options.headerRowIndex ?? 0;
  const get = (raw, fieldKey) => {
    const idx = mapping[fieldKey];
    return idx == null ? "" : getCell(raw, idx);
  };

  for (let i = 0; i < dataRows.length; i++) {
    const raw = dataRows[i];
    if (rowIsEmpty(raw)) continue;
    const fullName = String(get(raw, "fullName") ?? "").trim();
    if (!fullName) continue;

    // Display row number references the original sheet row (1-indexed),
    // so warnings line up with what the user sees in Excel.
    const sheetRow = headerRowIndex + 1 + i + 1;

    const programCell = get(raw, "program");
    const sourceLabel = `${options.sourceLabel || ""} ${options.fileName || ""} ${options.sourceFileName || ""}`.trim();
    const program = programFromCells(programCell, options);
    if (mapping.program != null && program === "Other" && String(programCell).trim()) {
      warnings.push(`Row ${sheetRow}: program "${programCell}" didn't match a known program, so we filed it under Other.`);
    }
    const rawLevelText = String(get(raw, "level") ?? "").trim();
    const levelText = rawLevelText || "Unknown";
    if (mapping.level != null && !rawLevelText) {
      warnings.push(`Row ${sheetRow}: ${fullName} is missing a level, so we imported it as Unknown.`);
    }
    const startDate = toIsoDate(get(raw, "startDate")) || options.defaultStart || "";
    const endDate = toIsoDate(get(raw, "endDate")) || options.defaultEnd || "";
    if (!startDate) warnings.push(`Row ${sheetRow}: ${fullName} is missing a start date.`);
    if (!endDate) warnings.push(`Row ${sheetRow}: ${fullName} is missing an end date.`);

    const id = `rot-${slug(fullName)}-${i}`;
    const segments = (startDate && endDate)
      ? [{ start: startDate, end: endDate }]
      : [];
    const base = applyRoleSignals(makeRotator(id, fullName, program, levelText, segments), programCell, levelText, sourceLabel);
    const continuityCell = get(raw, "continuityClinic");
    if (continuityCell !== "" && continuityCell != null) {
      base.continuityClinic = String(continuityCell).trim();
    }
    const dayOff = parseDayOff(get(raw, "dayOff"));
    const unavailable = parseUnavailableCell(get(raw, "unavailableRanges"));
    const mergedDayOff = mergeWeekdays(dayOff, unavailable.weekdayDays);
    if (mergedDayOff.length) base.dayOff = mergedDayOff;
    if (unavailable.weekdayDays.length) {
      warnings.push(`Row ${sheetRow}: ${fullName} has weekday text in Unavailable (${unavailable.weekdayDays.join(", ")}), so we added it to Day Off instead of creating an invalid date range.`);
    }
    for (const invalidValue of unavailable.invalidValues) {
      warnings.push(`Row ${sheetRow}: ${fullName} has an Unavailable value we couldn't read as a date range: "${invalidValue}".`);
    }
    if (unavailable.ranges.length) base.unavailableRanges = unavailable.ranges;

    // Explicit rotation-start column only applies to Methodist rotators
    // (schoolType is derived from program by makeRotator above). Column
    // absent, or row not Methodist, leaves rotationStartDate unset.
    if (mapping.rotationStartDate != null && base.schoolType === "methodist") {
      const rotationStartDate = toIsoDate(get(raw, "rotationStartDate"));
      if (rotationStartDate) base.rotationStartDate = rotationStartDate;
    }

    rows.push(base);
  }
  return { rows, warnings };
}

/**
 * Merge parsed rotator rows into existing roster.
 *
 * @param {Array} existingRotators
 * @param {Array} parsedRows
 * @param {"merge"|"replace"|"add"} mode
 *   - "merge": update existing rotators when names match, add new ones
 *   - "replace": drop existing rotators, use parsed rows
 *   - "add": always add (may create duplicates)
 * @returns {{ rotators: Array, added: number, updated: number, removed: number }}
 */
export function mergeRotators(existingRotators, parsedRows, mode = "merge") {
  if (mode === "replace") {
    return {
      rotators: parsedRows,
      added: parsedRows.length,
      updated: 0,
      removed: existingRotators.length
    };
  }
  if (mode === "add") {
    return {
      rotators: [...existingRotators, ...parsedRows],
      added: parsedRows.length,
      updated: 0,
      removed: 0
    };
  }
  // merge: match on lowercased full name; existing wins on id (keep references stable).
  // When the parsed row brings new segments AND the existing/parsed share a name,
  // we union the segments so a rotator entered as two rows (e.g. "May 1-7" and
  // "May 24-31") survives the merge as a multi-segment rotator.
  const byKey = new Map(existingRotators.map((r) => [keyOf(r.fullName), r]));
  let added = 0;
  let updated = 0;
  for (const row of parsedRows) {
    const key = keyOf(row.fullName);
    const existing = byKey.get(key);
    if (existing) {
      // Field-wise merge: an incoming row that's missing a column (e.g.
      // a second "May 24-31" row for Carlos with no Program/Level cell)
      // would otherwise clobber a previously-set non-default value with
      // the importer's fallback ("Other" / "Unknown" / "" / []). Prefer the
      // existing value whenever the incoming one is the fallback.
      const merged = { ...existing, ...row, id: existing.id };
      if (row.program === "Other" && existing.program && existing.program !== "Other") {
        merged.program = existing.program;
        merged.schoolType = existing.schoolType;
      }
      if (row.level === "Unknown" && existing.level && existing.level !== "Unknown") {
        merged.level = existing.level;
        merged.role = existing.role;
      }
      if (row.continuityClinic === "" && existing.continuityClinic) {
        merged.continuityClinic = existing.continuityClinic;
      }
      if (Array.isArray(row.dayOff) && row.dayOff.length === 0 &&
          Array.isArray(existing.dayOff) && existing.dayOff.length > 0) {
        merged.dayOff = existing.dayOff;
      }
      if (Array.isArray(row.unavailableRanges) && row.unavailableRanges.length === 0 &&
          Array.isArray(existing.unavailableRanges) && existing.unavailableRanges.length > 0) {
        merged.unavailableRanges = existing.unavailableRanges;
      }
      merged.segments = unionSegments(existing.segments, row.segments);
      byKey.set(key, merged);
      updated += 1;
    } else {
      byKey.set(key, row);
      added += 1;
    }
  }
  return {
    rotators: [...byKey.values()],
    added,
    updated,
    removed: 0
  };
}

// Combine two arrays of {start,end} segments into a sorted, deduped list.
// Order by start date; identical (start,end) pairs collapse to one.
function unionSegments(a, b) {
  const seen = new Set();
  const out = [];
  for (const seg of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!seg || !seg.start || !seg.end) continue;
    const key = `${seg.start}|${seg.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ start: seg.start, end: seg.end });
  }
  out.sort((x, y) => x.start.localeCompare(y.start) || x.end.localeCompare(y.end));
  return out;
}

function keyOf(name) {
  return String(name ?? "").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Matrix-format support
// ---------------------------------------------------------------------------
//
// Some residency programs maintain their roster as a wide grid:
//
//   |   | Name        | 6/24 | 7/1 | 7/6 | 7/13 | ... | 6/28 |
//   | 1 | Jordan Lee  |      |  B  |  B  |  B   |     |      |
//   | 2 | Casey Moore |      | !B  |     |  B   | ... |      |
//
// Each date header is a week-start (M/D, no year). Each cell is a
// presence flag — "B" means present that week, "!B" likewise but
// flagged (we treat as present and warn). We coalesce contiguous
// marked weeks into segments so two adjacent "B" weeks become one
// segment spanning both weeks.

// Matrix presence markers. Compared after uppercasing the cell so a lowercase
// "b" or extra whitespace doesn't silently drop a week from a rotator's
// segments. "!B" still means "present but flagged" — uppercase preserves the
// "!" prefix.
export const MATRIX_PRESENT_MARKS = new Set(["B", "!B"]);
export const MATRIX_BANG_BEHAVIORS = ["present", "exclude"];
export const DEFAULT_MATRIX_BANG_BEHAVIOR = "present";
function isMatrixPresent(cellText, matrixBangBehavior = DEFAULT_MATRIX_BANG_BEHAVIOR) {
  const mark = String(cellText ?? "").trim().toUpperCase();
  if (mark === "!B" && matrixBangBehavior === "exclude") return false;
  return MATRIX_PRESENT_MARKS.has(mark);
}

/**
 * Try to detect + parse a matrix-format workbook. Returns the same
 * { rows, warnings, columnsFound } shape as the template parser.
 * Returns null if the sheet doesn't look like a matrix layout.
 */
function tryParseMatrixWorkbook(grid, options = {}) {
  if (!grid || grid.length < 3) return null;

  // Detect: scan the first few rows for one that has ≥6 cells parseable as
  // M/D dates beyond column 1. That's the date row.
  let dateRowIndex = -1;
  let weekStarts = null; // { columnIndex -> "YYYY-MM-DD" }
  for (let i = 0; i < Math.min(grid.length, 5); i++) {
    const probed = probeWeekStartDates(grid[i]);
    if (probed.length >= 6) {
      dateRowIndex = i;
      weekStarts = probed;
      break;
    }
  }
  if (dateRowIndex < 0 || !weekStarts) return null;

  // The name column is the column right before the first dated column.
  // For Coordinator's layout that's column 1; for others it could be 0 or 2.
  const firstDateCol = weekStarts[0].col;
  const nameCol = firstDateCol > 0 ? firstDateCol - 1 : 0;

  // The first rotator row is the first row AFTER dateRowIndex whose
  // nameCol cell is a non-empty non-numeric string (skipping header
  // rows like "Number of Residents").
  let firstRotatorRow = dateRowIndex + 1;
  while (firstRotatorRow < grid.length) {
    const row = grid[firstRotatorRow];
    const name = String(getCell(row, nameCol) ?? "").trim();
    if (name && !/^\d+$/.test(name) && !/^(number of|count|total|residents?|count of)/i.test(name)) {
      break;
    }
    firstRotatorRow += 1;
  }

  const warnings = [];
  const rows = [];
  const flaggedCellRotators = [];

  for (let i = firstRotatorRow; i < grid.length; i++) {
    const raw = grid[i];
    if (rowIsEmpty(raw)) continue;
    const fullName = String(getCell(raw, nameCol) ?? "").trim();
    if (!fullName) continue;
    if (/^(number of|count|total)/i.test(fullName)) continue;

    // Walk the week columns, collect contiguous runs of present cells.
    // Each column's period runs from its own date up to (but not
    // including) the next column's date. The last column's period
    // defaults to 7 days. This handles non-uniform week boundaries
    // like a 5-day "July 4 week" between 7/1 and 7/6.
    const segments = [];
    let runStart = null;
    let runEnd = null;
    let flaggedThisRow = false;

    for (let w = 0; w < weekStarts.length; w++) {
      const { col, isoStart } = weekStarts[w];
      const nextStart = w + 1 < weekStarts.length ? weekStarts[w + 1].isoStart : null;
      const isoEnd = nextStart ? addDaysToIso(nextStart, -1) : addDaysToIso(isoStart, 6);
      const cell = String(getCell(raw, col) ?? "").trim();
      const isPresent = isMatrixPresent(cell, options.matrixBangBehavior);
      if (cell.toUpperCase() === "!B") flaggedThisRow = true;
      if (isPresent) {
        if (runStart == null) {
          runStart = isoStart;
          runEnd = isoEnd;
        } else {
          // Extend the run if this week starts immediately after the prior
          // week ends; otherwise close the run and start a new one.
          const nextDayAfterRun = addDaysToIso(runEnd, 1);
          if (isoStart === nextDayAfterRun) {
            runEnd = isoEnd;
          } else {
            segments.push({ start: runStart, end: runEnd });
            runStart = isoStart;
            runEnd = isoEnd;
          }
        }
      }
    }
    if (runStart != null) segments.push({ start: runStart, end: runEnd });

    if (segments.length === 0) {
      warnings.push(`${fullName}: no weeks marked present, so they were skipped.`);
      continue;
    }

    if (flaggedThisRow) flaggedCellRotators.push(fullName);

    // Defaults inferred from the matrix-format context. Source filenames are
    // allowed to override the Pediatrics fallback when the grid comes from a
    // different program.
    const id = `rot-${slug(fullName)}-${i}`;
    const program = inferProgramFromSourceText(
      `${options.sourceLabel || ""} ${options.fileName || ""} ${options.sourceFileName || ""}`,
      "UT Pediatrics"
    );
    const base = applyRoleSignals(makeRotator(id, fullName, program, "PGY-2", segments), program, "PGY-2", options.sourceLabel || options.fileName || "");
    rows.push(base);
  }

  if (rows.length === 0) return null; // not actually a usable matrix

  // Emit a friendly warning about the inferred academic year so the user
  // can correct if we guessed wrong.
  const firstDate = weekStarts[0].isoStart;
  const lastDate = weekStarts[weekStarts.length - 1].isoStart;
  warnings.unshift(`Read this as a grid-style roster covering ${firstDate} to ${lastDate}. Each "B" or "!B" mark became a week the provider is on service; runs of consecutive weeks were combined into one date range.`);

  if (flaggedCellRotators.length) {
    warnings.push(`The following providers had cells marked "!B" — we treated them as present (same as "B"). Let us know if these should be excluded instead: ${flaggedCellRotators.join(", ")}.`);
  }
  if (options.defaultProgramOverride) {
    // (future: allow caller to override the default program from UI)
  }

  return {
    rows,
    warnings,
    columnsFound: ["matrix"]
  };
}

/**
 * Scan a row for cells that look like M/D dates (column 2+). Returns
 * an array of { col, isoStart } for the columns that parsed; the
 * caller decides whether the count is large enough to count as a
 * date row.
 *
 * Year inference: chooses the academic year (June→June) that contains
 * today's date. So if today is 2026-05-20 and the row starts with
 * "6/24", we interpret that as June 24 2025 (AY 2025-26 still in
 * progress).
 */
function probeWeekStartDates(row) {
  if (!row || row.length < 3) return [];
  const today = new Date();
  const todayMonth = today.getUTCMonth() + 1; // 1-12
  const todayYear = today.getUTCFullYear();
  // Academic year start: June (month 6). If today is on/after June, AY is
  // todayYear → todayYear+1; otherwise AY is todayYear-1 → todayYear.
  const academicYearStart = todayMonth >= 6 ? todayYear : todayYear - 1;

  const results = [];
  let lastMonth = null;
  let yearOffset = 0;
  for (let col = 0; col < row.length; col++) {
    if (col < 2) continue; // matrix layouts always have at least an index + name column
    const cell = row[col];
    const parsed = parseMonthDay(cell);
    if (!parsed) continue;
    const { month, day } = parsed;
    // Detect year rollover: if the month decreased relative to the prior
    // dated cell, the academic year crossed Dec → Jan.
    if (lastMonth != null && month < lastMonth) {
      yearOffset += 1;
    }
    lastMonth = month;
    const year = academicYearStart + yearOffset;
    const iso = `${year}-${pad(month)}-${pad(day)}`;
    results.push({ col, isoStart: iso });
  }
  return results;
}

function parseMonthDay(value) {
  if (value == null) return null;
  if (value instanceof Date && !isNaN(value)) {
    return { month: value.getUTCMonth() + 1, day: value.getUTCDate() };
  }
  const text = String(value).trim();
  if (!text) return null;
  const match = text.match(/^(\d{1,2})\s*[\/\-]\s*(\d{1,2})(?:\s*[\/\-]\s*\d{2,4})?$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject combinations that exist as a calendar day in NO year (e.g.
  // 2/31, 4/31, 6/31, 9/31, 11/31). For Feb 29 we accept because some
  // years (leap years) it IS valid; downstream code resolves the year.
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysInMonth[month - 1]) return null;
  return { month, day };
}

function addDaysToIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  const y2 = date.getUTCFullYear();
  const m2 = pad(date.getUTCMonth() + 1);
  const d2 = pad(date.getUTCDate());
  return `${y2}-${m2}-${d2}`;
}

/**
 * Build a blank template workbook as a Uint8Array so the user can download
 * and fill it in. Headers match the synonyms above.
 */
export function buildTemplateWorkbook() {
  const headers = [
    "Name",
    "Program",
    "Level",
    "Start",
    "End",
    "Continuity Clinic",
    "Day Off",
    "Unavailable"
  ];
  const example = [
    "Jane Doe",
    "UT Pediatrics",
    "PGY-2",
    "2026-05-04",
    "2026-05-31",
    "Tuesday PM",
    "Wednesday",
    "2026-05-20 to 2026-05-22"
  ];
  const sheet = XLSX.utils.aoa_to_sheet([headers, example]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Roster");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}

/**
 * Phase 8.2 wrapper. Attempts to parse the roster via the local
 * backend's /api/import/excel route first (offloads CPU from the UI
 * thread on large files). Falls back to in-process parseRosterWorkbook
 * on any backend failure — network error, non-2xx response, or fetch
 * unavailable (e.g., server-side tests).
 *
 * Returns the same shape as parseRosterWorkbook so callers can swap
 * one for the other transparently.
 */
export async function parseRosterFromArrayBuffer(buffer, options = {}) {
  const tryBackend = options.tryBackend !== false;
  if (tryBackend && typeof fetch === "function") {
    try {
      const response = await fetch("/api/import/excel", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: buffer
      });
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Network error / backend down. Fall through to local parse.
    }
  }
  return parseRosterWorkbook(buffer, options);
}
