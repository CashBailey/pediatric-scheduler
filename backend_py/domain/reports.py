"""Report helpers ported from shared/scheduler/scheduler.js."""

from __future__ import annotations

from typing import Any

from backend_py.domain.calendar_utils import date_range, weekday_name
from backend_py.domain.clinics import clinic_assignment_rows, detect_clinic_assignment_conflicts
from backend_py.domain.draft import (
    continuity_periods_needing_whole_day_warning,
    continuity_periods_for_weekday,
    coverage_for_date,
    is_rotator_active_on,
    is_rotator_unavailable,
)


def active_block(state: dict[str, Any]) -> dict[str, Any] | None:
    blocks = state.get("serviceBlocks") or []
    active_id = state.get("activeBlockId")
    return next((block for block in blocks if block.get("id") == active_id), None) or (blocks[0] if blocks else None)


def get_rotator(state: dict[str, Any], rotator_id: str | None) -> dict[str, Any] | None:
    return next((rotator for rotator in state.get("rotators", []) if rotator.get("id") == rotator_id), None)


def _rotator_display(state: dict[str, Any], rotator_id: str | None) -> str:
    rotator = get_rotator(state, rotator_id)
    return (rotator or {}).get("displayName") or "[Removed]"


def _rotator_ids_in_legend(state: dict[str, Any], block: dict[str, Any]) -> set[str]:
    if not block.get("startDate") or not block.get("endDate"):
        return set()
    dates = date_range(block["startDate"], block["endDate"])
    return {
        rotator.get("id")
        for rotator in state.get("rotators", [])
        if rotator.get("id") and any(is_rotator_active_on(rotator, date) for date in dates)
    }


def _scheduled_rotator_ids_in_block(state: dict[str, Any], block: dict[str, Any]) -> set[str]:
    if not block.get("startDate") or not block.get("endDate"):
        return set()
    start = block["startDate"]
    end = block["endDate"]
    referenced: set[str] = set()
    for item in [*state.get("inpatientAssignments", []), *state.get("outpatientSessions", [])]:
        date = item.get("date")
        rotator_id = item.get("rotatorId")
        if date and rotator_id and start <= date <= end:
            referenced.add(rotator_id)
    return referenced


