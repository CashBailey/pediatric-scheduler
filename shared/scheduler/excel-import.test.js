import { afterEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  applyColumnMapping,
  BROWSER_EXCEL_ACCEPT,
  BROWSER_EXCEL_DESCRIPTION,
  BROWSER_EXCEL_EXTENSIONS,
  buildTemplateWorkbook,
  mergeRotators,
  parseRosterFromArrayBuffer,
  parseRosterWorkbook,
  ROSTER_FILE_EXTENSIONS
} from "./excel-import.js";
import { createDemoState } from "./test-fixtures.js";

function makeWorkbook(rows, bookType = "xlsx") {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Roster");
  return XLSX.write(workbook, { type: "array", bookType });
}

describe("parseRosterWorkbook", () => {
  it("parses a well-formed roster into rotator-shaped rows", () => {
    const buffer = makeWorkbook([
      ["Name", "Program", "Level", "Start", "End", "Continuity Clinic", "Day Off", "Unavailable"],
      ["Jane Doe", "UT Pediatrics", "PGY-2", "2026-05-04", "2026-05-31", "Tuesday PM", "Wednesday", "2026-05-20 to 2026-05-22"],
      ["Carlos Reyes", "Methodist", "PGY-3", "2026-05-04", "2026-05-17", "", "Mon, Fri", ""]
    ]);
    const { rows, warnings } = parseRosterWorkbook(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      fullName: "Jane Doe",
      program: "UT Pediatrics",
      level: "PGY-2",
      continuityClinic: "Tuesday PM"
    });
    expect(rows[0].segments).toEqual([{ start: "2026-05-04", end: "2026-05-31" }]);
    expect(rows[0].schoolType).toBe("ut-peds");
    expect("startDate" in rows[0]).toBe(false);
    expect("endDate" in rows[0]).toBe(false);
    expect(rows[0].dayOff).toEqual(["Wednesday"]);
    expect(rows[0].unavailableRanges).toEqual([{ start: "2026-05-20", end: "2026-05-22" }]);
    expect(rows[1].segments).toEqual([{ start: "2026-05-04", end: "2026-05-17" }]);
    expect(rows[1].schoolType).toBe("methodist");
    expect(rows[1].dayOff).toEqual(["Monday", "Friday"]);
    // Carlos is Methodist with no rotation-start column, so the import warns
    // at parse time instead of deferring to the Draft Report.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Carlos Reyes");
    expect(warnings[0]).toContain("rotation start date");
  });

  it("accepts synonym headers and falls back to Other for unknown programs", () => {
    const buffer = makeWorkbook([
      ["Provider Name", "Service", "PGY", "Begins", "Ends"],
      ["Alex Stone", "Cardiology", "PGY-4", "2026-05-04", "2026-05-31"]
    ]);
    const { rows, warnings } = parseRosterWorkbook(buffer);
    expect(rows[0].fullName).toBe("Alex Stone");
    expect(rows[0].program).toBe("Other");
    expect(warnings.some((w) => /Cardiology/.test(w))).toBe(true);
  });

  it("uses the source filename as a program hint when the sheet has no program column", () => {
    const methodist = parseRosterWorkbook(makeWorkbook([
      ["Name", "Level", "Start", "End"],
      ["Maya Lopez", "PGY-3", "2026-08-01", "2026-08-31"]
    ]), { fileName: "Methodist_Adult_Neurology_Roster_Template.xlsx" });
    const peds = parseRosterWorkbook(makeWorkbook([
      ["Name", "Level", "Start", "End"],
      ["Fiona Fellow", "PGY-5", "2026-08-01", "2026-08-31"]
    ]), { fileName: "Pediatrics_Rotators_Template_Format_CORRECTED_YEARS.xlsx" });

    expect(methodist.rows[0].program).toBe("Methodist");
    // Coordinator 2026-07-29 #1: the fellow signal now wins the label too.
    expect(peds.rows[0].program).toBe("UT Pediatric Neurology Fellow");
    expect(peds.rows[0].role).toBe("Fellow");
  });

  it("distinguishes Pedi Neuro fellows from Psychiatry rotators in mixed source filenames", () => {
    const fellow = parseRosterWorkbook(makeWorkbook([
      ["Name", "Level", "Start", "End"],
      ["Morgan Chu", "PGY-3", "2026-08-28", "2026-09-24"]
    ]), { fileName: "Pedi Neuro Fellows Template.xlsx" });
    const psychiatry = parseRosterWorkbook(makeWorkbook([
      ["Name", "Level", "Start", "End"],
      ["Kai Doe", "PGY-5", "2026-09-01", "2026-09-30"]
    ]), { fileName: "Psych_Residents_Pedi_Neuro_Template.xlsx" });

    expect(fellow.rows[0]).toMatchObject({
      fullName: "Morgan Chu",
      program: "UT Pediatric Neurology Fellow",
      role: "Fellow"
    });
    expect(psychiatry.rows[0]).toMatchObject({
      fullName: "Kai Doe",
      program: "UT Psychiatry",
      role: "Resident"
    });
  });

  it("throws a plain-English error when there's no name column", () => {
    const buffer = makeWorkbook([
      ["Foo", "Bar"],
      ["nope", "nada"]
    ]);
    expect(() => parseRosterWorkbook(buffer)).toThrow(/name column/i);
  });

  it("describes the supported browser workbook extensions consistently", () => {
    expect(BROWSER_EXCEL_EXTENSIONS).toEqual([".xlsx", ".xlsm"]);
    expect(BROWSER_EXCEL_ACCEPT).toBe(".xlsx,.xlsm");
    expect(BROWSER_EXCEL_DESCRIPTION).toBe(".xlsx or .xlsm");
    expect(ROSTER_FILE_EXTENSIONS).toEqual([".csv", ".json", ".xlsx", ".xlsm"]);
  });

  it("skips blank rows and ignores rows without a name", () => {
    const buffer = makeWorkbook([
      ["Name", "Program"],
      ["", ""],
      ["", "UT Pediatrics"],
      ["Lee Park", "UT Pediatrics"]
    ]);
    const { rows } = parseRosterWorkbook(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0].fullName).toBe("Lee Park");
  });

  it("template workbook round-trips through the parser", () => {
    const buffer = buildTemplateWorkbook();
    const { rows } = parseRosterWorkbook(buffer);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].fullName).toBeTruthy();
  });

  it("reads xlsm workbook bytes through the same roster parser", () => {
    const buffer = makeWorkbook([
      ["Name", "Program", "Level", "Start", "End"],
      ["Macro File", "UT Houston Adult Neurology", "PGY-3", "2026-07-03", "2026-07-09"]
    ], "xlsm");
    const { rows } = parseRosterWorkbook(buffer);
    expect(rows[0]).toMatchObject({
      fullName: "Macro File",
      program: "UT Adult Neuro",
      schoolType: "ut-adult"
    });
  });

  it("maps real roster program aliases before fuzzy matching", () => {
    const buffer = makeWorkbook([
      ["Name", "Program", "Level", "Start", "End"],
      ["Methodist Rotator", "Methodist Adult Neurology", "PGY-3", "2026-07-06", "2026-08-02"],
      ["Adult Rotator", "UT Houston Adult Neurology", "PGY-4", "2026-07-03", "2026-07-09"],
      ["Peds Rotator", "UT Houston Pediatrics", "PGY-2", "2026-07-06", "2026-07-26"],
      ["Psych Intern", "UT Houston Psychiatry Intern", "PGY-1", "2026-12-18", "2027-01-17"],
      ["Child Psych Fellow", "UTH Child Psychiatry Fellow", "PGY-5", "2026-07-01", "2026-08-31"],
      ["Pedi Neuro Resident", "UT Pediatric Neurology", "PGY-4", "2026-07-17", "2026-07-30"],
      ["Pedi Neuro Fellow", "UT Pediatric Neurology", "PGY-5", "2026-07-17", "2026-07-30"]
    ]);
    const { rows } = parseRosterWorkbook(buffer);
    expect(rows.map((r) => r.program)).toEqual([
      "Methodist",
      "UT Adult Neuro",
      "UT Pediatrics",
      "UT Psychiatry",
      "UT Psychiatry",
      "UT Pediatrics",
      "UT Pediatric Neurology Fellow"
    ]);
    expect(rows[0].schoolType).toBe("methodist");
    expect(rows[4].role).toBe("Resident");
    expect(rows[5].role).toBe("Resident");
    expect(rows[6].role).toBe("Fellow");
  });

  it("treats weekday-only Unavailable values as day off, not invalid date ranges", () => {
    const buffer = makeWorkbook([
      ["Name", "Program", "Level", "Start", "End", "Continuity Clinic", "Unavailable"],
      ["Child Psych Fellow", "UTH Child Psychiatry Fellow", "PGY-5", "2026-07-01", "2026-08-31", "Wednesday PM", "Wednesday"]
    ]);
    const { rows, warnings } = parseRosterWorkbook(buffer);
    expect(rows[0].dayOff).toEqual(["Wednesday"]);
    expect(rows[0].unavailableRanges).toEqual([]);
    expect(warnings.some((w) => /weekday text in Unavailable/i.test(w))).toBe(true);
  });

  it("surfaces blank levels as Unknown instead of silently defaulting to PGY-2", () => {
    const buffer = makeWorkbook([
      ["Name", "Program", "Level", "Start", "End"],
      ["Peds Blank Level", "UT Houston Pediatrics", "", "2026-07-06", "2026-07-26"]
    ]);
    const { rows, warnings } = parseRosterWorkbook(buffer);
    expect(rows[0].level).toBe("Unknown");
    expect(rows[0].role).toBe("Resident");
    expect(warnings.some((w) => /missing a level/i.test(w))).toBe(true);
  });

  it("parses a matrix-format workbook (date row + B/!B presence cells)", () => {
    // Realistic shape: column 0 = index, column 1 = name, columns 2+ = week-start dates.
    // Coverage with non-uniform gaps (7/1 -> 7/6 is only 5 days, like a July-4 short week).
    const dateHeaders = ["6/24", "7/1", "7/6", "7/13", "7/20", "7/27", "8/3", "8/10"];
    const buffer = makeWorkbook([
      ["",  "",            ...dateHeaders],
      ["",  "Week #",      "0", "1", "2", "3", "4", "5", "6", "7"],
      ["1st","Number of Residents", "0", "1", "1", "2", "2", "1", "1", "0"],
      ["2", "Jordan Lee",  "",     "B",   "B",   "B",    "",    "",   "",   ""],
      ["4", "Casey Moore", "",     "!B",  "",    "B",    "B",   "",   "",   ""]
    ]);
    const { rows, warnings, columnsFound } = parseRosterWorkbook(buffer);
    expect(columnsFound).toEqual(["matrix"]);
    expect(rows).toHaveLength(2);

    const jordan = rows.find((r) => r.fullName === "Jordan Lee");
    // Three consecutive Bs starting 7/1 should coalesce into ONE segment
    // 7/1 → (7/20 - 1 day = 7/19).
    expect(jordan.segments).toHaveLength(1);
    expect(jordan.segments[0].end > jordan.segments[0].start).toBe(true);

    const casey = rows.find((r) => r.fullName === "Casey Moore");
    // 7/1 (!B) alone + 7/13 and 7/20 together → two segments
    expect(casey.segments).toHaveLength(2);

    // The "!B" cell triggers a flag warning citing the rotator's name.
    expect(warnings.some((w) => w.includes("Casey Moore"))).toBe(true);
  });

  it("matrix layout is case-insensitive for B / !B presence cells", () => {
    // Regression: cells with lowercase "b" used to be silently dropped,
    // marking a rotator as off-service for that week.
    const dateHeaders = ["6/24", "7/1", "7/6", "7/13", "7/20", "7/27", "8/3", "8/10"];
    const buffer = makeWorkbook([
      ["",  "",          ...dateHeaders],
      ["",  "Week #",    "0", "1", "2", "3", "4", "5", "6", "7"],
      ["1", "Lower B",   "",  "b", "B", "",  "",  "",  "",  ""],
      ["2", "Lower Bang","",  "!b","",  "",  "",  "",  "",  ""]
    ]);
    const { rows, columnsFound, warnings } = parseRosterWorkbook(buffer);
    expect(columnsFound).toEqual(["matrix"]);
    const lower = rows.find((r) => r.fullName === "Lower B");
    expect(lower).toBeTruthy();
    expect(lower.segments.length).toBeGreaterThan(0);
    // !b still produces a flag warning (matches "!B" semantics).
    expect(warnings.some((w) => w.includes("Lower Bang"))).toBe(true);
  });

  it("matrixBangBehavior exclude drops !B weeks, matching the backend parser", () => {
    const dateHeaders = ["6/24", "7/1", "7/6", "7/13", "7/20", "7/27", "8/3", "8/10"];
    const grid = [
      ["",  "",           ...dateHeaders],
      ["",  "Week #",     "0", "1", "2", "3", "4", "5", "6", "7"],
      ["1", "Bang Week",  "",  "!B", "B", "",  "",  "",  "",  ""]
    ];

    // Default ("present"): the !B week joins the run.
    const present = parseRosterWorkbook(makeWorkbook(grid));
    const presentRow = present.rows.find((r) => r.fullName === "Bang Week");
    expect(presentRow.segments).toHaveLength(1);
    expect(presentRow.segments[0].start).toMatch(/-07-01$/);

    // "exclude": the !B week is treated as absent, so coverage starts 7/6.
    const excluded = parseRosterWorkbook(makeWorkbook(grid), { matrixBangBehavior: "exclude" });
    const excludedRow = excluded.rows.find((r) => r.fullName === "Bang Week");
    expect(excludedRow.segments).toHaveLength(1);
    expect(excludedRow.segments[0].start).toMatch(/-07-06$/);
  });

  it("toIsoDate fallback emits the literal calendar date even in non-US timezones (no off-by-one)", () => {
    // Regression: the textual fallback used `new Date(text)` (local-time
    // parse) but then `formatDate` read getUTC*, dropping one calendar
    // day for any timezone east of UTC. The fix reads back local
    // components so the ISO date matches what a human sees in the cell.
    // We can't change TZ at runtime in vitest, but the simpler test —
    // that "May 4 2026" round-trips to "2026-05-04" in the host TZ — is
    // sufficient to prevent the buggy code from being re-introduced
    // (the old code would also pass in UTC but fail in Tokyo).
    const buffer = makeWorkbook([
      ["Name", "Program", "Level", "Start", "End"],
      ["TZ Test", "UT Pediatrics", "PGY-2", "May 4 2026", "May 31 2026"]
    ]);
    const { rows } = parseRosterWorkbook(buffer);
    expect(rows[0].segments).toEqual([{ start: "2026-05-04", end: "2026-05-31" }]);
  });

  it("two-digit year uses a sliding window pivoting on the current year", () => {
    // Regression: 2-digit years were hardcoded to 20xx, so a roster cell
    // of 5/4/99 became 2099-05-04 (way in the future). Sliding window:
    // anything more than 5 years past the current year is interpreted
    // as 19xx; recent two-digit years stay 20xx.
    const buffer = makeWorkbook([
      ["Name", "Program", "Level", "Start", "End"],
      ["Recent", "UT Pediatrics", "PGY-2", "5/4/26", "5/31/26"],
      ["Old", "UT Pediatrics", "PGY-2", "5/4/99", "5/31/99"]
    ]);
    const { rows } = parseRosterWorkbook(buffer);
    const recent = rows.find((r) => r.fullName === "Recent");
    const old = rows.find((r) => r.fullName === "Old");
    expect(recent.segments[0].start).toBe("2026-05-04");
    expect(old.segments[0].start.startsWith("19")).toBe(true);
  });

  it("duplicate column synonyms produce a warning instead of silently dropping the second column", () => {
    // Regression: when both "Provider Name" and "Rotator Name" appear,
    // findIndex used to pick the first and silently ignore the second.
    // Now the user gets a warning so they can resolve via column mapping.
    const buffer = makeWorkbook([
      ["Provider Name", "Rotator Name", "Program", "Level", "Start", "End"],
      ["Jane Doe", "Alex Stone", "UT Pediatrics", "PGY-2", "2026-05-04", "2026-05-31"]
    ]);
    const { warnings } = parseRosterWorkbook(buffer);
    expect(warnings.some((w) => /Provider Name.*Rotator Name|Rotator Name.*Provider Name/.test(w))).toBe(true);
  });

  it("expands hyphen and 'through' day-off ranges into full weekday lists", () => {
    // Regression: "Mon-Fri" used to leave the entire string as one token
    // that startsWith("mon") matched as just Monday — silently dropping
    // Tue/Wed/Thu/Fri from the rotator's day-off list.
    const buffer = makeWorkbook([
      ["Name", "Program", "Level", "Start", "End", "Day Off"],
      ["Range Tester A", "UT Pediatrics", "PGY-2", "2026-05-04", "2026-05-31", "Mon-Fri"],
      ["Range Tester B", "UT Pediatrics", "PGY-2", "2026-05-04", "2026-05-31", "Tuesday through Thursday"],
      ["Range Tester C", "UT Pediatrics", "PGY-2", "2026-05-04", "2026-05-31", "Saturday to Sunday"]
    ]);
    const { rows } = parseRosterWorkbook(buffer);
    const [a, b, c] = rows;
    expect(a.dayOff.sort()).toEqual(["Friday", "Monday", "Thursday", "Tuesday", "Wednesday"].sort());
    expect(b.dayOff.sort()).toEqual(["Thursday", "Tuesday", "Wednesday"].sort());
    expect(c.dayOff.sort()).toEqual(["Saturday", "Sunday"].sort());
  });
});

