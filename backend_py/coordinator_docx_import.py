"""Deterministic parser for Coordinator's monthly DOCX schedule bundle.

This module intentionally stays outside the React import flow. It proves the
mapping from three structured Word tables into scheduler-shaped preview data so
the UI can be wired later with less guesswork.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, timedelta
from calendar import monthrange
import json
import re
import unicodedata
from pathlib import Path
from typing import Any, Iterable

try:
    from docx import Document
    from docx.oxml.ns import qn
except ModuleNotFoundError as exc:  # pragma: no cover - exercised by CLI envs
    raise RuntimeError(
        "python-docx is required for Coordinator DOCX import. "
        "Install backend_py/requirements-dev.txt or run with the bundled Codex Python."
    ) from exc


YEAR = 2026
MONTH = 7
MONTH_NAMES = [
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]
MONTH_TO_NUM = {name.lower(): index for index, name in enumerate(MONTH_NAMES) if name}
MONTH_RE = "|".join(MONTH_NAMES[1:])
_ACTIVE_YEAR = YEAR
_ACTIVE_MONTH = MONTH
STAR = "\u2605"
EM_DASH = "\u2014"
EN_DASH = "\u2013"

DEFAULT_MASTER_FILENAME = "July_2026_Master_Schedule.docx"
DEFAULT_INPATIENT_FILENAME = "July_2026_Inpatient_Roster.docx"
DEFAULT_OUTPATIENT_FILENAME = "July_2026_Outpatient_Assignments.docx"
DEFAULT_OUTPUT_DIR = Path.cwd() / "verification" / "coordinator-docx-import"

PROGRAMS = [
    "Methodist",
    "UT Adult Neuro",
    "UT Pediatrics",
    "UT Pediatric Neurology Fellow",
    "UT Med Student",
    "UT Psychiatry",
    "Other",
]

STATUS_VALUES = {"IP", "OP", "OFF"}
UNAVAILABLE_FILLS = {"bdbdbd", "d9d9d9"}
ROW_STRIPE_FILLS = {"ffffff", "f2f2f2", ""}
SPECIAL_OUTPATIENT_MARKERS = ("holiday", "no clinic", "next block")


def default_coordinator_docx_paths(downloads_dir: Path | None = None) -> dict[str, Path]:
    """Return the newest complete Coordinator DOCX bundle from Downloads.

    Falls back to the original July filenames when no complete bundle can be
    discovered, so the missing-file response still points to concrete paths.
    """
    root = downloads_dir or (Path.home() / "Downloads")
    discovered = _discover_latest_docx_bundle(root)
    if discovered:
        return discovered
    return {
        "master": root / DEFAULT_MASTER_FILENAME,
        "inpatient": root / DEFAULT_INPATIENT_FILENAME,
        "outpatient": root / DEFAULT_OUTPATIENT_FILENAME,
    }


@dataclass(frozen=True)
class NameMatch:
    rotator_id: str
    full_name: str
    display_name: str
    alias: str
    method: str


@dataclass(frozen=True)
class BundleContext:
    year: int
    month: int

    @property
    def month_name(self) -> str:
        return MONTH_NAMES[self.month]

    @property
    def month_slug(self) -> str:
        return f"{self.year}-{self.month:02d}"

    @property
    def start_date(self) -> str:
        return f"{self.year}-{self.month:02d}-01"

    @property
    def fallback_end_date(self) -> str:
        return f"{self.year}-{self.month:02d}-{monthrange(self.year, self.month)[1]:02d}"


def _bundle_file_info(path: Path) -> tuple[int, int, str] | None:
    name = path.name
    match = re.search(rf"(^|[^A-Za-z])({MONTH_RE})[\s_-]+(20\d{{2}})(?=$|[^0-9])", name, flags=re.IGNORECASE)
    if not match:
        return None
    month = MONTH_TO_NUM[match.group(2).lower()]
    year = int(match.group(3))
    lower = name.lower()
    kind = ""
    if "master" in lower:
        kind = "master"
    elif "inpatient" in lower:
        kind = "inpatient"
    elif "outpatient" in lower:
        kind = "outpatient"
    if not kind:
        return None
    return year, month, kind


def _discover_latest_docx_bundle(root: Path) -> dict[str, Path] | None:
    if not root.exists():
        return None
    grouped: dict[tuple[int, int], dict[str, list[Path]]] = defaultdict(lambda: defaultdict(list))
    for path in root.glob("*.docx"):
        info = _bundle_file_info(path)
        if info is None:
            continue
        year, month, kind = info
        grouped[(year, month)][kind].append(path)
    complete = {
        key: value
        for key, value in grouped.items()
        if all(value.get(kind) for kind in ("master", "inpatient", "outpatient"))
    }
    if not complete:
        return None
    latest = max(complete)
    return {
        kind: max(complete[latest][kind], key=lambda path: (path.stat().st_mtime, path.name))
        for kind in ("master", "inpatient", "outpatient")
    }


def _context_from_paths(paths: Iterable[str | Path]) -> BundleContext:
    counts: Counter[tuple[int, int]] = Counter()
    for path in paths:
        info = _bundle_file_info(Path(path))
        if info:
            year, month, _kind = info
            counts[(year, month)] += 1
    if counts:
        (year, month), _count = counts.most_common(1)[0]
        return BundleContext(year=year, month=month)
    return BundleContext(year=YEAR, month=MONTH)


@contextmanager
def _using_bundle_context(context: BundleContext):
    global _ACTIVE_YEAR, _ACTIVE_MONTH
    previous = (_ACTIVE_YEAR, _ACTIVE_MONTH)
    _ACTIVE_YEAR, _ACTIVE_MONTH = context.year, context.month
    try:
        yield
    finally:
        _ACTIVE_YEAR, _ACTIVE_MONTH = previous


def slug(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower()).strip("-")
    return text or "item"


def iso_for_day(day: int) -> str:
    return f"{_ACTIVE_YEAR}-{_ACTIVE_MONTH:02d}-{day:02d}"


def active_month_name() -> str:
    return MONTH_NAMES[_ACTIVE_MONTH]


def cell_text(cell: Any) -> str:
    return "\n".join(part.strip() for part in cell.text.splitlines()).strip()


def cell_lines(cell: Any) -> list[str]:
    return [line.strip() for line in cell_text(cell).splitlines() if line.strip()]


def cell_fill(cell: Any) -> str:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        return ""
    fill = shd.get(qn("w:fill")) or ""
    return fill.lower()


def strip_star(value: str) -> tuple[str, bool]:
    text = value.strip()
    starred = text.startswith(STAR)
    if starred:
        text = text[len(STAR) :].strip()
    return text, starred


def clean_title(value: str) -> str:
    return re.sub(r"\b(MD|DO)\b\.?", "", value, flags=re.IGNORECASE)


def normalize_name_key(value: str) -> str:
    text, _ = strip_star(value)
    text = text.replace(EM_DASH, " ").replace(EN_DASH, " ")
    text = clean_title(text)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-zA-Z0-9]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def parse_july_day(value: str) -> int | None:
    match = re.search(rf"\b({MONTH_RE})\s+(\d{{1,2}})\b", value, flags=re.IGNORECASE)
    if match:
        month = MONTH_TO_NUM[match.group(1).lower()]
        if month != _ACTIVE_MONTH:
            return None
        return int(match.group(2))
    numbers = re.findall(r"\b(\d{1,2})\b", value)
    if numbers:
        day = int(numbers[-1])
        if 1 <= day <= monthrange(_ACTIVE_YEAR, _ACTIVE_MONTH)[1]:
            return day
    return None


def compact_counts(values: Iterable[str]) -> dict[str, int]:
    counts = Counter(value for value in values if value)
    return dict(sorted(counts.items()))


def derive_ranges(days: list[int]) -> list[dict[str, str]]:
    if not days:
        return []
    sorted_days = sorted(set(days))
    ranges: list[dict[str, str]] = []
    start = prev = sorted_days[0]
    for day in sorted_days[1:]:
        if day == prev + 1:
            prev = day
            continue
        ranges.append({"start": iso_for_day(start), "end": iso_for_day(prev)})
        start = prev = day
    ranges.append({"start": iso_for_day(start), "end": iso_for_day(prev)})
    return ranges


def parse_master_cell(cell: Any) -> dict[str, Any]:
    lines = cell_lines(cell)
    fill = cell_fill(cell)
    status = ""
    period = ""
    raw = cell_text(cell)

    if lines:
        first = lines[0].upper()
        if first in STATUS_VALUES:
            status = first
            for line in lines[1:]:
                upper = line.upper()
                if upper in {"AM", "PM"}:
                    period = upper
                    break
        else:
            inline = re.match(r"^(IP|OP|OFF)\s+(AM|PM)$", first)
            if inline:
                status = inline.group(1)
                period = inline.group(2)

    unavailable = not status and fill in UNAVAILABLE_FILLS
    if unavailable:
        status = "UNAVAILABLE"

    return {
        "raw": raw,
        "status": status,
        "period": period,
        "fill": fill,
        "unavailable": unavailable,
    }


def find_master_table(document: Any) -> Any:
    for table in document.tables:
        if table.rows and normalize_name_key(table.rows[0].cells[0].text) == "rotator":
            return table
    raise ValueError("Could not find the Master Schedule table with a Rotator header.")


def parse_master_schedule(path: str | Path) -> dict[str, Any]:
    document = Document(str(path))
    table = find_master_table(document)
    header = table.rows[0]
    date_columns: list[dict[str, Any]] = []
    for index, cell in enumerate(header.cells[1:], start=1):
        day = parse_july_day(cell_text(cell))
        if day is None:
            continue
        date_columns.append({"column": index, "day": day, "date": iso_for_day(day), "label": cell_text(cell)})

    rotators: list[dict[str, Any]] = []
    coverage_rows: dict[str, dict[str, int | None]] = {}

    for row in table.rows[1:]:
        raw_name = cell_text(row.cells[0])
        name, starred = strip_star(raw_name)
        lowered = name.strip().lower()
        if "coverage" in lowered:
            coverage = {}
            for info in date_columns:
                raw_value = cell_text(row.cells[info["column"]])
                coverage[info["date"]] = int(raw_value) if raw_value.isdigit() else None
            coverage_rows[name] = coverage
            continue

        rotator_id = f"rotator-{slug(name)}"
        daily: list[dict[str, Any]] = []
        for info in date_columns:
            parsed = parse_master_cell(row.cells[info["column"]])
            daily.append({"date": info["date"], "day": info["day"], **parsed})

        active_days = [
            item["day"]
            for item in daily
            if item["status"] in {"IP", "OP", "OFF", "UNAVAILABLE"}
        ]
        unavailable_days = [item["day"] for item in daily if item["unavailable"]]
        rotators.append(
            {
                "id": rotator_id,
                "fullName": name,
                "displayName": name,
                "isFellow": starred,
                "sourceName": raw_name,
                "segments": derive_ranges(active_days),
                "unavailableRanges": derive_ranges(unavailable_days),
                "statusCounts": compact_counts(item["status"] for item in daily),
                "halfDayCells": [
                    {
                        "date": item["date"],
                        "status": item["status"],
                        "period": item["period"],
                        "raw": item["raw"],
                    }
                    for item in daily
                    if item["period"]
                ],
                "daily": daily,
            }
        )

    return {
        "sourceFile": str(path),
        "notes": [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()],
        "dates": [item["date"] for item in date_columns],
        "rotators": rotators,
        "fellows": [rotator["fullName"] for rotator in rotators if rotator["isFellow"]],
        "coverageRows": coverage_rows,
        "counts": {
            "rotators": len(rotators),
            "dates": len(date_columns),
            "halfDayCells": sum(len(rotator["halfDayCells"]) for rotator in rotators),
            "unavailableCells": sum(
                1 for rotator in rotators for item in rotator["daily"] if item["unavailable"]
            ),
        },
    }


class NameResolver:
    def __init__(self, rotators: list[dict[str, Any]]):
        self.rotators = {rotator["fullName"]: rotator for rotator in rotators}
        self.aliases: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self._build_aliases(rotators)

    def _add_alias(self, alias: str, rotator: dict[str, Any]) -> None:
        key = normalize_name_key(alias)
        if not key:
            return
        if rotator not in self.aliases[key]:
            self.aliases[key].append(rotator)

    def _build_aliases(self, rotators: list[dict[str, Any]]) -> None:
        first_names: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for rotator in rotators:
            title_free = clean_title(rotator["fullName"]).replace(",", " ")
            parts = normalize_name_key(title_free).split()
            self._add_alias(rotator["fullName"], rotator)
            self._add_alias(title_free, rotator)
            if len(parts) >= 2:
                self._add_alias(f"{parts[0]} {parts[-1]}", rotator)
            if parts:
                first_names[parts[0]].append(rotator)

        for first_name, matches in first_names.items():
            if len(matches) == 1:
                self._add_alias(first_name, matches[0])

        manual_aliases = {
            "blair o": "Blair Hart",
            "parker ross": "Parker Ross, MD",
            "quinn hayes": "Quinn Hayes, MD",
            "jordan lee": "Jordan Lee",
        }
        for alias, full_name in manual_aliases.items():
            rotator = self.rotators.get(full_name)
            if rotator:
                self._add_alias(alias, rotator)

    def resolve(self, value: str) -> NameMatch | None:
        key = normalize_name_key(value)
        matches = self.aliases.get(key, [])
        if len(matches) == 1:
            rotator = matches[0]
            return NameMatch(
                rotator_id=rotator["id"],
                full_name=rotator["fullName"],
                display_name=rotator["displayName"],
                alias=value,
                method="exact-alias" if key != normalize_name_key(rotator["fullName"]) else "exact",
            )
        return None


ANNOTATION_PATTERNS = [
    ("AM Clinic", re.compile(r"\bAM\s+Clinic$", flags=re.IGNORECASE)),
    ("PM Clinic", re.compile(r"\bPM\s+Clinic$", flags=re.IGNORECASE)),
    ("AM AHD", re.compile(r"\bAM\s+AHD$", flags=re.IGNORECASE)),
    ("PM AHD", re.compile(r"\bPM\s+AHD$", flags=re.IGNORECASE)),
]


def split_inpatient_entry(raw_entry: str) -> dict[str, Any]:
    text, starred = strip_star(raw_entry.strip())
    if not text:
        return {"kind": "empty", "raw": raw_entry, "starred": starred}

    lowered = text.lower()
    if lowered in {"fellow off", "fellow off.", "fellow off:"}:
        return {
            "kind": "skip",
            "reason": "FELLOW OFF",
            "raw": raw_entry,
            "starred": starred,
            "annotations": ["FELLOW OFF"],
        }
    if "to be determined" in lowered or lowered == "tbd":
        return {
            "kind": "skip",
            "reason": "TBD",
            "raw": raw_entry,
            "starred": starred,
            "annotations": ["TBD"],
        }

    annotations: list[str] = []
    name = text
    for label, pattern in ANNOTATION_PATTERNS:
        if pattern.search(name):
            annotations.append(label)
            name = pattern.sub("", name).strip()
            break

    return {
        "kind": "assignment",
        "name": name,
        "raw": raw_entry,
        "starred": starred,
        "annotations": annotations,
    }


def parse_inpatient_roster(path: str | Path, resolver: NameResolver) -> dict[str, Any]:
    document = Document(str(path))
    if not document.tables:
        raise ValueError("Inpatient roster did not contain a table.")
    table = document.tables[0]
    records: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    half_day_annotations: list[dict[str, Any]] = []

    for row_index, row in enumerate(table.rows[1:], start=1):
        for column_index, cell in enumerate(row.cells):
            lines = cell_lines(cell)
            if not lines:
                continue
            day = parse_july_day(lines[0])
            if day is None:
                skipped.append(
                    {
                        "row": row_index,
                        "column": column_index,
                        "raw": cell_text(cell),
                        "reason": "date-not-found",
                    }
                )
                continue
            date_value = iso_for_day(day)
            for entry in lines[1:]:
                parsed = split_inpatient_entry(entry)
                if parsed["kind"] == "skip":
                    skipped.append({"date": date_value, **parsed})
                    continue
                if parsed["kind"] != "assignment":
                    continue
                match = resolver.resolve(parsed["name"])
                if match is None:
                    unresolved.append({"date": date_value, "raw": entry, "name": parsed["name"]})
                    continue
                record = {
                    "date": date_value,
                    "rotatorId": match.rotator_id,
                    "fullName": match.full_name,
                    "raw": entry,
                    "nameText": parsed["name"],
                    "resolvedBy": match.method,
                    "starred": parsed["starred"],
                    "annotations": parsed["annotations"],
                }
                records.append(record)
                if parsed["annotations"]:
                    half_day_annotations.append(record)

    return {
        "sourceFile": str(path),
        "notes": [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()],
        "records": records,
        "skipped": skipped,
        "unresolvedNames": unresolved,
        "halfDayAnnotations": half_day_annotations,
        "counts": {
            "records": len(records),
            "skipped": len(skipped),
            "unresolvedNames": len(unresolved),
            "halfDayAnnotations": len(half_day_annotations),
            "dates": len({record["date"] for record in records}),
        },
    }


def is_empty_slot(value: str) -> bool:
    text = value.strip().lower()
    text = text.replace(EM_DASH, "").replace(EN_DASH, "")
    text = re.sub(r"^-+$", "", text.strip())
    return not text


def split_outpatient_label(label: str) -> dict[str, str]:
    text = label.strip()
    match = re.match(r"^(.*?)\s*\((.*?)\)\s*$", text)
    if not match:
        if text.lower() == "continuity":
            return {"clinic": "Continuity", "provider": ""}
        return {"clinic": text, "provider": text}

    outside = match.group(1).strip()
    inside = match.group(2).strip()
    if outside.lower() == "epilepsy urgent":
        return {"clinic": outside, "provider": inside}
    return {"clinic": inside, "provider": outside}


def parse_outpatient_lines(
    raw: str,
    *,
    date_value: str,
    period: str,
    resolver: NameResolver,
) -> dict[str, list[dict[str, Any]]]:
    sessions: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    lines = [line.strip() for line in raw.splitlines() if line.strip()]

    if not lines:
        return {"sessions": sessions, "skipped": skipped, "unresolved": unresolved}

    for line in lines:
        lowered = line.lower()
        if any(marker in lowered for marker in SPECIAL_OUTPATIENT_MARKERS):
            skipped.append({"date": date_value, "period": period, "raw": line, "reason": "special-marker"})
            continue
        if ":" not in line:
            skipped.append({"date": date_value, "period": period, "raw": line, "reason": "no-clinic-separator"})
            continue
        label, names_text = [part.strip() for part in line.split(":", 1)]
        if is_empty_slot(names_text):
            skipped.append(
                {
                    "date": date_value,
                    "period": period,
                    "raw": line,
                    "clinicLabel": label,
                    "reason": "empty-slot",
                }
            )
            continue
        label_parts = split_outpatient_label(label)
        for token in re.split(r",", names_text):
            name = token.strip()
            if is_empty_slot(name):
                continue
            match = resolver.resolve(name)
            if match is None:
                unresolved.append(
                    {
                        "date": date_value,
                        "period": period,
                        "raw": line,
                        "clinicLabel": label,
                        "name": name,
                    }
                )
                continue
            sessions.append(
                {
                    "date": date_value,
                    "period": period,
                    "clinicLabel": label,
                    "clinic": label_parts["clinic"],
                    "provider": label_parts["provider"],
                    "rotatorId": match.rotator_id,
                    "fullName": match.full_name,
                    "nameText": name,
                    "raw": line,
                    "resolvedBy": match.method,
                }
            )

    return {"sessions": sessions, "skipped": skipped, "unresolved": unresolved}


def parse_outpatient_assignments(path: str | Path, resolver: NameResolver) -> dict[str, Any]:
    document = Document(str(path))
    sessions: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []

    for table_index, table in enumerate(document.tables):
        if len(table.rows) < 3:
            continue
        header = table.rows[0]
        day_by_column: dict[int, str] = {}
        for column_index, cell in enumerate(header.cells[1:], start=1):
            day = parse_july_day(cell_text(cell))
            if day is not None:
                day_by_column[column_index] = iso_for_day(day)

        for row in table.rows[1:]:
            period = cell_text(row.cells[0]).upper()
            if period not in {"AM", "PM"}:
                continue
            for column_index, date_value in day_by_column.items():
                parsed = parse_outpatient_lines(
                    cell_text(row.cells[column_index]),
                    date_value=date_value,
                    period=period,
                    resolver=resolver,
                )
                for record in parsed["sessions"]:
                    record["tableIndex"] = table_index
                sessions.extend(parsed["sessions"])
                skipped.extend(parsed["skipped"])
                unresolved.extend(parsed["unresolved"])

    return {
        "sourceFile": str(path),
        "notes": [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()],
        "sessions": sessions,
        "skipped": skipped,
        "unresolvedNames": unresolved,
        "counts": {
            "sessions": len(sessions),
            "skipped": len(skipped),
            "unresolvedNames": len(unresolved),
            "dates": len({session["date"] for session in sessions}),
            "clinics": len({session["clinicLabel"] for session in sessions}),
        },
    }


def role_for_rotator(rotator: dict[str, Any]) -> str:
    return "Fellow" if rotator.get("isFellow") else "Resident"


def make_rotator_state(rotator: dict[str, Any]) -> dict[str, Any]:
    level = "Fellow" if rotator.get("isFellow") else "Unknown"
    return {
        "id": rotator["id"],
        "fullName": rotator["fullName"],
        "displayName": rotator["displayName"],
        "program": "Other",
        "level": level,
        "role": role_for_rotator(rotator),
        "segments": rotator["segments"],
        "schoolType": "other",
        "continuityClinic": "",
        "dayOff": [],
        "unavailableRanges": rotator["unavailableRanges"],
        "source": "Coordinator DOCX master schedule",
        "docxFellow": rotator.get("isFellow", False),
    }


def make_inpatient_assignment(record: dict[str, Any], rotators_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    role = role_for_rotator(rotators_by_id.get(record["rotatorId"], {}))
    assignment = {
        "id": f"in-{record['date']}-{record['rotatorId']}-{role}".lower(),
        "date": record["date"],
        "rotatorId": record["rotatorId"],
        "role": role,
        "source": "Coordinator DOCX inpatient roster",
    }
    if record["annotations"]:
        assignment["annotations"] = record["annotations"]
        assignment["unsafeWholeDayMapping"] = True
        assignment["sourceText"] = record["raw"]
    return assignment


def make_outpatient_session(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"out-{record['date']}-{record['period']}-{record['rotatorId']}-{slug(record['clinicLabel'])}".lower(),
        "date": record["date"],
        "period": record["period"],
        "clinic": record["clinic"],
        "provider": record["provider"],
        "rotatorId": record["rotatorId"],
        "status": "Scheduled",
        "source": "Coordinator DOCX outpatient assignments",
        "details": [
            {
                "clinic": record["clinic"],
                "attending": record["provider"],
                "notes": record["clinicLabel"],
            }
        ],
    }


def period_for_annotation(annotation: str) -> str:
    if annotation.startswith("AM "):
        return "AM"
    if annotation.startswith("PM "):
        return "PM"
    return ""


def build_half_day_facts(
    master: dict[str, Any],
    inpatient: dict[str, Any],
) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []

    for rotator in master["rotators"]:
        for item in rotator.get("halfDayCells", []):
            period = item.get("period", "")
            if period not in {"AM", "PM"}:
                continue
            facts.append(
                {
                    "id": (
                        f"half-{item['date']}-{period.lower()}-{rotator['id']}"
                        f"-master-{slug(item.get('status', 'status'))}"
                    ),
                    "date": item["date"],
                    "period": period,
                    "rotatorId": rotator["id"],
                    "kind": "master-service-status",
                    "status": item.get("status", ""),
                    "label": item.get("raw", "").replace("\n", " ").strip(),
                    "source": "Coordinator DOCX master schedule",
                    "sourceText": item.get("raw", ""),
                }
            )

    for record in inpatient["halfDayAnnotations"]:
        for annotation in record["annotations"]:
            period = period_for_annotation(annotation)
            if period not in {"AM", "PM"}:
                continue
            facts.append(
                {
                    "id": (
                        f"half-{record['date']}-{period.lower()}-{record['rotatorId']}"
                        f"-inpatient-{slug(annotation)}"
                    ),
                    "date": record["date"],
                    "period": period,
                    "rotatorId": record["rotatorId"],
                    "kind": "inpatient-annotation",
                    "status": "IP",
                    "label": annotation,
                    "source": "Coordinator DOCX inpatient roster",
                    "sourceText": record["raw"],
                    "resolvedBy": record.get("resolvedBy", ""),
                }
            )

    return facts


def master_status_map(master: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for rotator in master["rotators"]:
        for item in rotator["daily"]:
            by_key[(rotator["id"], item["date"])] = item
    return by_key


def reconcile(
    master: dict[str, Any],
    inpatient: dict[str, Any],
    outpatient: dict[str, Any],
) -> dict[str, Any]:
    statuses = master_status_map(master)
    mismatches: list[dict[str, Any]] = []
    coverage_checks: list[dict[str, Any]] = []

    for record in inpatient["records"]:
        master_item = statuses.get((record["rotatorId"], record["date"]))
        master_status = master_item["status"] if master_item else ""
        if master_status != "IP":
            mismatches.append(
                {
                    "kind": "inpatient-vs-master",
                    "date": record["date"],
                    "fullName": record["fullName"],
                    "roster": "IP",
                    "master": master_status or "blank/off-service",
                    "raw": record["raw"],
                }
            )
        for annotation in record["annotations"]:
            period = period_for_annotation(annotation)
            if period and master_item and master_item.get("period") and master_item["period"] != period:
                mismatches.append(
                    {
                        "kind": "inpatient-period-vs-master",
                        "date": record["date"],
                        "fullName": record["fullName"],
                        "annotation": annotation,
                        "masterPeriod": master_item["period"],
                        "raw": record["raw"],
                    }
                )

    seen_outpatient = set()
    for record in outpatient["sessions"]:
        key = (record["rotatorId"], record["date"], record["period"])
        if key in seen_outpatient:
            continue
        seen_outpatient.add(key)
        master_item = statuses.get((record["rotatorId"], record["date"]))
        master_status = master_item["status"] if master_item else ""
        if master_status != "OP":
            mismatches.append(
                {
                    "kind": "outpatient-vs-master",
                    "date": record["date"],
                    "period": record["period"],
                    "fullName": record["fullName"],
                    "clinicLabel": record["clinicLabel"],
                    "outpatient": "OP",
                    "master": master_status or "blank/off-service",
                    "raw": record["raw"],
                }
            )

    for label, expected_status in (
        ("Inpatient coverage", "IP"),
        ("Outpatient coverage", "OP"),
    ):
        expected_by_date = master["coverageRows"].get(label, {})
        for date_value, expected in expected_by_date.items():
            if expected is None:
                continue
            actual = sum(
                1
                for rotator in master["rotators"]
                for item in rotator["daily"]
                if item["date"] == date_value and item["status"] == expected_status
            )
            coverage_checks.append(
                {
                    "label": label,
                    "date": date_value,
                    "expected": expected,
                    "actual": actual,
                    "matches": expected == actual,
                }
            )

    inpatient_counts = Counter(record["date"] for record in inpatient["records"])
    outpatient_counts = Counter((record["date"], record["rotatorId"]) for record in outpatient["sessions"])
    roster_count_checks = []
    for date_value in master["dates"]:
        master_ip = sum(
            1
            for rotator in master["rotators"]
            for item in rotator["daily"]
            if item["date"] == date_value and item["status"] == "IP"
        )
        master_op = sum(
            1
            for rotator in master["rotators"]
            for item in rotator["daily"]
            if item["date"] == date_value and item["status"] == "OP"
        )
        roster_count_checks.append(
            {
                "date": date_value,
                "masterIP": master_ip,
                "inpatientRoster": inpatient_counts[date_value],
                "masterOP": master_op,
                "outpatientRoster": sum(1 for date_rotator in outpatient_counts if date_rotator[0] == date_value),
            }
        )

    return {
        "mismatches": mismatches,
        "coverageChecks": coverage_checks,
        "rosterCountChecks": roster_count_checks,
        "counts": {
            "mismatches": len(mismatches),
            "coverageChecks": len(coverage_checks),
            "coverageMismatches": sum(1 for item in coverage_checks if not item["matches"]),
        },
    }


def build_scheduler_state_preview(
    master: dict[str, Any],
    inpatient: dict[str, Any],
    outpatient: dict[str, Any],
) -> dict[str, Any]:
    rotators_by_id = {rotator["id"]: rotator for rotator in master["rotators"]}
    half_day_facts = build_half_day_facts(master, inpatient)
    context = BundleContext(year=_ACTIVE_YEAR, month=_ACTIVE_MONTH)
    block_id = f"block-{context.month_slug}-coordinator-docx"
    all_dates = sorted(
        set(master.get("dates") or [])
        | {record["date"] for record in inpatient.get("records", [])}
        | {session["date"] for session in outpatient.get("sessions", [])}
    )
    end_date = all_dates[-1] if all_dates else context.fallback_end_date
    july_2026_holiday = ["2026-07-03"] if context.year == 2026 and context.month == 7 else []
    return {
        "version": 2,
        "activeBlockId": block_id,
        "serviceBlocks": [
            {
                "id": block_id,
                "name": f"{context.month_name} {context.year} Coordinator DOCX preview",
                "startDate": context.start_date,
                "endDate": end_date,
                "status": "Draft",
                "generate": {
                    "inpatient": True,
                    "outpatient": True,
                    "dailyReport": True,
                    "legend": True,
                    "export": True,
                },
                "holidays": july_2026_holiday,
            }
        ],
        "sources": [
            {
                "id": f"source-coordinator-docx-{context.month_slug}",
                "importedAt": date.today().isoformat(),
                "status": "Reviewed",
                "program": "Other",
                "fileType": "docx-bundle",
                "fileName": f"Coordinator {context.month_name} {context.year} DOCX schedule bundle",
                "importedRotatorCount": len(master["rotators"]),
            }
        ],
        "rotators": [make_rotator_state(rotator) for rotator in master["rotators"]],
        "attendings": [],
        "expectedSourcePrograms": PROGRAMS[:],
        "inpatientAssignments": [
            make_inpatient_assignment(record, rotators_by_id) for record in inpatient["records"]
        ],
        "outpatientSessions": [make_outpatient_session(record) for record in outpatient["sessions"]],
        "halfDayFacts": half_day_facts,
        "clinicAssignments": [],
        "rules": {"maxConsecutiveInpatientDays": 6, "honorNoClinicHolidays": True},
        "notes": [
            "Preview generated from Coordinator DOCX files. Programs and levels are placeholders unless inferable from the source.",
            "AM/PM schedule facts are preserved in halfDayFacts. Whole-day inpatient assignments remain for legacy views and are marked unsafe when the source row is partial-day.",
        ],
    }


def warning_messages(
    master: dict[str, Any],
    inpatient: dict[str, Any],
    outpatient: dict[str, Any],
    reconciliation: dict[str, Any],
) -> list[str]:
    warnings: list[str] = []
    if master["rotators"]:
        # The master schedule carries no program/school info, so every rotator
        # imports as program "Other" and program rules (Methodist 14/14, UT
        # year balance) stay inert until they are classified.
        warnings.append(
            f"{len(master['rotators'])} rotators imported with program 'Other' — classify Methodist/UT "
            "residents in Rotators (and set Methodist rotation start dates) to enable program rules."
        )
    for item in inpatient["unresolvedNames"]:
        warnings.append(f"Unresolved inpatient name on {item['date']}: {item['name']} ({item['raw']})")
    for item in outpatient["unresolvedNames"]:
        warnings.append(
            f"Unresolved outpatient name on {item['date']} {item['period']}: {item['name']} ({item['raw']})"
        )
    for record in inpatient["halfDayAnnotations"]:
        annotations = ", ".join(record["annotations"])
        warnings.append(
            f"Inpatient half-day annotation on {record['date']} for {record['fullName']}: {annotations}. "
            "Preview stores a first-class half-day fact and keeps a legacy whole-day inpatient assignment marked unsafe."
        )
    if master["counts"]["halfDayCells"]:
        warnings.append(
            f"Master schedule has {master['counts']['halfDayCells']} IP/OP cells with AM/PM continuity markers."
        )
    if reconciliation["counts"]["mismatches"]:
        warnings.append(f"Reconciliation found {reconciliation['counts']['mismatches']} master-vs-roster mismatches.")
    if reconciliation["counts"]["coverageMismatches"]:
        warnings.append(
            f"Coverage row validation found {reconciliation['counts']['coverageMismatches']} mismatched dates."
        )
    return warnings


def parse_coordinator_docx_bundle(
    master_path: str | Path | None = None,
    inpatient_path: str | Path | None = None,
    outpatient_path: str | Path | None = None,
) -> dict[str, Any]:
    if master_path is None or inpatient_path is None or outpatient_path is None:
        defaults = default_coordinator_docx_paths()
        master_path = master_path or defaults["master"]
        inpatient_path = inpatient_path or defaults["inpatient"]
        outpatient_path = outpatient_path or defaults["outpatient"]
    context = _context_from_paths([master_path, inpatient_path, outpatient_path])
    with _using_bundle_context(context):
        master = parse_master_schedule(master_path)
        resolver = NameResolver(master["rotators"])
        inpatient = parse_inpatient_roster(inpatient_path, resolver)
        outpatient = parse_outpatient_assignments(outpatient_path, resolver)
        reconciliation = reconcile(master, inpatient, outpatient)
        state_preview = build_scheduler_state_preview(master, inpatient, outpatient)
        warnings = warning_messages(master, inpatient, outpatient, reconciliation)
        # Persist the warnings on the source record so the Sources screen can
        # show them after the import is applied, matching roster imports.
        for source in state_preview["sources"]:
            source["importWarnings"] = warnings
            source["importWarningCount"] = len(warnings)

    return {
        "generatedAt": f"{date.today().isoformat()}T00:00:00",
        "sourceFiles": {
            "master": str(master_path),
            "inpatient": str(inpatient_path),
            "outpatient": str(outpatient_path),
        },
        "master": master,
        "inpatient": inpatient,
        "outpatient": outpatient,
        "schedulerStatePreview": state_preview,
        "reconciliation": reconciliation,
        "warnings": warnings,
        "acceptance": {
            "unresolvedNames": inpatient["counts"]["unresolvedNames"] + outpatient["counts"]["unresolvedNames"],
            "rotators": master["counts"]["rotators"],
            "inpatientAssignments": len(state_preview["inpatientAssignments"]),
            "outpatientSessions": len(state_preview["outpatientSessions"]),
            "halfDayAnnotations": inpatient["counts"]["halfDayAnnotations"],
            "halfDayFacts": len(state_preview["halfDayFacts"]),
        },
    }


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def summary_markdown(preview: dict[str, Any]) -> str:
    acceptance = preview["acceptance"]
    reconciliation = preview["reconciliation"]
    lines = [
        "# Coordinator DOCX Import Preview",
        "",
        "## Source Files",
        f"- Master: `{preview['sourceFiles']['master']}`",
        f"- Inpatient: `{preview['sourceFiles']['inpatient']}`",
        f"- Outpatient: `{preview['sourceFiles']['outpatient']}`",
        "",
        "## Counts",
        f"- Rotators from master schedule: {acceptance['rotators']}",
        f"- Fellows detected: {', '.join(preview['master']['fellows'])}",
        f"- Inpatient roster assignments: {acceptance['inpatientAssignments']}",
        f"- Outpatient sessions: {acceptance['outpatientSessions']}",
        f"- Inpatient half-day annotations: {acceptance['halfDayAnnotations']}",
        f"- First-class half-day facts: {acceptance['halfDayFacts']}",
        f"- Master AM/PM continuity cells: {preview['master']['counts']['halfDayCells']}",
        f"- Unresolved names: {acceptance['unresolvedNames']}",
        f"- Reconciliation mismatches: {reconciliation['counts']['mismatches']}",
        f"- Coverage row mismatches: {reconciliation['counts']['coverageMismatches']}",
        "",
        "## Mapping Notes",
        "- The preview is scheduler-state-compatible JSON and can be imported from the Sources page via the Coordinator DOCX bundle action.",
        "- Programs and resident levels are placeholders because the DOCX files do not fully encode them.",
        "- Inpatient AM/PM clinic/AHD annotations and master AM/PM cells are preserved in `halfDayFacts`; legacy whole-day inpatient rows remain marked with `unsafeWholeDayMapping: true` when partial-day.",
        "- The generated service block ends on the latest date found in the DOCX bundle.",
        "",
        "## Warnings",
    ]
    if preview["warnings"]:
        lines.extend(f"- {warning}" for warning in preview["warnings"])
    else:
        lines.append("- None")

    lines.extend(["", "## Reconciliation Mismatches"])
    mismatches = reconciliation["mismatches"]
    if mismatches:
        for item in mismatches[:50]:
            name = item.get("fullName", "unknown")
            detail = item.get("clinicLabel") or item.get("raw") or item.get("annotation") or ""
            lines.append(
                f"- {item['date']} {item['kind']}: {name} "
                f"(master: {item.get('master', item.get('masterPeriod', 'n/a'))}; {detail})"
            )
        if len(mismatches) > 50:
            lines.append(f"- ...and {len(mismatches) - 50} more in `reconciliation.json`.")
    else:
        lines.append("- None")
    lines.append("")
    return "\n".join(lines)


def write_preview_artifacts(preview: dict[str, Any], output_dir: str | Path = DEFAULT_OUTPUT_DIR) -> dict[str, str]:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    files = {
        "preview": out / "preview.json",
        "schedulerStatePreview": out / "scheduler-state-preview.json",
        "master": out / "master-schedule.json",
        "inpatient": out / "inpatient-roster.json",
        "outpatient": out / "outpatient-assignments.json",
        "reconciliation": out / "reconciliation.json",
        "summary": out / "summary.md",
    }
    write_json(files["preview"], preview)
    write_json(files["schedulerStatePreview"], preview["schedulerStatePreview"])
    write_json(files["master"], preview["master"])
    write_json(files["inpatient"], preview["inpatient"])
    write_json(files["outpatient"], preview["outpatient"])
    write_json(files["reconciliation"], preview["reconciliation"])
    files["summary"].write_text(summary_markdown(preview), encoding="utf-8")
    return {key: str(path) for key, path in files.items()}