def detect_conflicts(state: dict[str, Any]) -> list[dict[str, Any]]:
    conflicts: list[dict[str, Any]] = []
    block = active_block(state) or {}
    inpatient_by_date_rotator = {
        f"{item.get('date')}:{item.get('rotatorId')}"
        for item in state.get("inpatientAssignments", [])
    }

    for outpatient in state.get("outpatientSessions", []):
        if f"{outpatient.get('date')}:{outpatient.get('rotatorId')}" in inpatient_by_date_rotator:
            rotator = get_rotator(state, outpatient.get("rotatorId"))
            conflicts.append(
                {
                    "id": f"conflict-double-{outpatient.get('date')}-{outpatient.get('rotatorId')}",
                    "severity": "Critical",
                    "type": "double-booked",
                    "date": outpatient.get("date"),
                    "title": f"{(rotator or {}).get('displayName') or 'Rotator'} is double-booked",
                    "detail": "Assigned to inpatient coverage and outpatient clinic on the same day.",
                    "status": "Open",
                    "rotatorId": outpatient.get("rotatorId"),
                    "period": outpatient.get("period"),
                    "assignment": "outpatient",
                }
            )

    for item in state.get("inpatientAssignments", []):
        rotator = get_rotator(state, item.get("rotatorId"))
        status = is_rotator_unavailable(rotator, item.get("date"))
        if not status:
            continue
        reason_text = f"their day off ({status.get('label')})" if status.get("reason") == "day-off" else f"time off ({status.get('label')})"
        conflicts.append(
            {
                "id": f"conflict-unavailable-{item.get('date')}-{item.get('rotatorId')}-inpatient",
                "severity": "Critical",
                "type": "rotator-unavailable",
                "date": item.get("date"),
                "title": f"{(rotator or {}).get('displayName') or 'Rotator'} is scheduled on {reason_text}",
                "detail": "Inpatient assignment falls on a day the rotator is marked unavailable.",
                "status": "Open",
                "rotatorId": item.get("rotatorId"),
                "assignment": "inpatient",
            }
        )

    for item in state.get("outpatientSessions", []):
        rotator = get_rotator(state, item.get("rotatorId"))
        status = is_rotator_unavailable(rotator, item.get("date"))
        if not status:
            continue
        reason_text = f"their day off ({status.get('label')})" if status.get("reason") == "day-off" else f"time off ({status.get('label')})"
        conflicts.append(
            {
                "id": f"conflict-unavailable-{item.get('date')}-{item.get('rotatorId')}-outpatient-{item.get('period')}",
                "severity": "Critical",
                "type": "rotator-unavailable",
                "date": item.get("date"),
                "title": f"{(rotator or {}).get('displayName') or 'Rotator'} is scheduled on {reason_text}",
                "detail": f"{item.get('period')} {item.get('clinic')} session falls on a day the rotator is marked unavailable.",
                "status": "Open",
                "rotatorId": item.get("rotatorId"),
                "period": item.get("period"),
                "assignment": "outpatient",
            }
        )

    for holiday in block.get("holidays") or []:
        if not isinstance(holiday, dict) or not holiday.get("noClinic"):
            continue
        clinic = next((item for item in state.get("outpatientSessions", []) if item.get("date") == holiday.get("date")), None)
        if clinic:
            conflicts.append(
                {
                    "id": f"conflict-holiday-{holiday.get('date')}",
                    "severity": "Warning",
                    "type": "holiday-clinic",
                    "date": holiday.get("date"),
                    "title": f"Clinic scheduled on {holiday.get('label')}",
                    "detail": "Holiday is marked no-clinic, but an outpatient session exists.",
                    "status": "Open",
                    "rotatorId": clinic.get("rotatorId"),
                    "period": clinic.get("period"),
                    "assignment": "outpatient",
                }
            )

    for item in state.get("outpatientSessions", []):
        wd = weekday_name(item.get("date"))
        if wd not in {"Saturday", "Sunday"}:
            continue
        rotator = get_rotator(state, item.get("rotatorId"))
        conflicts.append(
            {
                "id": f"conflict-weekend-op-{item.get('date')}-{item.get('rotatorId')}-{item.get('period')}",
                "severity": "Warning",
                "type": "outpatient-weekend",
                "date": item.get("date"),
                "title": f"{(rotator or {}).get('displayName') or 'Rotator'} has a weekend clinic",
                "detail": f"{item.get('period')} {item.get('clinic') or 'outpatient'} session is on {wd}; outpatient clinics are closed on weekends.",
                "status": "Open",
                "rotatorId": item.get("rotatorId"),
                "period": item.get("period"),
                "assignment": "outpatient",
            }
        )

    if state.get("rotators"):
        ip_head_by_date: dict[str, set[str]] = {}
        for item in state.get("inpatientAssignments", []):
            if item.get("role") == "Off":
                continue
            ip_head_by_date.setdefault(item.get("date"), set()).add(item.get("rotatorId"))
        if block.get("startDate") and block.get("endDate"):
            for date in date_range(block["startDate"], block["endDate"]):
                required = coverage_for_date(block, date)["count"]
                if required <= 0:
                    continue
                actual = len(ip_head_by_date.get(date, set()))
                if actual >= required:
                    continue
                if actual == 0:
                    conflicts.append(
                        {
                            "id": f"conflict-missing-coverage-{date}",
                            "severity": "Critical",
                            "type": "missing-coverage",
                            "date": date,
                            "title": f"No inpatient coverage on {date}",
                            "detail": "No one is assigned to inpatient for this day in the block.",
                            "status": "Open",
                            "assignment": "inpatient",
                        }
                    )
                else:
                    conflicts.append(
                        {
                            "id": f"conflict-understaffed-{date}",
                            "severity": "Warning",
                            "type": "understaffed",
                            "date": date,
                            "title": f"Understaffed inpatient on {date}",
                            "detail": f"{actual} of {required} required inpatient {'body' if required == 1 else 'bodies'} assigned for this day.",
                            "status": "Open",
                            "assignment": "inpatient",
                        }
                    )

    legend_rotator_ids = _rotator_ids_in_legend(state, block)
    for rotator_id in _scheduled_rotator_ids_in_block(state, block):
        if rotator_id in legend_rotator_ids:
            continue
        rotator = get_rotator(state, rotator_id)
        label = (rotator or {}).get("displayName") or "Rotator"
        conflicts.append(
            {
                "id": f"conflict-missing-legend-{rotator_id}",
                "severity": "Critical",
                "type": "missing-legend",
                "date": block.get("startDate"),
                "title": f"{label} is on the schedule but not in the legend",
                "detail": "The numbered legend for this block has no entry for this rotator.",
                "status": "Open",
                "rotatorId": rotator_id,
            }
        )

    for item in state.get("inpatientAssignments", []):
        rotator = get_rotator(state, item.get("rotatorId"))
        if not continuity_periods_needing_whole_day_warning(state, rotator, item.get("date")):
            continue
        conflicts.append(
            {
                "id": f"conflict-continuity-{item.get('date')}-{item.get('rotatorId')}",
                "severity": "Warning",
                "type": "continuity-clinic-conflict",
                "date": item.get("date"),
                "title": f"{(rotator or {}).get('displayName') or 'Rotator'} has continuity clinic on this day",
                "detail": f"Inpatient assignment falls on {(rotator or {}).get('continuityClinic')}; add a clinic pull-out note if this is intended.",
                "status": "Open",
                "rotatorId": item.get("rotatorId"),
                "assignment": "inpatient",
            }
        )

    for session in state.get("outpatientSessions", []):
        rotator = get_rotator(state, session.get("rotatorId"))
        periods = continuity_periods_for_weekday(
            (rotator or {}).get("continuityClinic"),
            weekday_name(session.get("date")),
        )
        if session.get("period") not in periods:
            continue
        if "continuity" in str(session.get("clinic") or "").lower():
            continue
        conflicts.append(
            {
                "id": f"conflict-continuity-out-{session.get('date')}-{session.get('rotatorId')}-{session.get('period')}",
                "severity": "Warning",
                "type": "continuity-clinic-conflict",
                "date": session.get("date"),
                "title": f"{(rotator or {}).get('displayName') or 'Rotator'} has continuity clinic this period",
                "detail": f"{session.get('period')} {session.get('clinic') or 'session'} on {session.get('date')} overlaps the rotator's continuity clinic ({(rotator or {}).get('continuityClinic')}).",
                "status": "Open",
                "rotatorId": session.get("rotatorId"),
                "period": session.get("period"),
                "assignment": "outpatient",
            }
        )

    for clinic_conflict in detect_clinic_assignment_conflicts(state, block):
        conflict = _clinic_conflict_summary(state, clinic_conflict)
        if conflict:
            conflicts.append(conflict)

    return conflicts