describe("mergeRotators", () => {
  const existing = createDemoState().rotators;

  it("merges by name, keeping ids stable and unioning segments", () => {
    const parsed = [
      // Same name as existing[0] (Maya Lopez) but with a fresh segment that
      // extends past the original; the union should hold both segments.
      {
        ...existing[0],
        program: "Methodist",
        segments: [{ start: "2026-06-01", end: "2026-06-30" }]
      },
      {
        id: "rot-new-1",
        fullName: "Brand New",
        displayName: "Brand New",
        program: "UT Pediatrics",
        level: "PGY-1",
        role: "Resident",
        segments: [{ start: "2026-05-04", end: "2026-05-31" }],
        schoolType: "ut-peds",
        continuityClinic: ""
      }
    ];
    const result = mergeRotators(existing, parsed, "merge");
    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.rotators).toHaveLength(existing.length + 1);
    const updated = result.rotators.find((r) => r.fullName === existing[0].fullName);
    expect(updated.id).toBe(existing[0].id);
    expect(updated.segments).toEqual([
      { start: "2026-05-04", end: "2026-05-31" },
      { start: "2026-06-01", end: "2026-06-30" }
    ]);
  });

  it("two parsed rows with the same name produce a multi-segment rotator after merge", () => {
    // Simulates a roster spreadsheet where Carlos has two separate
    // rotation windows entered as two rows.
    const parsed = [
      {
        id: "rot-carlos-1",
        fullName: "Carlos Reyes",
        displayName: "Carlos Reyes",
        program: "Methodist",
        level: "PGY-3",
        role: "Resident",
        segments: [{ start: "2026-05-01", end: "2026-05-07" }],
        schoolType: "methodist",
        continuityClinic: "Tuesday PM",
        dayOff: [],
        unavailableRanges: []
      },
      {
        id: "rot-carlos-2",
        fullName: "Carlos Reyes",
        displayName: "Carlos Reyes",
        program: "Methodist",
        level: "PGY-3",
        role: "Resident",
        segments: [{ start: "2026-05-24", end: "2026-05-31" }],
        schoolType: "methodist",
        continuityClinic: "Tuesday PM",
        dayOff: [],
        unavailableRanges: []
      }
    ];
    const result = mergeRotators([], parsed, "merge");
    expect(result.rotators).toHaveLength(1);
    expect(result.rotators[0].segments).toEqual([
      { start: "2026-05-01", end: "2026-05-07" },
      { start: "2026-05-24", end: "2026-05-31" }
    ]);
  });

  it("replace mode drops existing rotators", () => {
    const parsed = [{ id: "x", fullName: "Solo", program: "Other", level: "Fellow", segments: [], schoolType: "other", continuityClinic: "" }];
    const result = mergeRotators(existing, parsed, "replace");
    expect(result.rotators).toEqual(parsed);
    expect(result.removed).toBe(existing.length);
  });

  it("add mode appends without deduplicating", () => {
    const result = mergeRotators(existing, [existing[0]], "add");
    expect(result.rotators).toHaveLength(existing.length + 1);
  });

  it("merge mode does not clobber a real program/continuityClinic with importer fallbacks", () => {
    // Regression: a second row for the same rotator with a blank Program
    // cell would land in parsedRows as program:"Other" / continuityClinic:""
    // and the previous `{...existing, ...row}` spread would clobber the
    // real Methodist + Tuesday-PM clinic with those defaults.
    const existingRoster = [
      {
        id: "rot-carlos",
        fullName: "Carlos Reyes",
        displayName: "Carlos Reyes",
        program: "Methodist",
        level: "PGY-3",
        role: "Resident",
        segments: [{ start: "2026-05-01", end: "2026-05-07" }],
        schoolType: "methodist",
        continuityClinic: "Tuesday PM",
        dayOff: ["Saturday"],
        unavailableRanges: [{ start: "2026-05-25", end: "2026-05-25" }]
      }
    ];
    const sparseRow = {
      id: "rot-carlos-2",
      fullName: "Carlos Reyes",
      displayName: "Carlos Reyes",
      program: "Other",
      level: "PGY-2",
      role: "Resident",
      segments: [{ start: "2026-05-24", end: "2026-05-31" }],
      schoolType: "other",
      continuityClinic: "",
      dayOff: [],
      unavailableRanges: []
    };
    const { rotators } = mergeRotators(existingRoster, [sparseRow], "merge");
    expect(rotators).toHaveLength(1);
    const merged = rotators[0];
    expect(merged.program).toBe("Methodist");
    expect(merged.schoolType).toBe("methodist");
    expect(merged.continuityClinic).toBe("Tuesday PM");
    expect(merged.dayOff).toEqual(["Saturday"]);
    expect(merged.unavailableRanges).toEqual([{ start: "2026-05-25", end: "2026-05-25" }]);
    expect(merged.segments).toEqual([
      { start: "2026-05-01", end: "2026-05-07" },
      { start: "2026-05-24", end: "2026-05-31" }
    ]);
  });
});

