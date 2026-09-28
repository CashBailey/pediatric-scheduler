"""Small dependency-free PDF exports for the native macOS app.

The React app uses jsPDF in the browser. The native app needs PDF files without
bringing the browser stack along, so this module writes simple text-first PDFs
directly. They are intentionally plain but valid: schedule, inpatient poster,
and outpatient poster artifacts that can be opened, printed, and shared.
"""

from __future__ import annotations

import base64
from typing import Any

from backend_py.domain.calendar_utils import date_range, weekday_name
from backend_py.domain.clinics import build_week_grid, clinic_assignment_rows, week_grid_card_text
from backend_py.domain.reports import active_block, detect_conflicts, get_rotator
from backend_py.domain.state_ops import DEFAULT_POSTER_SETTINGS

PAGE_WIDTH = 792
PAGE_HEIGHT = 612
MARGIN = 44
LINE_HEIGHT = 14
MAX_CHARS = 110


def build_pdf_exports(state: dict[str, Any]) -> list[dict[str, str]]:
    block = active_block(state) or {}
    safe_name = _slug(block.get("name") or "schedule")
    files = [
        (f"{safe_name}-schedule.pdf", _schedule_pdf(state, block)),
        (f"{safe_name}-inpatient-poster.pdf", _inpatient_poster_pdf(state, block)),
        (f"{safe_name}-outpatient-poster.pdf", _outpatient_poster_pdf(state, block)),
        (f"{safe_name}-outpatient-week-grid.pdf", _outpatient_week_grid_pdf(state, block)),
    ]
    return [
        {
            "name": name,
            "mimeType": "application/pdf",
            "base64": base64.b64encode(content).decode("ascii"),
        }
        for name, content in files
    ]


def _schedule_pdf(state: dict[str, Any], block: dict[str, Any]) -> bytes:
    lines = _block_header(block)
    lines.extend(["", "Inpatient"])
    for date in _block_dates(block):
        names = [
            _rotator_label(state, item.get("rotatorId"))
            for item in state.get("inpatientAssignments", [])
            if item.get("date") == date and item.get("role") != "Off"
        ]
        lines.append(f"{_day(date)}: {', '.join(sorted(names)) if names else 'No inpatient coverage'}")

    lines.extend(["", "Outpatient"])
    for date in _block_dates(block):
        sessions = [
            f"{item.get('period')} {item.get('clinic') or 'Clinic'} - {_rotator_label(state, item.get('rotatorId'))}"
            for item in state.get("outpatientSessions", [])
            if item.get("date") == date
        ]
        if sessions:
            lines.append(f"{_day(date)}: {'; '.join(sorted(sessions))}")

    lines.extend(["", "Clinic Assignments"])
    clinic_rows = clinic_assignment_rows(state, block)
    if clinic_rows:
        for date in _block_dates(block):
            rows = [_clinic_line(row) for row in clinic_rows if row.get("date") == date]
            if rows:
                lines.append(f"{_day(date)}: {'; '.join(rows)}")
    else:
        lines.append("No clinic assignments.")

    conflicts = detect_conflicts(state)
    lines.extend(["", "Conflicts"])
    if conflicts:
        for conflict in conflicts:
            lines.append(f"{conflict.get('date')}: {conflict.get('title')}")
    else:
        lines.append("No conflicts detected.")

    return _render_pdf(f"{block.get('name') or 'Schedule'} - Schedule", lines)


def _inpatient_poster_pdf(state: dict[str, Any], block: dict[str, Any]) -> bytes:
    settings = _poster_settings(state)
    lines = _poster_header(settings, block, "Inpatient Poster")
    for date in _block_dates(block):
        names = [
            _rotator_label(state, item.get("rotatorId"))
            for item in state.get("inpatientAssignments", [])
            if item.get("date") == date and item.get("role") != "Off"
        ]
        target = _coverage_count(block, date)
        status = f"{len(names)}/{target}" if target else f"{len(names)}"
        lines.append(f"{_day(date)} [{status}]: {', '.join(sorted(names)) if names else 'Open'}")
    lines.extend(_poster_footer(settings))
    return _render_pdf(f"{settings.get('programName') or 'Schedule'} - Inpatient Poster", lines)


