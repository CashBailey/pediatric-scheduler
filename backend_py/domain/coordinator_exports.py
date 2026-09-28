"""Coordinator's three final-schedule documents, exported as docx + pdf.

Master / Inpatient / Outpatient in exactly the July-format layout that
coordinator_docx_import.py parses inbound — the export mirrors that grammar
(starred fellows, IP/OP/OFF cell text with AM/PM period lines, literal
"Inpatient coverage" / "Outpatient coverage" bottom rows, Sun–Sat month
calendar with FELLOW OFF, weekly AM/PM outpatient tables with bold
attendings and "No Clinic" cells), so a generated bundle round-trips
through the importer with zero mismatches.
"""

from __future__ import annotations

import base64
import calendar
import datetime
import io
from typing import Any

from docx import Document
from docx.enum.section import WD_ORIENT

from backend_py.domain.calendar_utils import date_range, weekday_name
from backend_py.domain.clinics import build_week_grid, service_type_for_rotator_date
from backend_py.domain.draft import (
    continuity_periods_for_weekday,
    is_fellow_rotator,
    is_rotator_active_on,
    is_rotator_unavailable,
)
from backend_py.domain.reports import active_block
from backend_py.domain.word_exports import DOCX_MIME, _document_bytes, _set_cells, _shade_cell
from backend_py.domain import pdf_exports as pdf

STAR = "★"
UNAVAILABLE_FILL = "BDBDBD"
STATUS_FILLS = {
    "IP": "DFF1DF",
    "OP": "DCE9F9",
    "OFF": "FBEAD3",
}
PDF_STATUS_RGB = {
    "IP": (0.874, 0.945, 0.874),
    "OP": (0.863, 0.914, 0.976),
    "OFF": (0.984, 0.918, 0.827),
    "UNAVAILABLE": (0.741, 0.741, 0.741),
}


# ---------------------------------------------------------------------------
# Shared models