describe("applyColumnMapping", () => {
  const headers = ["Name", "Program", "Level", "Start", "End", "Continuity Clinic", "Day Off", "Unavailable"];
  const dataRows = [
    ["Jane Doe", "UT Pediatrics", "PGY-2", "2026-05-04", "2026-05-31", "Tuesday PM", "Wednesday", "2026-05-20 to 2026-05-22"],
    ["Carlos Reyes", "Methodist", "PGY-3", "2026-05-04", "2026-05-17", "", "Mon, Fri", ""]
  ];
  const detected = { fullName: 0, program: 1, level: 2, startDate: 3, endDate: 4, continuityClinic: 5, dayOff: 6, unavailableRanges: 7 };

  it("builds rotators from an explicit colIndex mapping", () => {
    const { rows, warnings } = applyColumnMapping(headers, dataRows, detected);
    expect(rows).toHaveLength(2);
    expect(rows[0].fullName).toBe("Jane Doe");
    expect(rows[0].segments).toEqual([{ start: "2026-05-04", end: "2026-05-31" }]);
    expect(rows[0].dayOff).toEqual(["Wednesday"]);
    expect(rows[1].schoolType).toBe("methodist");
    expect(warnings).toHaveLength(0);
  });

  it("skips rows with a blank Name cell", () => {
    const rowsIn = [
      ["", "UT Pediatrics", "PGY-2", "2026-05-04", "2026-05-31"],
      ["Jane Doe", "UT Pediatrics", "PGY-2", "2026-05-04", "2026-05-31"]
    ];
    const { rows } = applyColumnMapping(headers, rowsIn, detected);
    expect(rows).toHaveLength(1);
    expect(rows[0].fullName).toBe("Jane Doe");
  });

  it("warns per row when Start or End is mapped to null", () => {
    const mapping = { ...detected, startDate: undefined };
    const { rows, warnings } = applyColumnMapping(headers, dataRows, mapping);
    expect(rows[0].segments).toEqual([]); // no segments without both endpoints
    expect(warnings.some((w) => /missing a start date/i.test(w))).toBe(true);
  });

  it("respects a mapping that differs from auto-detect (Start points elsewhere)", () => {
    // Move Start to column 4 (originally End) and End to column 3 (originally Start)
    const swapped = { ...detected, startDate: 4, endDate: 3 };
    const { rows } = applyColumnMapping(headers, dataRows, swapped);
    expect(rows[0].segments[0].start).toBe("2026-05-31");
    expect(rows[0].segments[0].end).toBe("2026-05-04");
  });

  it("handles duplicate-header columns when caller picks the second occurrence", () => {
    const dupHeaders = ["Name", "Start", "Start"];
    const rowsIn = [["Jane Doe", "2026-05-04", "2026-05-31"]];
    // Caller picks the second Start column as the end date
    const mapping = { fullName: 0, startDate: 1, endDate: 2 };
    const { rows } = applyColumnMapping(dupHeaders, rowsIn, mapping);
    expect(rows[0].segments[0]).toEqual({ start: "2026-05-04", end: "2026-05-31" });
  });

  it("handles a blank-header column when caller picks it by index", () => {
    const blankHeaders = ["Name", "", "End"];
    const rowsIn = [["Jane Doe", "2026-05-04", "2026-05-31"]];
    const mapping = { fullName: 0, startDate: 1, endDate: 2 };
    const { rows } = applyColumnMapping(blankHeaders, rowsIn, mapping);
    expect(rows[0].segments[0]).toEqual({ start: "2026-05-04", end: "2026-05-31" });
  });

  it("defaultStart / defaultEnd fill in for empty cells", () => {
    const rowsIn = [["Jane Doe", "UT Pediatrics", "PGY-2", "", ""]];
    const { rows } = applyColumnMapping(headers, rowsIn, detected, {
      defaultStart: "2026-06-01",
      defaultEnd: "2026-06-30"
    });
    expect(rows[0].segments).toEqual([{ start: "2026-06-01", end: "2026-06-30" }]);
  });

  describe("rotationStartDate column", () => {
    const headersWithRotationStart = [...headers, "Methodist Start"];
    const mappingWithRotationStart = { ...detected, rotationStartDate: 8 };

    it("applies the explicit rotation-start column to a Methodist rotator", () => {
      const rowsIn = [
        ["Carlos Reyes", "Methodist", "PGY-3", "2026-05-04", "2026-05-17", "", "Mon, Fri", "", "2026-05-01"]
      ];
      const { rows } = applyColumnMapping(headersWithRotationStart, rowsIn, mappingWithRotationStart);
      expect(rows[0].schoolType).toBe("methodist");
      expect(rows[0].rotationStartDate).toBe("2026-05-01");
    });

    it("ignores the rotation-start column for a non-Methodist rotator", () => {
      const rowsIn = [
        ["Jane Doe", "UT Pediatrics", "PGY-2", "2026-05-04", "2026-05-31", "Tuesday PM", "Wednesday", "", "2026-05-01"]
      ];
      const { rows } = applyColumnMapping(headersWithRotationStart, rowsIn, mappingWithRotationStart);
      expect(rows[0].schoolType).not.toBe("methodist");
      expect(rows[0].rotationStartDate).toBeUndefined();
    });

    it("leaves rotationStartDate unset when the column is absent", () => {
      const rowsIn = [
        ["Carlos Reyes", "Methodist", "PGY-3", "2026-05-04", "2026-05-17", "", "Mon, Fri", ""]
      ];
      const { rows } = applyColumnMapping(headers, rowsIn, detected);
      expect(rows[0].schoolType).toBe("methodist");
      expect(rows[0].rotationStartDate).toBeUndefined();
    });
  });
});