def _outpatient_poster_pdf(state: dict[str, Any], block: dict[str, Any]) -> bytes:
    settings = _poster_settings(state)
    lines = _poster_header(settings, block, "Outpatient Poster")
    clinic_rows = clinic_assignment_rows(state, block)
    for date in _block_dates(block):
        if weekday_name(date) in {"Saturday", "Sunday"}:
            continue
        assigned = [_clinic_line(row) for row in clinic_rows if row.get("date") == date]
        if assigned:
            lines.append(f"{_day(date)}: {'; '.join(assigned)}")
        else:
            sessions = [
                f"{item.get('period')} {item.get('clinic') or 'Clinic'}: {_rotator_label(state, item.get('rotatorId'))}"
                for item in state.get("outpatientSessions", [])
                if item.get("date") == date
            ]
            lines.append(f"{_day(date)}: {'; '.join(sorted(sessions)) if sessions else 'No clinic sessions'}")
    lines.extend(_poster_footer(settings))
    return _render_pdf(f"{settings.get('programName') or 'Schedule'} - Outpatient Poster", lines)


# Week band fills mirror the app's Clinics week grid cycle (light blue,
# green, orange, purple) as 0-1 RGB triples for the `rg` fill operator.
WEEK_BAND_RGB = [(0.86, 0.91, 0.98), (0.87, 0.94, 0.87), (0.98, 0.92, 0.83), (0.92, 0.88, 0.96)]
NO_CLINIC_RGB = (0.23, 0.23, 0.23)
GRID_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]


def _outpatient_week_grid_pdf(state: dict[str, Any], block: dict[str, Any]) -> bytes:
    settings = _poster_settings(state)
    title = f"{settings.get('programName') or 'Schedule'} - Outpatient Week Grid"
    weeks = build_week_grid(state, block)
    if not weeks:
        return _render_pdf(title, ["No block dates."])
    streams = [
        _week_grid_page(title, week, page, len(weeks))
        for page, week in enumerate(weeks, start=1)
    ]
    return _assemble_pdf(streams)