def generate_daily_report(state: dict[str, Any], date: str) -> str:
    block = active_block(state) or {}
    inpatient = [
        f"{item.get('role')}: {_rotator_display(state, item.get('rotatorId'))}"
        for item in state.get("inpatientAssignments", [])
        if item.get("date") == date
    ]
    outpatient = [
        f"{item.get('period')} {item.get('clinic')}: {_rotator_display(state, item.get('rotatorId'))}"
        for item in state.get("outpatientSessions", [])
        if item.get("date") == date
    ]
    clinics = [
        _clinic_report_line(row)
        for row in clinic_assignment_rows(state, block)
        if row.get("date") == date
    ]
    day_conflicts = [item for item in detect_conflicts(state) if item.get("date") == date]
    return "\n".join(
        [
            "Daily Team Report",
            block.get("name") or "",
            date,
            "",
            "Inpatient",
            "\n".join(inpatient) if inpatient else "No inpatient assignments.",
            "",
            "Outpatient",
            "\n".join(outpatient) if outpatient else "No outpatient sessions.",
            "",
            "Clinic Assignments",
            "\n".join(clinics) if clinics else "No clinic assignments.",
            "",
            "Conflicts",
            "\n".join(item.get("title") or "" for item in day_conflicts) if day_conflicts else "No conflicts for this date.",
        ]
    )