describe("parseRosterWorkbook — new return-shape fields", () => {
  it("returns headers, dataRows, detectedMapping, headerRowIndex on a template file", () => {
    const buffer = makeWorkbook([
      ["Name", "Program", "Level", "Start", "End"],
      ["Jane Doe", "UT Pediatrics", "PGY-2", "2026-05-04", "2026-05-31"]
    ]);
    const result = parseRosterWorkbook(buffer);
    expect(result.isMatrix).toBe(false);
    expect(result.templateParse).not.toBeNull();
    expect(result.templateParse.headers).toEqual(["Name", "Program", "Level", "Start", "End"]);
    expect(result.templateParse.dataRows).toHaveLength(1);
    expect(result.templateParse.detectedMapping.fullName).toBe(0);
    expect(result.templateParse.detectedMapping.startDate).toBe(3);
    expect(result.templateParse.headerRowIndex).toBe(0);
  });

  it("returns isMatrix:true and a matrixParse with rows for a wide-grid file", () => {
    // Build a small matrix: a date row spanning ≥6 columns + one rotator row.
    // tryParseMatrixWorkbook needs grid.length >= 3, so add a leading junk row.
    const dateHeader = ["", "Name", "5/4", "5/11", "5/18", "5/25", "6/1", "6/8"];
    const rotator = ["1", "Jordan Lee", "B", "B", "B", "B", "", ""];
    const buffer = makeWorkbook([dateHeader, ["", "Week #", "0", "1", "2", "3", "4", "5"], rotator]);
    const result = parseRosterWorkbook(buffer);
    expect(result.isMatrix).toBe(true);
    expect(result.matrixParse).not.toBeNull();
    expect(result.matrixParse.rows).toHaveLength(1);
    expect(result.matrixParse.rows[0].fullName).toBe("Jordan Lee");
  });

  it("headerRowIndex matches the row containing Name when prefixed by junk rows", () => {
    const buffer = makeWorkbook([
      ["UT Pediatrics Residency Roster"],
      [""],
      ["Name", "Program", "Start", "End"],
      ["Jane Doe", "UT Pediatrics", "2026-05-04", "2026-05-31"]
    ]);
    const result = parseRosterWorkbook(buffer);
    expect(result.templateParse.headerRowIndex).toBe(2);
    expect(result.rows).toHaveLength(1);
  });

  it("no longer emits the legacy 'couldn't find start/end column' warning", () => {
    const buffer = makeWorkbook([
      ["Name", "Program", "Level"],
      ["Jane Doe", "UT Pediatrics", "PGY-2"]
    ]);
    const result = parseRosterWorkbook(buffer);
    // Per-row missing-date warnings stay; the panel-level deletion is
    // verified by checking the legacy text isn't present.
    expect(result.warnings.some((w) => /couldn't find a/i.test(w))).toBe(false);
  });
});

describe("start/end column synonyms (Coordinator-2)", () => {
  // Coordinator reported that start/end dates weren't carrying from her
  // source template to rotator profiles. The fix has two parts: a wide
  // synonym net here and the column-mapping UI in App.jsx. These tests
  // lock in the synonyms that auto-detect must recognize.
  const startHeaderVariants = [
    "Start", "Start Date", "StartDate", "Begin", "From",
    "Rotation Start", "Service Start", "Block Start", "On Service",
    "First Day", "Starting", "Arrival", "In"
  ];
  const endHeaderVariants = [
    "End", "End Date", "EndDate", "Finish", "To", "Thru", "Through",
    "Rotation End", "Service End", "Block End", "Off Service",
    "Last Day", "Ending", "Departure", "Out"
  ];

  for (const startHeader of startHeaderVariants) {
    it(`auto-detects "${startHeader}" as the start column`, () => {
      const buffer = makeWorkbook([
        ["Name", "Program", startHeader, "End"],
        ["Jane Doe", "UT Pediatrics", "2026-05-04", "2026-05-31"]
      ]);
      const result = parseRosterWorkbook(buffer);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].segments).toEqual([{ start: "2026-05-04", end: "2026-05-31" }]);
    });
  }

  for (const endHeader of endHeaderVariants) {
    it(`auto-detects "${endHeader}" as the end column`, () => {
      const buffer = makeWorkbook([
        ["Name", "Program", "Start", endHeader],
        ["Jane Doe", "UT Pediatrics", "2026-05-04", "2026-05-31"]
      ]);
      const result = parseRosterWorkbook(buffer);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].segments).toEqual([{ start: "2026-05-04", end: "2026-05-31" }]);
    });
  }
});