def _week_grid_page(title: str, week: dict[str, Any], page: int, total: int) -> bytes:
    label_width = 34.0
    grid_left = MARGIN + label_width
    grid_right = PAGE_WIDTH - MARGIN
    column_width = (grid_right - grid_left) / len(GRID_WEEKDAYS)
    grid_top = PAGE_HEIGHT - MARGIN - 40
    header_height = 26.0
    row_height = (grid_top - MARGIN - header_height) / 2
    band = WEEK_BAND_RGB[(week["weekIndex"] - 1) % len(WEEK_BAND_RGB)]
    days_by_weekday = {day["weekday"]: day for day in week["days"]}

    def fill(x: float, y: float, w: float, h: float, rgb: tuple[float, float, float]) -> str:
        return f"{rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f} rg {x:.1f} {y:.1f} {w:.1f} {h:.1f} re f"

    commands: list[str] = []
    # Band fill: header row + session label column.
    commands.append(fill(MARGIN, grid_top - header_height, grid_right - MARGIN, header_height, band))
    commands.append(fill(MARGIN, MARGIN, label_width, grid_top - MARGIN - header_height, band))
    # Dark cells for holiday/no-clinic days (both sessions).
    for column, weekday in enumerate(GRID_WEEKDAYS):
        day = days_by_weekday.get(weekday)
        if day and day.get("holiday"):
            x = grid_left + column * column_width
            commands.append(fill(x, MARGIN, column_width, grid_top - MARGIN - header_height, NO_CLINIC_RGB))
    # Grid strokes.
    commands.append("0.6 0.6 0.6 RG 0.7 w")
    for column in range(len(GRID_WEEKDAYS) + 1):
        x = grid_left + column * column_width
        commands.append(f"{x:.1f} {MARGIN:.1f} m {x:.1f} {grid_top:.1f} l S")
    commands.append(f"{MARGIN:.1f} {MARGIN:.1f} m {MARGIN:.1f} {grid_top:.1f} l S")
    for y in (MARGIN, MARGIN + row_height, grid_top - header_height, grid_top):
        commands.append(f"{MARGIN:.1f} {y:.1f} m {grid_right:.1f} {y:.1f} l S")

    def text(x: float, y: float, size: int, value: str, white: bool = False) -> str:
        color = "1 1 1 rg" if white else "0 0 0 rg"
        return f"BT {color} /F1 {size} Tf {x:.1f} {y:.1f} Td ({_escape(value)}) Tj ET"

    commands.append(text(MARGIN, PAGE_HEIGHT - MARGIN, 15, title))
    commands.append(
        text(MARGIN, PAGE_HEIGHT - MARGIN - 17, 10, f"{week['label']}: {week['startDate']} to {week['endDate']}")
    )
    # Header cells.
    for column, weekday in enumerate(GRID_WEEKDAYS):
        x = grid_left + column * column_width + 4
        day = days_by_weekday.get(weekday)
        commands.append(text(x, grid_top - 11, 9, weekday[:3].upper()))
        commands.append(text(x, grid_top - 21, 8, day["date"] if day else "-"))
    # Session labels + cell content.
    max_lines = max(1, int(row_height / 9) - 1)
    per_line_chars = max(18, int(column_width / 3.7))
    for row_index, session in enumerate(("AM", "PM")):
        row_top = grid_top - header_height - row_index * row_height
        commands.append(text(MARGIN + 8, row_top - row_height / 2, 10, session))
        for column, weekday in enumerate(GRID_WEEKDAYS):
            day = days_by_weekday.get(weekday)
            if day is None:
                continue
            x = grid_left + column * column_width + 4
            if day.get("holiday"):
                if row_index == 0:
                    middle = MARGIN + (grid_top - MARGIN - header_height) / 2
                    commands.append(text(x, middle + 5, 9, str(day["holiday"]), white=True))
                    commands.append(text(x, middle - 6, 8, "No Clinic", white=True))
                continue
            lines: list[str] = []
            for card in day.get(session) or []:
                wrapped = _wrap(week_grid_card_text(card))
                lines.extend(
                    segment[:per_line_chars] if len(segment) > per_line_chars else segment
                    for raw in wrapped
                    for segment in [raw]
                )
            y = row_top - 12
            for line in lines[:max_lines]:
                commands.append(text(x, y, 7, line))
                y -= 9
            if len(lines) > max_lines:
                commands.append(text(x, y, 7, "..."))

    footer = f"Page {page} of {total}"
    commands.append(text(PAGE_WIDTH - MARGIN - 80, MARGIN / 2, 9, footer))
    return "\n".join(commands).encode("latin-1", errors="replace")


def _render_pdf(title: str, raw_lines: list[str]) -> bytes:
    pages: list[list[str]] = []
    current: list[str] = []
    max_lines = int((PAGE_HEIGHT - (MARGIN * 2)) / LINE_HEIGHT) - 2
    for raw in raw_lines:
        wrapped = _wrap(raw)
        for line in wrapped:
            if len(current) >= max_lines:
                pages.append(current)
                current = []
            current.append(line)
    pages.append(current or [""])
    streams = [
        _page_stream(title, lines, index + 1, len(pages))
        for index, lines in enumerate(pages)
    ]
    return _assemble_pdf(streams)