def _sorted_rotators(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Fellows starred on top, then everyone alphabetical — the Master order."""
    def label(rotator: dict[str, Any]) -> str:
        return str(rotator.get("displayName") or rotator.get("fullName") or "")

    return sorted(
        state.get("rotators") or [],
        key=lambda r: (not is_fellow_rotator(r), label(r).lower()),
    )


def _continuity_period(state: dict[str, Any], rotator: dict[str, Any], date: str) -> str:
    """AM/PM continuity superscript for a cell. halfDayFacts (from an imported
    Coordinator bundle) win; natively-built blocks fall back to the rotator's
    continuityClinic profile text."""
    rotator_id = rotator.get("id")
    for fact in state.get("halfDayFacts") or []:
        if (
            isinstance(fact, dict)
            and fact.get("rotatorId") == rotator_id
            and fact.get("date") == date
            and str(fact.get("period") or "").upper() in {"AM", "PM"}
        ):
            return str(fact["period"]).upper()
    periods = sorted(continuity_periods_for_weekday(rotator.get("continuityClinic"), weekday_name(date)))
    return periods[0] if periods else ""


def _master_cell(state: dict[str, Any], rotator: dict[str, Any], date: str) -> dict[str, str]:
    """One Master cell: status IP/OP/OFF, '' for open, UNAVAILABLE for
    off-service/away days (gray fill, no text — parse_master_cell's shape).
    'both' collapses to IP: her format holds one status per cell, and the
    inpatient service is the one that needs the coverage count."""
    if not is_rotator_active_on(rotator, date):
        return {"status": "UNAVAILABLE", "period": ""}
    service = service_type_for_rotator_date(state, rotator.get("id"), date)
    if service == "off":
        if is_rotator_unavailable(rotator, date):
            return {"status": "UNAVAILABLE", "period": ""}
        return {"status": "OFF", "period": ""}
    if service in {"inpatient", "both"}:
        status = "IP"
    elif service == "outpatient":
        status = "OP"
    else:
        return {"status": "", "period": ""}
    return {"status": status, "period": _continuity_period(state, rotator, date)}


def build_master_grid_model(state: dict[str, Any], block: dict[str, Any]) -> dict[str, Any]:
    dates = date_range(block["startDate"], block["endDate"]) if block.get("startDate") and block.get("endDate") else []
    rows = []
    for rotator in _sorted_rotators(state):
        cells = {date: _master_cell(state, rotator, date) for date in dates}
        if all(cell["status"] == "UNAVAILABLE" for cell in cells.values()):
            continue  # not in this block at all — her format lists only block rotators
        rows.append(
            {
                "name": str(rotator.get("displayName") or rotator.get("fullName") or ""),
                "starred": is_fellow_rotator(rotator),
                "cells": cells,
            }
        )
    coverage = {
        "Inpatient coverage": {
            date: sum(1 for row in rows if row["cells"][date]["status"] == "IP") for date in dates
        },
        "Outpatient coverage": {
            date: sum(1 for row in rows if row["cells"][date]["status"] == "OP") for date in dates
        },
    }
    return {"dates": dates, "rows": rows, "coverage": coverage}


def _sunday_weeks(dates: list[str]) -> list[list[str]]:
    """Sun–Sat buckets for the Inpatient month calendar."""
    by_sunday: dict[str, list[str]] = {}
    for date in dates:
        day = datetime.date.fromisoformat(date)
        sunday = day - datetime.timedelta(days=(day.weekday() + 1) % 7)
        by_sunday.setdefault(sunday.isoformat(), []).append(date)
    return [sorted(by_sunday[key]) for key in sorted(by_sunday)]


def build_inpatient_calendar_model(state: dict[str, Any], block: dict[str, Any]) -> dict[str, Any]:
    dates = date_range(block["startDate"], block["endDate"]) if block.get("startDate") and block.get("endDate") else []
    rotators = _sorted_rotators(state)
    fellows = [r for r in rotators if is_fellow_rotator(r)]
    days: dict[str, list[dict[str, Any]]] = {}
    for date in dates:
        entries: list[dict[str, Any]] = []
        on_service = {
            item.get("rotatorId")
            for item in state.get("inpatientAssignments") or []
            if item.get("date") == date and item.get("role") != "Off"
        }
        for fellow in fellows:
            if not is_rotator_active_on(fellow, date):
                continue
            if fellow.get("id") in on_service:
                entries.append(
                    {
                        "label": str(fellow.get("displayName") or fellow.get("fullName") or ""),
                        "starred": True,
                        "annotation": _annotation(state, fellow, date),
                    }
                )
            else:
                entries.append({"label": "FELLOW OFF", "starred": True, "annotation": ""})
        for rotator in rotators:
            if is_fellow_rotator(rotator) or rotator.get("id") not in on_service:
                continue
            entries.append(
                {
                    "label": str(rotator.get("displayName") or rotator.get("fullName") or ""),
                    "starred": False,
                    "annotation": _annotation(state, rotator, date),
                }
            )
        days[date] = entries
    return {"dates": dates, "weeks": _sunday_weeks(dates), "days": days}


def _annotation(state: dict[str, Any], rotator: dict[str, Any], date: str) -> str:
    period = _continuity_period(state, rotator, date)
    return f"{period} Clinic" if period else ""


def _outpatient_card_parts(card: dict[str, Any]) -> tuple[str, str]:
    """(bold attending segment, rest). Importer grammar: 'Attending (Clinic)'
    puts the provider outside the parens; a bare label is clinic-only."""
    clinic = str(card.get("clinicName") or "Clinic")
    attending = str(card.get("attendingName") or "")
    names = ", ".join(card.get("rotatorNames") or [])
    if attending and attending != clinic:
        return attending, f" ({clinic}): {names}" if names else f" ({clinic})"
    return "", f"{clinic}: {names}" if names else clinic


# ---------------------------------------------------------------------------
# DOCX builders


def _month_day_label(date: str) -> str:
    day = datetime.date.fromisoformat(date)
    return f"{calendar.month_name[day.month]} {day.day}"


def _coordinator_master_docx(state: dict[str, Any], block: dict[str, Any]) -> bytes:
    model = build_master_grid_model(state, block)
    document = Document()
    section = document.sections[-1]
    section.orientation = WD_ORIENT.LANDSCAPE
    section.page_width, section.page_height = section.page_height, section.page_width

    document.add_heading(f"{block.get('name') or 'Schedule'} - Master Schedule", level=1)
    document.add_paragraph(
        "Legend: IP = inpatient, OP = outpatient, OFF = day off, gray = off service or unavailable. "
        "AM/PM marks the continuity clinic half-day."
    )

    table = document.add_table(rows=1, cols=1 + len(model["dates"]))
    table.style = "Table Grid"
    _set_cells(table.rows[0].cells, ["Rotator"] + [_month_day_label(date) for date in model["dates"]])

    for row_model in model["rows"]:
        row = table.add_row()
        name = f"{STAR} {row_model['name']}" if row_model["starred"] else row_model["name"]
        values: list[str] = [name]
        for date in model["dates"]:
            cell = row_model["cells"][date]
            if cell["status"] in {"", "UNAVAILABLE"}:
                values.append("")
            elif cell["period"]:
                values.append(f"{cell['status']}\n{cell['period']}")
            else:
                values.append(cell["status"])
        _set_cells(row.cells, values)
        for index, date in enumerate(model["dates"], start=1):
            cell = row_model["cells"][date]
            if cell["status"] == "UNAVAILABLE":
                _shade_cell(row.cells[index], UNAVAILABLE_FILL)
            elif cell["status"] in STATUS_FILLS:
                _shade_cell(row.cells[index], STATUS_FILLS[cell["status"]])

    for label, counts in model["coverage"].items():
        row = table.add_row()
        _set_cells(row.cells, [label] + [str(counts[date]) for date in model["dates"]])

    return _document_bytes(document)


def _coordinator_inpatient_docx(state: dict[str, Any], block: dict[str, Any]) -> bytes:
    model = build_inpatient_calendar_model(state, block)
    document = Document()
    document.add_heading(f"{block.get('name') or 'Schedule'} - Inpatient Schedule", level=1)
    document.add_paragraph(f"{block.get('startDate') or ''} to {block.get('endDate') or ''}")

    weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    table = document.add_table(rows=1, cols=7)
    table.style = "Table Grid"
    _set_cells(table.rows[0].cells, [weekday[:3] for weekday in weekdays])

    for week in model["weeks"]:
        by_weekday = {weekday_name(date): date for date in week}
        row = table.add_row()
        values = []
        for weekday in weekdays:
            date = by_weekday.get(weekday)
            if not date:
                values.append("")
                continue
            day_number = int(date.split("-")[2])
            lines = [str(day_number)]
            for entry in model["days"].get(date, []):
                label = f"{STAR} {entry['label']}" if entry["starred"] else entry["label"]
                if entry["annotation"]:
                    label = f"{label} {entry['annotation']}"
                lines.append(label)
            values.append("\n".join(lines))
        _set_cells(row.cells, values)

    return _document_bytes(document)


def _coordinator_outpatient_docx(state: dict[str, Any], block: dict[str, Any]) -> bytes:
    document = Document()
    document.add_heading(f"{block.get('name') or 'Schedule'} - Outpatient Schedule", level=1)
    document.add_paragraph(f"{block.get('startDate') or ''} to {block.get('endDate') or ''}")

    weekday_columns = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    for week in build_week_grid(state, block):
        document.add_heading(f"{week['label']} ({week['startDate']} to {week['endDate']})", level=2)
        table = document.add_table(rows=3, cols=6)
        table.style = "Table Grid"
        days_by_weekday = {day["weekday"]: day for day in week["days"]}
        header = table.rows[0].cells
        _set_cells(header, [""] + [
            f"{weekday[:3]} {_month_day_label(days_by_weekday[weekday]['date'])}" if weekday in days_by_weekday else ""
            for weekday in weekday_columns
        ])
        for row_index, period in enumerate(("AM", "PM"), start=1):
            cells = table.rows[row_index].cells
            _set_cells(cells[:1], [period])
            for column, weekday in enumerate(weekday_columns, start=1):
                day = days_by_weekday.get(weekday)
                cell = cells[column]
                if day is None:
                    cell.text = ""
                    continue
                if day.get("holiday"):
                    cell.text = f"{day['holiday']} - No Clinic"
                    continue
                cards = day.get(period) or []
                if not cards:
                    cell.text = "No clinic"
                    continue
                cell.text = ""
                for card_index, card in enumerate(cards):
                    paragraph = cell.paragraphs[0] if card_index == 0 else cell.add_paragraph()
                    attending, rest = _outpatient_card_parts(card)
                    if attending:
                        run = paragraph.add_run(attending)
                        run.bold = True
                    paragraph.add_run(rest)

    return _document_bytes(document)


# ---------------------------------------------------------------------------
# PDF builders (reuse pdf_exports' dependency-free writer; /F2 = bold)


def _coordinator_master_pdf(state: dict[str, Any], block: dict[str, Any]) -> bytes:
    model = build_master_grid_model(state, block)
    dates = model["dates"]
    title = f"{block.get('name') or 'Schedule'} - Master Schedule"
    name_width = 120.0
    grid_left = pdf.MARGIN + name_width
    grid_right = pdf.PAGE_WIDTH - pdf.MARGIN
    column_width = (grid_right - grid_left) / max(1, len(dates))
    header_height = 22.0
    row_height = 15.0
    top = pdf.PAGE_HEIGHT - pdf.MARGIN - 30
    rows_per_page = max(1, int((top - pdf.MARGIN - header_height - 2 * row_height) / row_height))

    all_rows = model["rows"]
    pages = [all_rows[i:i + rows_per_page] for i in range(0, len(all_rows), rows_per_page)] or [[]]
    streams = []
    for page_index, page_rows in enumerate(pages):
        commands: list[str] = []

        def fill(x: float, y: float, w: float, h: float, rgb: tuple[float, float, float]) -> str:
            return f"{rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f} rg {x:.1f} {y:.1f} {w:.1f} {h:.1f} re f"

        def text(x: float, y: float, size: int, value: str, bold: bool = False) -> str:
            font = "/F2" if bold else "/F1"
            return f"BT 0 0 0 rg {font} {size} Tf {x:.1f} {y:.1f} Td ({pdf._escape(value)}) Tj ET"

        commands.append(text(pdf.MARGIN, pdf.PAGE_HEIGHT - pdf.MARGIN + 14, 14, title, bold=True))
        include_coverage = page_index == len(pages) - 1
        body_rows = len(page_rows) + (2 if include_coverage else 0)
        grid_bottom = top - header_height - body_rows * row_height

        for column, date in enumerate(dates):
            commands.append(text(grid_left + column * column_width + 1, top - 9, 5, weekday_name(date)[:3]))
            commands.append(text(grid_left + column * column_width + 1, top - 17, 5, date[5:]))
        for row_index, row_model in enumerate(page_rows):
            y = top - header_height - (row_index + 1) * row_height
            name = f"* {row_model['name']}" if row_model["starred"] else row_model["name"]
            commands.append(text(pdf.MARGIN, y + 4, 7, name[:28], bold=row_model["starred"]))
            for column, date in enumerate(dates):
                cell = row_model["cells"][date]
                x = grid_left + column * column_width
                if cell["status"] in PDF_STATUS_RGB:
                    commands.append(fill(x, y, column_width, row_height, PDF_STATUS_RGB[cell["status"]]))
                if cell["status"] not in {"", "UNAVAILABLE"}:
                    label = cell["status"] + (f" {cell['period']}" if cell["period"] else "")
                    commands.append(text(x + 1, y + 4, 5, label))
        if include_coverage:
            for extra, (label, counts) in enumerate(model["coverage"].items()):
                y = top - header_height - (len(page_rows) + extra + 1) * row_height
                commands.append(text(pdf.MARGIN, y + 4, 6, label, bold=True))
                for column, date in enumerate(dates):
                    commands.append(text(grid_left + column * column_width + 1, y + 4, 6, str(counts[date])))

        commands.append("0.6 0.6 0.6 RG 0.5 w")
        for column in range(len(dates) + 1):
            x = grid_left + column * column_width
            commands.append(f"{x:.1f} {grid_bottom:.1f} m {x:.1f} {top:.1f} l S")
        for row_index in range(body_rows + 1):
            y = top - header_height - row_index * row_height
            commands.append(f"{pdf.MARGIN:.1f} {y:.1f} m {grid_right:.1f} {y:.1f} l S")
        commands.append(text(pdf.PAGE_WIDTH - pdf.MARGIN - 80, pdf.MARGIN / 2, 9, f"Page {page_index + 1} of {len(pages)}"))
        streams.append("\n".join(commands).encode("latin-1", errors="replace"))

    return pdf._assemble_pdf(streams)


def _coordinator_inpatient_pdf(state: dict[str, Any], block: dict[str, Any]) -> bytes:
    model = build_inpatient_calendar_model(state, block)
    lines: list[str] = [f"{block.get('startDate') or ''} to {block.get('endDate') or ''}", ""]
    for week in model["weeks"]:
        for date in week:
            entries = model["days"].get(date, [])
            labels = []
            for entry in entries:
                label = f"* {entry['label']}" if entry["starred"] else entry["label"]
                if entry["annotation"]:
                    label = f"{label} ({entry['annotation']})"
                labels.append(label)
            lines.append(f"{weekday_name(date)[:3]} {_month_day_label(date)}: {', '.join(labels) if labels else 'Open'}")
        lines.append("")
    return pdf._render_pdf(f"{block.get('name') or 'Schedule'} - Inpatient Schedule", lines)


def _coordinator_outpatient_pdf(state: dict[str, Any], block: dict[str, Any]) -> bytes:
    weeks = build_week_grid(state, block)
    streams = [
        pdf._week_grid_page(
            f"{block.get('name') or 'Schedule'} - Outpatient Schedule",
            week,
            index + 1,
            len(weeks),
        )
        for index, week in enumerate(weeks)
    ]
    if not streams:
        return pdf._render_pdf(f"{block.get('name') or 'Schedule'} - Outpatient Schedule", ["No clinic weeks in this block."])
    return pdf._assemble_pdf(streams)


# ---------------------------------------------------------------------------
# Bundle


def build_coordinator_bundle(state: dict[str, Any]) -> list[dict[str, str]]:
    block = active_block(state) or {}
    safe_name = _slug(block.get("name") or "schedule")
    files = [
        (f"{safe_name}-master-schedule.docx", DOCX_MIME, _coordinator_master_docx(state, block)),
        (f"{safe_name}-master-schedule.pdf", "application/pdf", _coordinator_master_pdf(state, block)),
        (f"{safe_name}-inpatient-schedule.docx", DOCX_MIME, _coordinator_inpatient_docx(state, block)),
        (f"{safe_name}-inpatient-schedule.pdf", "application/pdf", _coordinator_inpatient_pdf(state, block)),
        (f"{safe_name}-outpatient-schedule.docx", DOCX_MIME, _coordinator_outpatient_docx(state, block)),
        (f"{safe_name}-outpatient-schedule.pdf", "application/pdf", _coordinator_outpatient_pdf(state, block)),
    ]
    return [
        {"name": name, "mimeType": mime, "base64": base64.b64encode(content).decode("ascii")}
        for name, mime, content in files
    ]


def _slug(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-") or "schedule"