describe("rotationStartDate header detection", () => {
  const methodistHeaderVariants = [
    "Methodist Start", "Methodist Start Date", "Methodist Rotation Start", "Cycle Start", "14/14 Start",
    "Methodist Rotation Start Date"
  ];

  for (const header of methodistHeaderVariants) {
    it(`auto-detects "${header}" as the Methodist rotation-start column`, () => {
      const buffer = makeWorkbook([
        ["Name", "Program", "Start", "End", header],
        ["Carlos Reyes", "Methodist", "2026-05-04", "2026-05-31", "2026-05-01"]
      ]);
      const result = parseRosterWorkbook(buffer);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].rotationStartDate).toBe("2026-05-01");
      // The segment window must still come from the Start/End columns.
      expect(result.rows[0].segments).toEqual([{ start: "2026-05-04", end: "2026-05-31" }]);
      // Start date present — no missing-rotation-start warning.
      expect(result.warnings).toHaveLength(0);
    });
  }

  it('keeps "Rotation Start" mapped to the segment start, never the 14/14 anchor', () => {
    // "Rotation Start" has always been a segment-start synonym (Coordinator-2
    // wide net). It must NOT double as the Methodist anchor — that would
    // silently guess a 14/14 start date from a column that means something
    // else.
    const buffer = makeWorkbook([
      ["Name", "Program", "Rotation Start", "End"],
      ["Carlos Reyes", "Methodist", "2026-05-04", "2026-05-31"]
    ]);
    const result = parseRosterWorkbook(buffer);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].segments).toEqual([{ start: "2026-05-04", end: "2026-05-31" }]);
    expect(result.rows[0].rotationStartDate).toBeUndefined();
  });
});