def _assemble_pdf(streams: list[bytes]) -> bytes:
    objects: list[bytes] = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    page_object_ids = [5 + index * 2 for index in range(len(streams))]
    kids = " ".join(f"{object_id} 0 R" for object_id in page_object_ids)
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(streams)} >>".encode("ascii"))
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

    for index, stream in enumerate(streams):
        page_id = 5 + index * 2
        content_id = page_id + 1
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
            f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {content_id} 0 R >>".encode("ascii")
        )
        objects.append(f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream")

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for object_id, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{object_id} 0 obj\n".encode("ascii"))
        out.extend(body)
        out.extend(b"\nendobj\n")
    xref_offset = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    out.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        out.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    out.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return bytes(out)


def _page_stream(title: str, lines: list[str], page: int, total: int) -> bytes:
    commands = [
        "BT",
        "/F1 16 Tf",
        f"{MARGIN} {PAGE_HEIGHT - MARGIN} Td",
        f"({_escape(title)}) Tj",
        "/F1 10 Tf",
        f"0 -{LINE_HEIGHT * 1.6:.1f} Td",
    ]
    for line in lines:
        commands.append(f"({_escape(line)}) Tj")
        commands.append(f"0 -{LINE_HEIGHT} Td")
    commands.extend(
        [
            "ET",
            "BT",
            "/F1 9 Tf",
            f"{PAGE_WIDTH - MARGIN - 80} {MARGIN / 2:.1f} Td",
            f"(Page {page} of {total}) Tj",
            "ET",
        ]
    )
    return "\n".join(commands).encode("latin-1", errors="replace")


def _block_header(block: dict[str, Any]) -> list[str]:
    return [
        block.get("name") or "Schedule",
        f"{block.get('startDate') or ''} to {block.get('endDate') or ''}",
    ]


def _poster_settings(state: dict[str, Any]) -> dict[str, Any]:
    settings = state.get("posterSettings") if isinstance(state.get("posterSettings"), dict) else {}
    return {**DEFAULT_POSTER_SETTINGS, **settings}


def _poster_header(settings: dict[str, Any], block: dict[str, Any], title: str) -> list[str]:
    lines = [
        settings.get("programName") or DEFAULT_POSTER_SETTINGS["programName"],
        title,
        block.get("name") or "Schedule",
        f"{block.get('startDate') or ''} to {block.get('endDate') or ''}",
    ]
    chief = str(settings.get("chief") or "").strip()
    if chief:
        lines.append(f"Chief: {chief}")
    locations = settings.get("locations") if isinstance(settings.get("locations"), list) else []
    visible_locations = [
        location for location in locations
        if isinstance(location, dict) and (location.get("name") or location.get("address"))
    ]
    if visible_locations:
        lines.append("")
        lines.append("Locations")
        for location in visible_locations:
            name = str(location.get("name") or "").strip()
            address = str(location.get("address") or "").strip()
            lines.append(f"{name}{' - ' + address if address else ''}")
    lines.append("")
    return lines


def _poster_footer(settings: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    notes = settings.get("notes") if isinstance(settings.get("notes"), list) else []
    visible_notes = [str(note).strip() for note in notes if str(note).strip()]
    if visible_notes:
        lines.extend(["", "Notes"])
        lines.extend(f"- {note}" for note in visible_notes)
    tagline = str(settings.get("tagline") or "").strip()
    if tagline:
        lines.extend(["", tagline])
    return lines


def _block_dates(block: dict[str, Any]) -> list[str]:
    if not block.get("startDate") or not block.get("endDate"):
        return []
    return date_range(block["startDate"], block["endDate"])


def _coverage_count(block: dict[str, Any], date: str) -> int:
    coverage = block.get("coverage") or {}
    day_key = "weekday"
    if weekday_name(date) == "Saturday":
        day_key = "saturday"
    elif weekday_name(date) == "Sunday":
        day_key = "sunday"
    value = (((coverage.get(day_key) or {}).get("ip") or {}).get("count"))
    return int(value) if isinstance(value, (int, float)) else 2


def _rotator_label(state: dict[str, Any], rotator_id: str | None) -> str:
    rotator = get_rotator(state, rotator_id)
    return (rotator or {}).get("displayName") or (rotator or {}).get("fullName") or rotator_id or "[Removed]"


def _clinic_line(row: dict[str, Any]) -> str:
    destination = row.get("clinicName") or "Clinic"
    attending = row.get("attendingName")
    if attending:
        destination = f"{destination} with {attending}"
    if row.get("stale"):
        destination = "Removed clinic"
    return f"{row.get('session')} {destination}: {row.get('rotatorName')}"


def _day(date: str) -> str:
    return f"{weekday_name(date)} {date}"


def _wrap(value: str) -> list[str]:
    text = str(value)
    if not text:
        return [""]
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) <= MAX_CHARS:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word[:MAX_CHARS]
    if current:
        lines.append(current)
    return lines or [""]


def _escape(value: str) -> str:
    return str(value).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _slug(value: str) -> str:
    out = "".join(ch if ch.isalnum() else "-" for ch in value.strip().lower()).strip("-")
    while "--" in out:
        out = out.replace("--", "-")
    return out or "schedule"
