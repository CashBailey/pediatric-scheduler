"""Native roster import for CSV, JSON, and XLSX/XLSM files.

This is the Python/native counterpart to the React Sources roster import. It
handles template-style roster files with headers such as Name, Program, Level,
Start, End, Continuity Clinic, Day Off, and Unavailable, then merges rows into
the current scheduler state by full name. Spreadsheet imports also support
matrix-style rosters with week-start date headers and B/!B presence marks.
"""

from __future__ import annotations

import csv
import json
import re
import time
import zipfile
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from backend_py.contracts import CONTRACTS_DIR
from backend_py.domain.draft import infer_school_type
from backend_py.domain.rotators import make_rotator, normalize_segment, slug

PROGRAMS = ["Methodist", "UT Adult Neuro", "UT Pediatrics", "UT Pediatric Neurology Fellow", "UT Med Student", "UT Psychiatry", "Other"]

# The roster-import alias tables are frozen from the canonical JS module
# (shared/scheduler/excel-import.js) by scripts/freeze-contracts.mjs, so the
# browser and backend parsers cannot drift on synonyms, program aliases,
# weekday names, matrix marks, or supported extensions.
_ALIASES = json.loads(
    (CONTRACTS_DIR / "roster-import-aliases.json").read_text(encoding="utf-8")
)

COLUMN_SYNONYMS = _ALIASES["columnSynonyms"]
PROGRAM_ALIASES = _ALIASES["programAliases"]
WEEKDAY_ALIASES = [
    (entry["canonical"], entry["aliases"]) for entry in _ALIASES["weekdayAliases"]
]
WEEKDAYS = [name for name, _aliases in WEEKDAY_ALIASES]
SUPPORTED_EXTENSIONS = set(_ALIASES["rosterFileExtensions"])
MATRIX_MIN_DATE_HEADERS = 6
MATRIX_PRESENT_MARKS = set(_ALIASES["matrixPresentMarks"])
MATRIX_BANG_BEHAVIORS = set(_ALIASES["matrixBangBehaviors"])
MATRIX_SUMMARY_ROW_RE = re.compile(r"^(number of|count|total|residents?|count of)", re.I)


class RosterImportError(ValueError):
    pass


IMPORT_FIELDS = set(COLUMN_SYNONYMS)


def import_roster_file(
    state: dict[str, Any],
    path: str | Path,
    mode: str = "merge",
    *,
    replace_source_id: str | None = None,
    column_mapping: dict[str, Any] | None = None,
    matrix_bang_behavior: str = "present",
) -> dict[str, Any]:
    path = Path(path)
    if mode not in {"merge", "replace", "add"}:
        raise RosterImportError("mode must be merge, replace, or add")
    if not path.is_file():
        raise RosterImportError(f"roster file not found: {path}")
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise RosterImportError("roster import supports .csv, .json, .xlsx, and .xlsm files")

    parsed = parse_roster_file(
        path,
        column_mapping=column_mapping,
        matrix_bang_behavior=matrix_bang_behavior,
    )
    merge = merge_rotators(state.get("rotators") or [], parsed["rows"], mode)
    next_state = {
        **state,
        "rotators": merge["rotators"],
        "sources": _add_source_record(state.get("sources") or [], path, parsed, merge, replace_source_id=replace_source_id),
    }
    return {
        "state": next_state,
        "acceptance": {
            "rows": len(parsed["rows"]),
            "added": merge["added"],
            "updated": merge["updated"],
            "removed": merge["removed"],
            "warnings": len(parsed["warnings"]),
        },
        "warnings": parsed["warnings"],
        "columnsFound": parsed["columnsFound"],
        "importMeta": parsed.get("importMeta", {}),
        "sourceFile": str(path),
    }


def parse_roster_file(
    path: str | Path,
    column_mapping: dict[str, Any] | None = None,
    matrix_bang_behavior: str = "present",
) -> dict[str, Any]:
    path = Path(path)
    suffix = path.suffix.lower()
    if matrix_bang_behavior not in MATRIX_BANG_BEHAVIORS:
        raise RosterImportError("matrixBangBehavior must be present or exclude")
    if column_mapping and suffix == ".json":
        raise RosterImportError("columnMapping is only supported for CSV/XLSX/XLSM template rosters")
    if suffix == ".json":
        return _parse_json_roster(path)
    grid = _csv_grid(path) if suffix == ".csv" else _xlsx_grid(path)
    if suffix in {".xlsx", ".xlsm"} and column_mapping is None:
        matrix = _parse_matrix_grid(grid, matrix_bang_behavior=matrix_bang_behavior, source_label=path.name)
        if matrix:
            return matrix
    return _parse_template_grid(grid, column_mapping=column_mapping, source_label=path.name)