describe("parseRosterFromArrayBuffer (Phase 8.2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeTemplateBuffer() {
    return buildTemplateWorkbook();
  }

  // TEST-001 fix (2026-05-24): POST /api/import/excel is NOT implemented in the
  // Python/FastAPI backend — it always returns 404 in production. The real
  // shipping path is: fetch is attempted, response.ok is false (404), function
  // falls back to browser-side parseRosterWorkbook(). The previous test mocked a
  // 200 response from the backend, which can never happen in production and
  // asserted a code path that is dead. Replaced with a 404-fallback assertion.
  it("falls back to browser parsing when backend returns 404 (shipped production path)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({})
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await parseRosterFromArrayBuffer(makeTemplateBuffer());

    // Confirm the backend was attempted (fetch was called with the expected route).
    expect(fetchSpy).toHaveBeenCalledWith("/api/import/excel", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/octet-stream" }
    }));
    // Confirm the browser-parse fallback ran and returned the correct shape.
    expect(Array.isArray(result.rows)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.columnsFound)).toBe(true);
    // The template workbook contains at least one parseable example row.
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("falls back to local parse when backend returns non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({})
    }));

    const result = await parseRosterFromArrayBuffer(makeTemplateBuffer());

    // Local parse returns the template's example row.
    expect(Array.isArray(result.rows)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.columnsFound)).toBe(true);
  });

  it("falls back to local parse when fetch throws (backend down)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await parseRosterFromArrayBuffer(makeTemplateBuffer());

    expect(Array.isArray(result.rows)).toBe(true);
  });

  it("never tries backend when { tryBackend: false }", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await parseRosterFromArrayBuffer(makeTemplateBuffer(), { tryBackend: false });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Array.isArray(result.rows)).toBe(true);
  });
});