def _clinic_report_line(row: dict[str, Any]) -> str:
    destination = row.get("clinicName") or "Clinic"
    attending = row.get("attendingName")
    if attending:
        destination = f"{destination} with {attending}"
    if row.get("stale"):
        destination = "Removed clinic"
    return f"{row.get('session')} {destination}: {row.get('rotatorName')}"


def _clinic_conflict_summary(state: dict[str, Any], conflict: dict[str, Any]) -> dict[str, Any] | None:
    type_ = conflict.get("type")
    date = conflict.get("date")
    session = conflict.get("session")
    if type_ == "clinic-double-book":
        rotator = get_rotator(state, conflict.get("rotatorId"))
        label = (rotator or {}).get("displayName") or (rotator or {}).get("fullName") or "Rotator"
        return {
            "id": f"conflict-clinic-double-{date}-{session}-{conflict.get('rotatorId')}",
            "severity": conflict.get("severity") or "Critical",
            "type": type_,
            "date": date,
            "title": f"{label} is double-booked in clinic",
            "detail": f"Assigned to multiple clinic occurrences in the {session} session.",
            "status": "Open",
            "rotatorId": conflict.get("rotatorId"),
            "period": session,
            "assignment": "clinic",
        }
    if type_ == "clinic-over-capacity":
        return {
            "id": f"conflict-clinic-capacity-{conflict.get('clinicOccurrenceId')}",
            "severity": conflict.get("severity") or "Warning",
            "type": type_,
            "date": date,
            "title": f"Clinic over capacity on {date}",
            "detail": f"{conflict.get('assigned')} assigned for capacity {conflict.get('capacity')} in the {session} session.",
            "status": "Open",
            "period": session,
            "assignment": "clinic",
        }
    if type_ == "clinic-role-mismatch":
        rotator = get_rotator(state, conflict.get("rotatorId"))
        label = (rotator or {}).get("displayName") or (rotator or {}).get("fullName") or "Rotator"
        allowed_roles = conflict.get("allowedRoles") if isinstance(conflict.get("allowedRoles"), list) else []
        allowed = ", ".join(str(role) for role in allowed_roles) if allowed_roles else "configured roles"
        return {
            "id": f"conflict-clinic-role-{date}-{session}-{conflict.get('rotatorId')}",
            "severity": conflict.get("severity") or "Warning",
            "type": type_,
            "date": date,
            "title": f"{label} does not match clinic role policy",
            "detail": f"Assigned role {conflict.get('actualRole') or 'unknown'} is not in allowed roles: {allowed}.",
            "status": "Open",
            "rotatorId": conflict.get("rotatorId"),
            "period": session,
            "assignment": "clinic",
        }
    if type_ == "clinic-stale-occurrence":
        rotator = get_rotator(state, conflict.get("rotatorId"))
        label = (rotator or {}).get("displayName") or (rotator or {}).get("fullName") or "Rotator"
        return {
            "id": f"conflict-clinic-stale-{date}-{session}-{conflict.get('rotatorId')}",
            "severity": conflict.get("severity") or "Warning",
            "type": type_,
            "date": date,
            "title": f"{label} has a removed clinic assignment",
            "detail": "Clinic assignment references an attending clinic occurrence that no longer exists.",
            "status": "Open",
            "rotatorId": conflict.get("rotatorId"),
            "period": session,
            "assignment": "clinic",
        }
    return None
