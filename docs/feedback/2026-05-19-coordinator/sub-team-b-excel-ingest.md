# Auto-create rotator profiles from uploaded Excel roster

## 1. Team structure

Downgraded from full ceremony to a single-Lead pass with internal critique and
verification — the task was well-bounded (Excel parser + ingest UI + tests) and
splitting it across specialists would have cost more than it bought.

- Lead (sub-team-b) — owned design, parser implementation, UI wiring, verification.
- Internal critic pass — challenged column-mismatch handling, duplicate-name
  collisions, large-roster vs. small-existing-state interactions, date format
  drift between Excel cells and ISO strings.
- Internal verifier pass — ran `npm test`, `npm run test:offline`, `npm run build`;
  added 8 vitest cases covering the parser and merge logic.

## 2. Result

**Files landed**

- New: `src/excelImport.js` — parses an .xlsx ArrayBuffer into rotator-shaped
  rows, merges them with the existing roster, and can generate a blank
  template workbook.
- New: `src/excelImport.test.js` — 8 vitest cases (header synonyms, weekday
  parsing, unavailable-range parsing, replace/merge/add modes, template
  round-trip, plain-English error on missing name column).
- Edited: `src/scheduler.js` — added `applyImportedRoster(state, mergeResult,
  sourceMeta)` which atomically swaps the rotator list and appends a source
  record for the upload, preserving sub-team-a's `parsedRows` / `content`
  fields on sources.
- Edited: `src/App.jsx` — Sources tab now (a) detects .xlsx/.xls uploads, (b)
  parses them via `parseRosterWorkbook`, (c) opens a confirmation modal
  showing a preview + warnings + three options (Add new and update matches /
  Replace existing roster / Add all as new), and (d) offers a "Download blank
  roster template" button so users see the expected layout.
- `package.json` — added `xlsx ^0.18.5` (bundled, runs offline; no network).

**How it behaves**

- Accepted column headers (case- and whitespace-insensitive, with common
  synonyms): Name / Program / Level / Start / End / Continuity Clinic /
  Day Off / Unavailable. Synonyms include "Provider Name", "Service", "PGY",
  "Begins", "Ends", "Out of office", etc.
- Programs are matched against `PROGRAMS`; unknown values fall back to
  "Other" with a per-row warning shown in the confirmation modal.
- Dates accept ISO ("2026-05-04"), US slash ("5/4/2026"), Excel serial dates,
  and native JS Date cells (SheetJS `cellDates: true`).
- Empty rows and rows without a name are skipped silently. Header row is
  auto-located within the first 10 rows of sheet 1.
- All user-facing strings are plain English (no "JSON", "schema", "parse
  error", etc.). Errors read like: "We couldn't find a name column in this
  spreadsheet."
- Re-upload behaviour is explicit: the user picks one of three modes in a
  modal — defaulting to the safe "merge by name, keep ids stable" path so
  existing schedule references (inpatient assignments etc.) keep working.

**Verification**

- `npm test` — 14/14 vitest tests pass (6 pre-existing + 8 new).
- `npm run test:offline` — 4/4 pass; the offline contract test confirms no
  `fetch` / `XMLHttpRequest` / `http(s)://` / `WebSocket` / `sendBeacon`
  appears in `src/`. `xlsx` is bundled from `node_modules` and runs locally.
- `npm run build` — clean Vite build (one expected size warning, no errors).

## 3. Critical review

**Major objections raised:**

- *Column mismatch / unknown headers:* original parser was too rigid. Mitigated
  with synonym table + auto-locating header row.
- *Duplicate names on re-upload:* a silent merge could change someone's id and
  break inpatient/outpatient assignments that reference rotators by id. Fixed
  by making merge keep the existing rotator's id and offering replace/add-all
  as explicit alternatives via modal.
- *Large Excel (200 rows) vs. small existing state (5):* preview modal caps at
  first 8 rows with an "...and N more will also be imported" hint; no
  performance issue at this scale.
- *Date parsing brittleness:* an early version of the unavailable-range regex
  mis-split ISO dates on the `-` separator (turning "2026-05-20 to 2026-05-22"
  into "2026" + "05-20 to 2026-05-22"). Caught by the first vitest run;
  tightened the splitter to require whitespace around the separator.
- *Files lost in the user's pipeline:* an unparseable .xlsx used to silently
  end up as a content blob. Now: parse failure shows a plain-English notice;
  the file isn't added unless the user confirms in the modal.

**Remaining uncertainty / risk:**

- We don't have Coordinator's actual roster file. The synonym table covers the
  obvious column names; if her sheet uses something exotic ("Trainee Code"
  for level, etc.) we'll need to extend `COLUMN_SYNONYMS`.
- `xlsx` 0.18.5 has an npm audit advisory (prototype pollution in older
  versions; 0.18.5 is the latest published on npm). Flagging it; not blocking.
- The default merge mode never deletes rotators, even if a name disappears
  from the next upload. That's intentional (avoids clobbering manual edits)
  but means a stale rotator can linger. Replace mode handles it explicitly.

## 4. Codex usage

Not used. The parser was small enough (~250 lines) that hand-writing it with
inline tests was faster than handing it to Codex.

## 5. Coordination notes for the Meta-Lead

- **Rotator fields populated** (no breaking changes to `continuityClinic`):
  - `dayOff: string[]` — canonical weekday names: "Sunday".."Saturday".
  - `unavailableRanges: Array<{ start: string, end: string }>` — ISO YYYY-MM-DD
    strings; single-day entries set start === end.
  - These names match what sub-team-c was told to use; their editor UI should
    drop in without translation.
- **Source record field name** for parsed Excel content: I store a
  human-readable preview table on `source.parsedRows` (array of plain objects
  keyed by display column names: Name / Program / Level / Start / End /
  Continuity Clinic / Day Off / Unavailable). That keeps sub-team-a's
  SourceViewer rendering correctly without changes. I also add
  `source.importedRotatorCount` so the Reviewed Sources panel can show how
  many profiles came from each upload if anyone wants to surface it.
- **New scheduler.js export:** `applyImportedRoster(state, mergeResult,
  sourceMeta)` — for any other team that needs to ingest parsed data.

## 6. Commit

- `37186ec` — sources: auto-create rotator profiles from uploaded Excel roster
