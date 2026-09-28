"""Export package helpers ported from shared/scheduler/scheduler.js."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any

from backend_py.domain.calendar_utils import date_range
from backend_py.domain.clinics import clinic_assignment_rows
from backend_py.domain.draft import is_fellow_rotator, is_rotator_active_on
from backend_py.domain.reports import active_block, detect_conflicts, generate_daily_report


def _js_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _rotator_label(state: dict[str, Any], rotator_id: str | None) -> str:
    rotator = next((item for item in state.get("rotators") or [] if item.get("id") == rotator_id), None)
    return (rotator or {}).get("displayName") or (rotator or {}).get("fullName") or rotator_id or ""


def _assignment_summary(item: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    return {
        **item,
        "rotatorName": _rotator_label(state, item.get("rotatorId")),
    }


def _active_dates(rotator: dict[str, Any], block: dict[str, Any]) -> list[str]:
    dates = date_range(block.get("startDate"), block.get("endDate")) if block.get("startDate") and block.get("endDate") else []
    return [date for date in dates if is_rotator_active_on(rotator, date)]


def _format_legend_date_range(dates: list[str]) -> str:
    if not dates:
        return "Not in this block"

    def format_one(value: str) -> str:
        try:
            parsed = datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            return value
        return f"{parsed.strftime('%b')} {parsed.day}"

    runs: list[tuple[str, str]] = []
    run_start = dates[0]
    run_end = dates[0]
    for value in dates[1:]:
        prior = datetime.strptime(run_end, "%Y-%m-%d")
        current = datetime.strptime(value, "%Y-%m-%d")
        if (current - prior).days == 1:
            run_end = value
        else:
            runs.append((run_start, run_end))
            run_start = value
            run_end = value
    runs.append((run_start, run_end))
    return ", ".join(format_one(start) if start == end else f"{format_one(start)} to {format_one(end)}" for start, end in runs)


def _legend_number(rotator: dict[str, Any], resident_number: int) -> str:
    role = rotator.get("role") or ""
    level = rotator.get("level") or ""
    if is_fellow_rotator(rotator):
        return "Fellow"
    if role == "Student" or str(level).startswith("MS"):
        return "MS"
    return str(resident_number)


def build_legend(state: dict[str, Any], block: dict[str, Any]) -> dict[str, Any]:
    active = []
    for rotator in state.get("rotators") or []:
        dates = _active_dates(rotator, block)
        if dates:
            active.append({"rotator": rotator, "activeDates": dates, "firstActiveDate": dates[0]})
    active.sort(key=lambda item: (item["firstActiveDate"], (item["rotator"].get("displayName") or "").lower()))

    resident_number = 0
    entries = []
    for item in active:
        rotator = item["rotator"]
        role = rotator.get("role") or ""
        level = rotator.get("level") or ""
        if not (is_fellow_rotator(rotator) or role == "Student" or str(level).startswith("MS")):
            resident_number += 1
            number = str(resident_number)
        else:
            number = _legend_number(rotator, resident_number)
        entries.append(
            {
                "number": number,
                "rotatorId": rotator.get("id"),
                "displayLabel": rotator.get("displayName") or rotator.get("fullName") or "",
                "dateRange": _format_legend_date_range(item["activeDates"]),
                "continuityClinic": rotator.get("continuityClinic") or "",
            }
        )
    return {"entries": entries}


def build_inpatient_calendar(state: dict[str, Any], block: dict[str, Any]) -> list[dict[str, Any]]:
    dates = date_range(block.get("startDate"), block.get("endDate")) if block.get("startDate") and block.get("endDate") else []
    return [
        {
            "date": date,
            "assignments": [
                _assignment_summary(item, state)
                for item in state.get("inpatientAssignments") or []
                if item.get("date") == date and item.get("role") != "Off"
            ],
        }
        for date in dates
    ]


def build_outpatient_calendar(state: dict[str, Any], block: dict[str, Any]) -> list[dict[str, Any]]:
    dates = date_range(block.get("startDate"), block.get("endDate")) if block.get("startDate") and block.get("endDate") else []
    clinic_rows = clinic_assignment_rows(state, block)
    return [
        {
            "date": date,
            "sessions": [
                _assignment_summary(item, state)
                for item in state.get("outpatientSessions") or []
                if item.get("date") == date
            ],
            "clinicAssignments": [row for row in clinic_rows if row.get("date") == date],
        }
        for date in dates
    ]


def build_source_summary(state: dict[str, Any]) -> dict[str, Any]:
    sources = state.get("sources") if isinstance(state.get("sources"), list) else []
    expected = state.get("expectedSourcePrograms") if isinstance(state.get("expectedSourcePrograms"), list) else []
    programs_present = {source.get("program") for source in sources if isinstance(source, dict) and source.get("program")}
    return {
        "expectedPrograms": [
            {"program": program, "status": "present" if program in programs_present else "missing"}
            for program in expected
        ],
        "sources": [
            {
                "id": source.get("id"),
                "fileName": source.get("fileName"),
                "fileType": source.get("fileType"),
                "program": source.get("program"),
                "status": source.get("status"),
                "importedAt": source.get("importedAt"),
                "importedRotatorCount": source.get("importedRotatorCount"),
                "rows": len(source.get("parsedRows") or []),
                "importWarningCount": source.get("importWarningCount")
                if source.get("importWarningCount") is not None
                else len(source.get("importWarnings") or []),
            }
            for source in sources
            if isinstance(source, dict)
        ],
    }


def _file_entry(name: str, key: str, label: str, rows: int, format_: str = "json") -> dict[str, Any]:
    return {"name": name, "key": key, "label": label, "rows": rows, "format": format_}


def _csv_text(rows: list[dict[str, Any]], columns: list[str]) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=columns, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({column: _csv_cell(row.get(column)) for column in columns})
    return output.getvalue()


def _csv_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return " | ".join(_csv_cell(item) for item in value)
    if isinstance(value, dict):
        return "; ".join(f"{key}: {_csv_cell(value.get(key))}" for key in sorted(value))
    return str(value)


def _segment_label(segment: dict[str, Any]) -> str:
    label = f"{segment.get('start') or ''} to {segment.get('end') or ''}"
    if segment.get("defaultPhase"):
        label += f" ({segment['defaultPhase']})"
    return label


def build_roster_csv(state: dict[str, Any]) -> str:
    rows = [
        {
            "id": rotator.get("id"),
            "fullName": rotator.get("fullName"),
            "displayName": rotator.get("displayName"),
            "program": rotator.get("program"),
            "level": rotator.get("level"),
            "role": rotator.get("role"),
            "schoolType": rotator.get("schoolType"),
            "continuityClinic": rotator.get("continuityClinic"),
            "dayOff": rotator.get("dayOff") or [],
            "segments": [_segment_label(segment) for segment in rotator.get("segments") or []],
            "unavailableRanges": [_segment_label(range_) for range_ in rotator.get("unavailableRanges") or []],
        }
        for rotator in state.get("rotators") or []
    ]
    return _csv_text(
        rows,
        ["id", "fullName", "displayName", "program", "level", "role", "schoolType", "continuityClinic", "dayOff", "segments", "unavailableRanges"],
    )


def _inpatient_csv_rows(inpatient_calendar: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for day in inpatient_calendar:
        assignments = day.get("assignments") or []
        if not assignments:
            rows.append({"date": day.get("date")})
            continue
        for assignment in assignments:
            rows.append(
                {
                    "date": day.get("date"),
                    "assignmentId": assignment.get("id"),
                    "rotatorId": assignment.get("rotatorId"),
                    "rotatorName": assignment.get("rotatorName"),
                    "role": assignment.get("role"),
                    "source": assignment.get("source"),
                }
            )
    return rows


def build_inpatient_calendar_csv(inpatient_calendar: list[dict[str, Any]]) -> str:
    return _csv_text(_inpatient_csv_rows(inpatient_calendar), ["date", "assignmentId", "rotatorId", "rotatorName", "role", "source"])


def _outpatient_csv_rows(outpatient_calendar: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for day in outpatient_calendar:
        emitted = False
        for session in day.get("sessions") or []:
            rows.append(
                {
                    "date": day.get("date"),
                    "kind": "service",
                    "sessionId": session.get("id"),
                    "period": session.get("period"),
                    "clinic": session.get("clinic"),
                    "provider": session.get("provider"),
                    "rotatorId": session.get("rotatorId"),
                    "rotatorName": session.get("rotatorName"),
                    "status": session.get("status"),
                    "source": session.get("source"),
                }
            )
            emitted = True
        for assignment in day.get("clinicAssignments") or []:
            rows.append(
                {
                    "date": day.get("date"),
                    "kind": "clinic",
                    "assignmentId": assignment.get("id"),
                    "period": assignment.get("session"),
                    "clinic": assignment.get("clinicName"),
                    "provider": assignment.get("attendingName"),
                    "location": assignment.get("location"),
                    "rotatorId": assignment.get("rotatorId"),
                    "rotatorName": assignment.get("rotatorName"),
                    "source": assignment.get("source"),
                }
            )
            emitted = True
        if not emitted:
            rows.append({"date": day.get("date")})
    return rows


def build_outpatient_calendar_csv(outpatient_calendar: list[dict[str, Any]]) -> str:
    return _csv_text(
        _outpatient_csv_rows(outpatient_calendar),
        ["date", "kind", "sessionId", "assignmentId", "period", "clinic", "provider", "location", "rotatorId", "rotatorName", "status", "source"],
    )


def build_legend_csv(legend: dict[str, Any]) -> str:
    return _csv_text(
        legend.get("entries") or [],
        ["number", "rotatorId", "displayLabel", "dateRange", "continuityClinic"],
    )


def build_conflicts_csv(conflicts: list[dict[str, Any]]) -> str:
    return _csv_text(
        conflicts,
        ["id", "type", "severity", "title", "detail", "date", "rotatorId", "status", "assignment", "period"],
    )


def _source_summary_csv_rows(source_summary: dict[str, Any]) -> list[dict[str, Any]]:
    rows = [
        {
            "kind": "expectedProgram",
            "program": item.get("program"),
            "status": item.get("status"),
        }
        for item in source_summary.get("expectedPrograms") or []
    ]
    rows.extend(
        {
            "kind": "source",
            "id": source.get("id"),
            "fileName": source.get("fileName"),
            "fileType": source.get("fileType"),
            "program": source.get("program"),
            "status": source.get("status"),
            "importedAt": source.get("importedAt"),
            "importedRotatorCount": source.get("importedRotatorCount"),
            "rows": source.get("rows"),
            "importWarningCount": source.get("importWarningCount"),
        }
        for source in source_summary.get("sources") or []
    )
    return rows


def build_source_summary_csv(source_summary: dict[str, Any]) -> str:
    return _csv_text(
        _source_summary_csv_rows(source_summary),
        ["kind", "id", "fileName", "fileType", "program", "status", "importedAt", "importedRotatorCount", "rows", "importWarningCount"],
    )


def generate_export_manifest(
    state: dict[str, Any],
    *,
    generated_at: str | None = None,
    inpatient_calendar: list[dict[str, Any]] | None = None,
    outpatient_calendar: list[dict[str, Any]] | None = None,
    legend: dict[str, Any] | None = None,
    conflicts: list[dict[str, Any]] | None = None,
    source_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    block = active_block(state) or {}
    dates = date_range(block.get("startDate"), block.get("endDate")) if block.get("startDate") and block.get("endDate") else []
    inpatient_calendar = inpatient_calendar if inpatient_calendar is not None else build_inpatient_calendar(state, block)
    outpatient_calendar = outpatient_calendar if outpatient_calendar is not None else build_outpatient_calendar(state, block)
    legend = legend if legend is not None else build_legend(state, block)
    conflicts = conflicts if conflicts is not None else detect_conflicts(state)
    source_summary = source_summary if source_summary is not None else build_source_summary(state)
    return {
        "exportVersion": 2,
        "generatedAt": generated_at or _js_iso_now(),
        "block": block.get("name") or "",
        "blockId": block.get("id") or "",
        "dateRange": {"startDate": block.get("startDate") or "", "endDate": block.get("endDate") or ""},
        "files": [
            _file_entry("manifest.json", "manifest", "Export manifest", 1),
            _file_entry("roster.json", "roster", "Provider roster", len(state.get("rotators") or [])),
            _file_entry("roster.csv", "rosterCsv", "Provider roster CSV", len(state.get("rotators") or []), "csv"),
            _file_entry("inpatient-calendar.json", "inpatientCalendar", "Inpatient calendar", len(inpatient_calendar)),
            _file_entry("inpatient-calendar.csv", "inpatientCalendarCsv", "Inpatient calendar CSV", len(_inpatient_csv_rows(inpatient_calendar)), "csv"),
            _file_entry("outpatient-calendar.json", "outpatientCalendar", "Outpatient calendar", len(outpatient_calendar)),
            _file_entry("outpatient-calendar.csv", "outpatientCalendarCsv", "Outpatient calendar CSV", len(_outpatient_csv_rows(outpatient_calendar)), "csv"),
            _file_entry("daily-reports.txt", "dailyReports", "Daily reports", len(dates), "text"),
            _file_entry("legend.json", "legend", "Rotator legend", len(legend.get("entries") or [])),
            _file_entry("legend.csv", "legendCsv", "Rotator legend CSV", len(legend.get("entries") or []), "csv"),
            _file_entry("conflicts.json", "conflicts", "Conflict summary", len(conflicts)),
            _file_entry("conflicts.csv", "conflictsCsv", "Conflict summary CSV", len(conflicts), "csv"),
            _file_entry(
                "source-import-summary.json",
                "sourceSummary",
                "Source import summary",
                len(source_summary.get("sources") or []) + len(source_summary.get("expectedPrograms") or []),
            ),
            _file_entry(
                "source-import-summary.csv",
                "sourceSummaryCsv",
                "Source import summary CSV",
                len(source_summary.get("sources") or []) + len(source_summary.get("expectedPrograms") or []),
                "csv",
            ),
            _file_entry("schedule-package.json", "schedulePackage", "Full scheduler state", 1),
        ],
    }


def build_export_package(state: dict[str, Any]) -> dict[str, Any]:
    block = active_block(state) or {}
    dates = date_range(block.get("startDate"), block.get("endDate")) if block.get("startDate") and block.get("endDate") else []
    reports = "\n\n---\n\n".join(generate_daily_report(state, date) for date in dates)
    conflicts = detect_conflicts(state)
    inpatient_calendar = build_inpatient_calendar(state, block)
    outpatient_calendar = build_outpatient_calendar(state, block)
    legend = build_legend(state, block)
    source_summary = build_source_summary(state)
    generated_at = _js_iso_now()
    manifest = generate_export_manifest(
        state,
        generated_at=generated_at,
        inpatient_calendar=inpatient_calendar,
        outpatient_calendar=outpatient_calendar,
        legend=legend,
        conflicts=conflicts,
        source_summary=source_summary,
    )
    return {
        "manifest": manifest,
        "roster": state.get("rotators") or [],
        "rosterCsv": build_roster_csv(state),
        "inpatientCalendar": inpatient_calendar,
        "inpatientCalendarCsv": build_inpatient_calendar_csv(inpatient_calendar),
        "outpatientCalendar": outpatient_calendar,
        "outpatientCalendarCsv": build_outpatient_calendar_csv(outpatient_calendar),
        "dailyReports": reports,
        "legend": legend,
        "legendCsv": build_legend_csv(legend),
        "conflicts": conflicts,
        "conflictsCsv": build_conflicts_csv(conflicts),
        "sourceSummary": source_summary,
        "sourceSummaryCsv": build_source_summary_csv(source_summary),
        "schedulePackage": state,
    }