def _csv_grid(path: Path) -> list[list[Any]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [row for row in csv.reader(handle)]


def _parse_json_roster(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise RosterImportError("roster JSON could not be parsed") from exc
    rows = data.get("rotators") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        raise RosterImportError("roster JSON must be an array or an object with a rotators array")
    if rows and all(isinstance(row, dict) and _looks_like_rotator(row) for row in rows):
        normalized = [_normalize_rotator_row(row, index) for index, row in enumerate(rows)]
        return {"rows": normalized, "warnings": [], "columnsFound": ["rotator"]}
    headers = _headers_from_dict_rows(rows)
    grid = [headers] + [[row.get(header, "") if isinstance(row, dict) else "" for header in headers] for row in rows]
    return _parse_template_grid(grid, source_label=path.name)


def _xlsx_grid(path: Path) -> list[list[Any]]:
    try:
        with zipfile.ZipFile(path) as book:
            shared_strings = _xlsx_shared_strings(book)
            sheet_path = _first_sheet_path(book)
            root = ElementTree.fromstring(book.read(sheet_path))
    except (KeyError, zipfile.BadZipFile, ElementTree.ParseError) as exc:
        raise RosterImportError("roster spreadsheet could not be opened") from exc

    rows: list[list[Any]] = []
    for row_el in root.findall(".//{*}sheetData/{*}row"):
        values: list[Any] = []
        for cell in row_el.findall("{*}c"):
            index = _cell_index(cell.attrib.get("r", ""))
            while len(values) <= index:
                values.append("")
            values[index] = _xlsx_cell_value(cell, shared_strings)
        rows.append(values)
    return rows


def _xlsx_shared_strings(book: zipfile.ZipFile) -> list[str]:
    try:
        root = ElementTree.fromstring(book.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    strings = []
    for item in root.findall("{*}si"):
        text = "".join(node.text or "" for node in item.findall(".//{*}t"))
        strings.append(text)
    return strings


def _first_sheet_path(book: zipfile.ZipFile) -> str:
    try:
        workbook = ElementTree.fromstring(book.read("xl/workbook.xml"))
        rels = ElementTree.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    except KeyError:
        return "xl/worksheets/sheet1.xml"
    first_sheet = workbook.find(".//{*}sheet")
    rel_id = _relationship_id(first_sheet) if first_sheet is not None else None
    targets = {rel.attrib.get("Id"): rel.attrib.get("Target") for rel in rels.findall("{*}Relationship")}
    target = targets.get(rel_id) if rel_id else None
    if not target:
        return "xl/worksheets/sheet1.xml"
    target = target.lstrip("/")
    return target if target.startswith("xl/") else f"xl/{target}"


def _relationship_id(element: ElementTree.Element | None) -> str | None:
    if element is None:
        return None
    for key, value in element.attrib.items():
        if key == "id" or key.endswith("}id"):
            return value
    return None


def _xlsx_cell_value(cell: ElementTree.Element, shared_strings: list[str]) -> Any:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//{*}t"))
    value = cell.find("{*}v")
    raw = value.text if value is not None else ""
    if cell_type == "s":
        try:
            return shared_strings[int(raw)]
        except (ValueError, IndexError):
            return ""
    if cell_type == "b":
        return "TRUE" if raw == "1" else "FALSE"
    return raw or ""


def _cell_index(ref: str) -> int:
    letters = re.sub(r"[^A-Za-z]", "", ref)
    if not letters:
        return 0
    value = 0
    for letter in letters.upper():
        value = value * 26 + (ord(letter) - ord("A") + 1)
    return max(0, value - 1)


def _parse_template_grid(
    grid: list[list[Any]],
    column_mapping: dict[str, Any] | None = None,
    source_label: str = "",
) -> dict[str, Any]:
    header_index = -1
    column_map: dict[str, int] = {}
    header_warnings: list[str] = []
    for index, row in enumerate(grid[:10]):
        if _row_is_empty(row):
            continue
        candidate, warnings = _build_column_map(row)
        if "fullName" in candidate:
            header_index = index
            column_map = candidate
            header_warnings = warnings
            break
    if header_index < 0:
        raise RosterImportError("we could not find a Name column in the roster file")

    warnings = list(header_warnings)
    parsed_rows: list[dict[str, Any]] = []
    headers = [str(cell or "").strip() for cell in grid[header_index]]
    data_rows = grid[header_index + 1:]
    detected_mapping = dict(column_map)
    if column_mapping is not None:
        column_map = _normalize_column_mapping(column_mapping, len(headers))
        if "fullName" not in column_map:
            raise RosterImportError("columnMapping must include fullName")

    for offset, raw in enumerate(data_rows):
        if _row_is_empty(raw):
            continue
        full_name = str(_cell(raw, column_map.get("fullName")) or "").strip()
        if not full_name:
            continue
        sheet_row = header_index + offset + 2
        row, row_warnings = _rotator_from_row(raw, column_map, sheet_row, len(parsed_rows), source_label=source_label)
        warnings.extend(row_warnings)
        parsed_rows.append(row)

    if not parsed_rows:
        raise RosterImportError("we found roster headers but no rotator rows")
    missing_start = [
        str(row.get("fullName") or "")
        for row in parsed_rows
        if row.get("schoolType") == "methodist" and not row.get("rotationStartDate")
    ]
    if missing_start:
        # Surface this at import time — otherwise it only appears later as a
        # methodist-no-start warning in the Draft Report.
        warnings.append(
            f"{len(missing_start)} Methodist rotator(s) imported without a rotation start date "
            f"({', '.join(missing_start)}) — their first scheduled day will count as day 1 of the "
            "inpatient/outpatient split unless you set one (Planning Grid > Methodist Setup)."
        )
    return {
        "rows": parsed_rows,
        "warnings": warnings,
        "columnsFound": sorted(column_map),
        "headers": headers,
        "importMeta": {
            "headers": headers,
            "dataRows": data_rows,
            "detectedMapping": detected_mapping,
            "columnMapping": column_map,
            "headerRowIndex": header_index,
            "sourceProgram": _infer_program_from_source_text(source_label),
        },
    }


def _parse_matrix_grid(
    grid: list[list[Any]],
    matrix_bang_behavior: str = "present",
    source_label: str = "",
) -> dict[str, Any] | None:
    if len(grid) < 3:
        return None

    date_row_index = -1
    week_starts: list[dict[str, Any]] = []
    for index, row in enumerate(grid[:5]):
        probed = _probe_matrix_week_starts(row)
        if len(probed) >= MATRIX_MIN_DATE_HEADERS:
            date_row_index = index
            week_starts = probed
            break
    if date_row_index < 0 or not week_starts:
        return None

    first_date_col = int(week_starts[0]["col"])
    name_col = first_date_col - 1 if first_date_col > 0 else 0
    first_rotator_row = date_row_index + 1
    while first_rotator_row < len(grid):
        name = _matrix_name(grid[first_rotator_row], name_col, first_date_col)
        if name and not MATRIX_SUMMARY_ROW_RE.match(name):
            break
        first_rotator_row += 1

    rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    flagged_cell_rotators: list[str] = []
    saw_matrix_rotator = False
    for index in range(first_rotator_row, len(grid)):
        raw = grid[index]
        if _row_is_empty(raw):
            continue
        full_name = _matrix_name(raw, name_col, first_date_col)
        if not full_name or MATRIX_SUMMARY_ROW_RE.match(full_name):
            continue
        saw_matrix_rotator = True

        segments: list[dict[str, str]] = []
        run_start: str | None = None
        run_end: str | None = None
        flagged_this_row = False
        for week_index, week in enumerate(week_starts):
            cell = str(_cell(raw, int(week["col"])) or "").strip()
            mark = cell.upper()
            if mark == "!B":
                flagged_this_row = True
                if matrix_bang_behavior == "exclude":
                    continue
            if mark not in MATRIX_PRESENT_MARKS:
                continue

            iso_start = str(week["isoStart"])
            next_start = str(week_starts[week_index + 1]["isoStart"]) if week_index + 1 < len(week_starts) else ""
            iso_end = _add_days_to_iso(next_start, -1) if next_start else _add_days_to_iso(iso_start, 6)
            if run_start is None:
                run_start = iso_start
                run_end = iso_end
            elif iso_start == _add_days_to_iso(str(run_end), 1):
                run_end = iso_end
            else:
                segments.append({"start": run_start, "end": str(run_end)})
                run_start = iso_start
                run_end = iso_end

        if run_start is not None:
            segments.append({"start": run_start, "end": str(run_end)})
        if flagged_this_row:
            flagged_cell_rotators.append(full_name)
        if not segments:
            warnings.append(f"{full_name}: no weeks marked present, so they were skipped.")
            continue

        program = _infer_program_from_source_text(source_label, "UT Pediatrics")
        rows.append(
            _apply_role_signals(
                make_rotator(f"rot-{slug(full_name)}-{index}", full_name, program, "PGY-2", segments),
                program,
                "PGY-2",
                source_label=source_label,
            )
        )

    if not rows and not saw_matrix_rotator:
        return None

    first_date = str(week_starts[0]["isoStart"])
    last_date = str(week_starts[-1]["isoStart"])
    warnings.insert(
        0,
        f'Read this as a grid-style roster covering {first_date} to {last_date}. '
        f'Each "B" mark became a week the provider is on service; "!B" marks were {matrix_bang_behavior_message(matrix_bang_behavior)}; '
        "runs of consecutive weeks were combined into one date range.",
    )
    if flagged_cell_rotators:
        if matrix_bang_behavior == "exclude":
            warnings.append(
                'The following providers had cells marked "!B" - those weeks were excluded: '
                f'{", ".join(flagged_cell_rotators)}.'
            )
        else:
            warnings.append(
                'The following providers had cells marked "!B" - we treated them as present '
                f'(same as "B"). Let us know if these should be excluded instead: {", ".join(flagged_cell_rotators)}.'
            )

    return {
        "rows": rows,
        "warnings": warnings,
        "columnsFound": ["matrix"],
        "headers": [str(_cell(grid[date_row_index], int(week["col"])) or "").strip() for week in week_starts],
        "importMeta": {
            "isMatrix": True,
            "matrixBangBehavior": matrix_bang_behavior,
            "bangMarkedRotators": flagged_cell_rotators,
            "matrixDateRowIndex": date_row_index,
            "matrixNameColumn": name_col,
            "matrixDateColumns": week_starts,
            "sourceProgram": _infer_program_from_source_text(source_label, "UT Pediatrics"),
        },
    }


def matrix_bang_behavior_message(matrix_bang_behavior: str) -> str:
    return "excluded" if matrix_bang_behavior == "exclude" else 'treated as present'


def _probe_matrix_week_starts(row: list[Any]) -> list[dict[str, Any]]:
    if not row or len(row) < 3:
        return []

    now = datetime.now(timezone.utc)
    academic_year_start = now.year if now.month >= 6 else now.year - 1
    last_month: int | None = None
    year_offset = 0
    results: list[dict[str, Any]] = []
    for col, cell in enumerate(row):
        if col < 2:
            continue
        parsed = _parse_matrix_date_cell(cell)
        if parsed is None:
            continue
        month, day, explicit_year = parsed
        if explicit_year is None:
            if last_month is not None and month < last_month:
                year_offset += 1
            year = academic_year_start + year_offset
        else:
            year = explicit_year
        last_month = month
        try:
            iso_start = date(year, month, day).isoformat()
        except ValueError:
            continue
        results.append({"col": col, "isoStart": iso_start})
    return results


def _parse_matrix_date_cell(value: Any) -> tuple[int, int, int | None] | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        iso = _excel_serial_to_iso(float(value))
        return _matrix_parts_from_iso(iso)
    text = str(value).strip()
    if not text:
        return None
    if re.fullmatch(r"\d+(\.\d+)?", text):
        serial = float(text)
        if serial > 1000:
            return _matrix_parts_from_iso(_excel_serial_to_iso(serial))
    iso_match = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", text)
    if iso_match:
        return (int(iso_match.group(2)), int(iso_match.group(3)), int(iso_match.group(1)))
    match = re.match(r"^(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(\d{2,4}))?$", text)
    if not match:
        return None
    month = int(match.group(1))
    day = int(match.group(2))
    year_text = match.group(3)
    year = int(_expand_two_digit_year(year_text)) if year_text and len(year_text) == 2 else int(year_text) if year_text else None
    if month < 1 or month > 12 or day < 1:
        return None
    days_in_month = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if day > days_in_month[month - 1]:
        return None
    return (month, day, year)


def _matrix_parts_from_iso(iso: str) -> tuple[int, int, int] | None:
    if not _is_iso_date(iso):
        return None
    parsed = date.fromisoformat(iso)
    return (parsed.month, parsed.day, parsed.year)


def _matrix_name(row: list[Any], name_col: int, first_date_col: int) -> str:
    primary = str(_cell(row, name_col) or "").strip()
    if primary and not re.fullmatch(r"\d+", primary):
        return primary
    for col in range(0, max(0, first_date_col)):
        text = str(_cell(row, col) or "").strip()
        if text and not re.fullmatch(r"\d+", text):
            return text
    return ""


def _add_days_to_iso(iso: str, days: int) -> str:
    parsed = date.fromisoformat(iso)
    return (parsed + timedelta(days=days)).isoformat()


def _normalize_column_mapping(mapping: dict[str, Any], header_count: int) -> dict[str, int]:
    if not isinstance(mapping, dict):
        raise RosterImportError("columnMapping must be an object")
    normalized: dict[str, int] = {}
    for field, raw_index in mapping.items():
        if field not in IMPORT_FIELDS or raw_index is None:
            continue
        if not isinstance(raw_index, int):
            raise RosterImportError(f"columnMapping.{field} must be an integer column index")
        if raw_index < 0 or raw_index >= header_count:
            raise RosterImportError(f"columnMapping.{field} is outside the header range")
        normalized[field] = raw_index
    return normalized


def _build_column_map(header_row: list[Any]) -> tuple[dict[str, int], list[str]]:
    normalized = [_normalize_header(value) for value in header_row]
    column_map: dict[str, int] = {}
    warnings: list[str] = []
    for field, candidates in COLUMN_SYNONYMS.items():
        matches = [index for index, header in enumerate(normalized) if header in candidates]
        if matches:
            column_map[field] = matches[0]
        if len(matches) > 1:
            names = ", ".join(str(header_row[index]) for index in matches)
            warnings.append(f"Columns {names} all look like {field}; used the first one.")
    return column_map, warnings


def _rotator_from_row(
    raw: list[Any],
    column_map: dict[str, int],
    sheet_row: int,
    index: int,
    *,
    source_label: str = "",
) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    full_name = str(_cell(raw, column_map.get("fullName")) or "").strip()
    program_cell = _cell(raw, column_map.get("program"))
    program = _program_from_cell(program_cell, source_label)
    if column_map.get("program") is not None and program == "Other" and str(program_cell or "").strip():
        warnings.append(f"Row {sheet_row}: program {program_cell!r} did not match a known program, so it was filed under Other.")
    raw_level = str(_cell(raw, column_map.get("level")) or "").strip()
    level = raw_level or "Unknown"
    if column_map.get("level") is not None and not raw_level:
        warnings.append(f"Row {sheet_row}: {full_name} is missing a level, so it was imported as Unknown.")
    start_date = _to_iso_date(_cell(raw, column_map.get("startDate")))
    end_date = _to_iso_date(_cell(raw, column_map.get("endDate")))
    if column_map.get("startDate") is not None and not start_date:
        warnings.append(f"Row {sheet_row}: {full_name} is missing a start date.")
    if column_map.get("endDate") is not None and not end_date:
        warnings.append(f"Row {sheet_row}: {full_name} is missing an end date.")

    segments = [{"start": start_date, "end": end_date}] if start_date and end_date else []
    rotator = make_rotator(f"rot-{slug(full_name)}-{index}", full_name, program, level, segments)
    rotator = _apply_role_signals(rotator, program_cell, level, source_label=source_label)
    continuity = str(_cell(raw, column_map.get("continuityClinic")) or "").strip()
    if continuity:
        rotator["continuityClinic"] = continuity
    day_off = _parse_day_off(_cell(raw, column_map.get("dayOff")))
    unavailable = _parse_unavailable(_cell(raw, column_map.get("unavailableRanges")))
    merged_day_off = _merge_weekdays(day_off, unavailable["weekdayDays"])
    if merged_day_off:
        rotator["dayOff"] = merged_day_off
    if unavailable["weekdayDays"]:
        warnings.append(f"Row {sheet_row}: {full_name} has weekday text in Unavailable; added it to Day Off.")
    if unavailable["invalidValues"]:
        warnings.append(f"Row {sheet_row}: {full_name} has unreadable unavailable values: {', '.join(unavailable['invalidValues'])}.")
    if unavailable["ranges"]:
        rotator["unavailableRanges"] = unavailable["ranges"]

    # Explicit rotation-start column only applies to Methodist rotators
    # (schoolType is derived from program by make_rotator above). Column
    # absent, or row not Methodist, leaves rotationStartDate unset.
    if column_map.get("rotationStartDate") is not None and rotator.get("schoolType") == "methodist":
        rotation_start_date = _to_iso_date(_cell(raw, column_map.get("rotationStartDate")))
        if rotation_start_date:
            rotator["rotationStartDate"] = rotation_start_date

    return rotator, warnings


def merge_rotators(existing_rotators: list[dict[str, Any]], parsed_rows: list[dict[str, Any]], mode: str = "merge") -> dict[str, Any]:
    existing = [deepcopy(rotator) for rotator in existing_rotators]
    parsed = [deepcopy(rotator) for rotator in parsed_rows]
    if mode == "replace":
        return {"rotators": parsed, "added": len(parsed), "updated": 0, "removed": len(existing)}
    if mode == "add":
        return {"rotators": [*existing, *parsed], "added": len(parsed), "updated": 0, "removed": 0}

    by_key = {_key_of(rotator.get("fullName")): rotator for rotator in existing}
    order = [_key_of(rotator.get("fullName")) for rotator in existing]
    added = 0
    updated = 0
    for row in parsed:
        key = _key_of(row.get("fullName"))
        current = by_key.get(key)
        if current:
            merged = {**current, **row, "id": current.get("id")}
            if row.get("program") == "Other" and current.get("program") and current.get("program") != "Other":
                merged["program"] = current["program"]
                merged["schoolType"] = current.get("schoolType", merged.get("schoolType"))
            if row.get("level") == "Unknown" and current.get("level") and current.get("level") != "Unknown":
                merged["level"] = current["level"]
                merged["role"] = current.get("role", merged.get("role"))
            if not row.get("continuityClinic") and current.get("continuityClinic"):
                merged["continuityClinic"] = current["continuityClinic"]
            if not row.get("dayOff") and current.get("dayOff"):
                merged["dayOff"] = current["dayOff"]
            if not row.get("unavailableRanges") and current.get("unavailableRanges"):
                merged["unavailableRanges"] = current["unavailableRanges"]
            merged["segments"] = _union_segments(current.get("segments"), row.get("segments"))
            by_key[key] = merged
            updated += 1
        else:
            by_key[key] = row
            order.append(key)
            added += 1
    return {"rotators": [by_key[key] for key in order if key in by_key], "added": added, "updated": updated, "removed": 0}


def _add_source_record(
    sources: list[dict[str, Any]],
    path: Path,
    parsed: dict[str, Any],
    merge: dict[str, Any],
    *,
    replace_source_id: str | None = None,
) -> list[dict[str, Any]]:
    imported_count = merge["added"] + merge["updated"]
    warnings = [str(warning) for warning in parsed.get("warnings") or []]
    source_record = {
        "importedAt": datetime.now(timezone.utc).date().isoformat(),
        "status": "Reviewed",
        "program": _source_program_for_record(parsed, path),
        "fileName": path.name,
        "fileType": path.suffix.lower().lstrip("."),
        "content": "",
        "parsedRows": parsed["rows"],
        "importedRotatorCount": imported_count,
        "importWarningCount": len(warnings),
        "importWarnings": warnings[:100],
    }
    if replace_source_id:
        if not any(source.get("id") == replace_source_id for source in sources):
            raise RosterImportError(f"source not found: {replace_source_id}")
        return [
            {**source, **source_record, "id": source.get("id")}
            if source.get("id") == replace_source_id
            else source
            for source in sources
        ]
    return [
        *sources,
        {
            "id": f"source-{slug(path.name)}-{int(time.time() * 1000)}",
            **source_record,
        },
    ]


def _normalize_rotator_row(row: dict[str, Any], index: int) -> dict[str, Any]:
    full_name = str(row.get("fullName") or row.get("displayName") or "").strip()
    if not full_name:
        raise RosterImportError("rotator JSON rows must include fullName or displayName")
    program = str(row.get("program") or "Other")
    level = str(row.get("level") or "Unknown")
    base = make_rotator(str(row.get("id") or f"rot-{slug(full_name)}-{index}"), full_name, program, level, row.get("segments") or [])
    return {
        **base,
        **row,
        "id": str(row.get("id") or base["id"]),
        "fullName": full_name,
        "displayName": str(row.get("displayName") or full_name),
        "program": program,
        "level": level,
        "role": row.get("role") if row.get("role") in {"Resident", "Fellow", "Student"} else base["role"],
        "segments": [seg for seg in (normalize_segment(item) for item in row.get("segments") or []) if seg],
        "schoolType": row.get("schoolType") or base["schoolType"],
        "continuityClinic": str(row.get("continuityClinic") or ""),
        "dayOff": row.get("dayOff") if isinstance(row.get("dayOff"), list) else [],
        "unavailableRanges": row.get("unavailableRanges") if isinstance(row.get("unavailableRanges"), list) else [],
    }


def _headers_from_dict_rows(rows: list[Any]) -> list[str]:
    headers: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key in row:
            if key not in headers:
                headers.append(key)
    return headers


def _looks_like_rotator(row: dict[str, Any]) -> bool:
    return bool(row.get("fullName") or row.get("displayName")) and isinstance(row.get("segments"), list)


def _normalize_header(value: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[\s_\-./]+", " ", str(value or "").strip().lower())).strip()


def _normalize_program(value: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").strip().lower())).strip()


def _match_program(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return "Other"
    for program in PROGRAMS:
        if program.lower() == text.lower():
            return program
    alias = PROGRAM_ALIASES.get(_normalize_program(text))
    if alias:
        return alias
    lower = text.lower()
    best = "Other"
    best_score = 0
    for program in PROGRAMS:
        score = len([word for word in program.lower().split() if word in lower])
        if score > best_score:
            best = program
            best_score = score
    return best if best_score > 0 else "Other"


def _infer_program_from_source_text(value: Any, fallback: str = "Other") -> str:
    text = _normalize_program(value)
    if not text:
        return fallback or "Other"
    if re.search(r"\bmethodist\b", text):
        return "Methodist"
    # Mixed filenames such as "Psych Residents - Pedi Neuro Template" name
    # the service after the cohort. The cohort is Psychiatry; "Pedi Neuro"
    # describes where they rotate and must not turn them into peds fellows.
    if re.search(r"\bpsych(?:iatry)?\b", text) and re.search(r"\b(?:residents?|interns?|fellows?)\b", text):
        return "UT Psychiatry"
    if re.search(r"\bpedi(?:atric|atrics)?\b|\bpeds\b|\bpedi\s+neuro\b", text):
        return "UT Pediatrics"
    if re.search(r"\bpsych(?:iatry)?\b|\bpsychiatry\b", text):
        return "UT Psychiatry"
    if re.search(r"\badult\b.*\bneuro(?:logy)?\b|\bneuro(?:logy)?\b.*\badult\b", text):
        return "UT Adult Neuro"
    direct = _match_program(value)
    if direct != "Other":
        return direct
    return fallback or "Other"


def _program_from_cell(program_cell: Any, source_label: str = "", fallback: str = "Other") -> str:
    explicit = _match_program(program_cell)
    if explicit != "Other":
        return explicit
    hinted = _infer_program_from_source_text(source_label, "Other")
    if hinted != "Other":
        return hinted
    return fallback if fallback in PROGRAMS else "Other"


def _source_program_for_record(parsed: dict[str, Any], path: Path) -> str:
    counts: dict[str, int] = {}
    for row in parsed.get("rows") or []:
        program = row.get("program") if isinstance(row, dict) else None
        if program and program != "Other":
            counts[program] = counts.get(program, 0) + 1
    if counts:
        return sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0][0]
    meta_program = (parsed.get("importMeta") or {}).get("sourceProgram")
    if meta_program in PROGRAMS:
        return meta_program
    return _infer_program_from_source_text(path.name)


def _to_iso_date(value: Any) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, (int, float)):
        return _excel_serial_to_iso(float(value))
    text = str(value).strip()
    if not text:
        return ""
    if re.fullmatch(r"\d+(\.\d+)?", text):
        serial = float(text)
        if serial > 1000:
            return _excel_serial_to_iso(serial)
    match = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", text)
    if match:
        return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
    match = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$", text)
    if match:
        year = match.group(3)
        if len(year) == 2:
            year = _expand_two_digit_year(year)
        return f"{year}-{int(match.group(1)):02d}-{int(match.group(2)):02d}"
    for fmt in ("%B %d %Y", "%b %d %Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            pass
    return text


def _excel_serial_to_iso(value: float) -> str:
    base = datetime(1899, 12, 30)
    return (base + timedelta(days=int(value))).date().isoformat()


def _expand_two_digit_year(value: str) -> str:
    n = int(value)
    current = datetime.now().year
    century = (current // 100) * 100
    two_digit = current - century
    return str(century + n if n <= two_digit + 5 else century - 100 + n)


def _weekday_index(token: str) -> int:
    cleaned = token.strip().lower()
    for index, (_name, aliases) in enumerate(WEEKDAY_ALIASES):
        if any(cleaned == alias or cleaned.startswith(alias) for alias in aliases):
            return index
    return -1


def _parse_day_off(value: Any) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    days = set()
    tokens = re.split(r"[,;/&\-]| and | to | through | thru ", text, flags=re.I)
    for token in tokens:
        index = _weekday_index(token)
        if index >= 0:
            days.add(WEEKDAYS[index])
    match = re.match(r"^\s*([A-Za-z]+)\s*(?:[-]\s*|\s+(?:to|through|thru)\s+)([A-Za-z]+)\s*$", text, flags=re.I)
    if match:
        start = _weekday_index(match.group(1))
        end = _weekday_index(match.group(2))
        if start >= 0 and end >= 0:
            index = start
            for _ in range(8):
                days.add(WEEKDAYS[index])
                if index == end:
                    break
                index = (index + 1) % 7
    return [day for day in WEEKDAYS if day in days]


def _parse_weekday_only(value: str) -> list[str]:
    if not value or re.search(r"\d|\b(?:am|pm)\b", value, flags=re.I):
        return []
    days = _parse_day_off(value)
    tokens = [part.strip() for part in re.split(r"[,;/&\-]| and | to | through | thru ", value, flags=re.I) if part.strip()]
    return days if days and tokens and all(_weekday_index(token) >= 0 for token in tokens) else []


def _parse_unavailable(value: Any) -> dict[str, Any]:
    text = str(value or "").strip()
    ranges: list[dict[str, str]] = []
    weekday_days: set[str] = set()
    invalid: list[str] = []
    if not text:
        return {"ranges": ranges, "weekdayDays": [], "invalidValues": invalid}
    for part in re.split(r"[;,]", text):
        cleaned = part.strip()
        if not cleaned:
            continue
        weekdays = _parse_weekday_only(cleaned)
        if weekdays:
            weekday_days.update(weekdays)
            continue
        match = re.match(r"^(.+?)\s+(?:to|through|thru|-)\s+(.+)$", cleaned, flags=re.I)
        if match:
            start = _to_iso_date(match.group(1))
            end = _to_iso_date(match.group(2))
            if _is_iso_date(start) and _is_iso_date(end):
                ranges.append({"start": start, "end": end})
            else:
                invalid.append(cleaned)
            continue
        single = _to_iso_date(cleaned)
        if _is_iso_date(single):
            ranges.append({"start": single, "end": single})
        else:
            invalid.append(cleaned)
    return {"ranges": ranges, "weekdayDays": [day for day in WEEKDAYS if day in weekday_days], "invalidValues": invalid}


def _apply_role_signals(
    rotator: dict[str, Any],
    program_cell: Any,
    level: str,
    *,
    source_label: str = "",
) -> dict[str, Any]:
    signal = f"{program_cell or ''} {level or ''} {source_label or ''}"
    # In this scheduler, Fellow means the Pediatric Neurology coverage role.
    # Psychiatry fellows/residents rotate on the service as Psychiatry
    # rotators; they must not be promoted into the pinned peds-fellow row.
    if rotator.get("program") == "UT Psychiatry" and rotator.get("role") != "Student":
        return {**rotator, "role": "Resident"}
    if re.search(r"\bfellows?\b|\bfellowship\b", signal, flags=re.I) and rotator.get("role") != "Student":
        return _promote_to_fellow(rotator)
    if rotator.get("program") == "UT Pediatrics" and re.match(r"^PGY\s*-?\s*5$", level.upper()):
        return _promote_to_fellow(rotator)
    return rotator


def _promote_to_fellow(rotator: dict[str, Any]) -> dict[str, Any]:
    """Fellow signal wins: set the role AND the fellow-specific program label.

    Only ambiguous buckets (blank / Other / UT Pediatrics) are rewritten —
    an explicit program like Methodist stays untouched."""
    out = {**rotator, "role": "Fellow"}
    if (rotator.get("program") or "") in {"", "Other", "UT Pediatrics"}:
        out["program"] = "UT Pediatric Neurology Fellow"
        out["schoolType"] = infer_school_type(out["program"])
    return out


def _merge_weekdays(*lists: list[str]) -> list[str]:
    seen = set()
    for values in lists:
        for value in values or []:
            if value in WEEKDAYS:
                seen.add(value)
    return [day for day in WEEKDAYS if day in seen]


def _union_segments(a: Any, b: Any) -> list[dict[str, Any]]:
    seen = set()
    out = []
    for item in [*(a if isinstance(a, list) else []), *(b if isinstance(b, list) else [])]:
        segment = normalize_segment(item)
        if not segment:
            continue
        key = f"{segment['start']}|{segment['end']}"
        if key in seen:
            continue
        seen.add(key)
        out.append(segment)
    return sorted(out, key=lambda item: (item["start"], item["end"]))


def _cell(row: list[Any], index: int | None) -> Any:
    if index is None or index < 0 or index >= len(row):
        return ""
    return row[index]


def _row_is_empty(row: list[Any]) -> bool:
    return all(cell is None or str(cell).strip() == "" for cell in row)


def _key_of(name: Any) -> str:
    return str(name or "").strip().lower()


def _is_iso_date(value: str) -> bool:
    return bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(value or "")))
