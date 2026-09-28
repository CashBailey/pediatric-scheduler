"""Assignment editing mutators ported from shared/scheduler/scheduler.js."""

from __future__ import annotations

from typing import Any

from backend_py.domain.calendar_utils import date_range, weekday_name
from backend_py.domain.draft import (
    OP_PLACEHOLDER_CLINIC,
    coverage_role_for_rotator,
    continuity_periods_for_weekday,
    is_rotator_active_on,
    is_rotator_unavailable,
)


def _compute_range_plan(state: dict[str, Any], block: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {
        "rotator": None,
        "applyDates": [],
        "skippedDates": [],
        "clampedStart": None,
        "clampedEnd": None,
        "wasClamped": False,
    }
    if not state or not block or not args:
        return result
    if not args.get("rotatorId") or not args.get("startDate") or not args.get("endDate"):
        return result
    if not block.get("startDate") or not block.get("endDate"):
        return result

    rotator = next((r for r in state.get("rotators", []) if r.get("id") == args["rotatorId"]), None)
    if not rotator:
        return result
    result["rotator"] = rotator

    clamped_start = block["startDate"] if args["startDate"] < block["startDate"] else args["startDate"]
    clamped_end = block["endDate"] if args["endDate"] > block["endDate"] else args["endDate"]
    if clamped_start > clamped_end:
        return result
    result["clampedStart"] = clamped_start
    result["clampedEnd"] = clamped_end
    result["wasClamped"] = clamped_start != args["startDate"] or clamped_end != args["endDate"]

    # Days that already carry an IP/OP record for this rotator stay paintable
    # even when the profile marks them unavailable — the grid renders the
    # existing record as a normal cell, and visible cells must be settable
    # (repainting is how a stale assignment on a now-unavailable day gets
    # corrected). Brand-new assignments on unavailable days are still skipped.
    assigned_dates = {
        item.get("date")
        for item in state.get("inpatientAssignments", [])
        if item.get("rotatorId") == args["rotatorId"]
    } | {
        item.get("date")
        for item in state.get("outpatientSessions", [])
        if item.get("rotatorId") == args["rotatorId"]
    }

    for date in date_range(clamped_start, clamped_end):
        if not is_rotator_active_on(rotator, date):
            result["skippedDates"].append(date)
            continue
        if is_rotator_unavailable(rotator, date) and date not in assigned_dates:
            result["skippedDates"].append(date)
            continue
        result["applyDates"].append(date)
    return result


def apply_range_assignment(state: dict[str, Any] | None, block: dict[str, Any] | None, args: dict[str, Any] | None) -> dict[str, Any] | None:
    if not state or not args:
        return state
    phase = args.get("phase")
    if phase not in {"inpatient", "outpatient", "clear", "off"}:
        return state

    plan = _compute_range_plan(state, block or {}, args)
    apply_dates = plan["applyDates"]
    if not apply_dates:
        return state

    apply_set = set(apply_dates)
    rotator_id = args["rotatorId"]
    rotator = next((r for r in state.get("rotators", []) if r.get("id") == rotator_id), None)
    role = args.get("role") or coverage_role_for_rotator(rotator)
    clinic = args.get("clinic") if args.get("clinic") is not None else OP_PLACEHOLDER_CLINIC

    next_ip = [
        item
        for item in state.get("inpatientAssignments", [])
        if not (item.get("rotatorId") == rotator_id and item.get("date") in apply_set)
    ]
    next_op = [
        item
        for item in state.get("outpatientSessions", [])
        if not (item.get("rotatorId") == rotator_id and item.get("date") in apply_set)
    ]

    if phase == "inpatient":
        for date in apply_dates:
            next_ip.append(
                {
                    "id": f"in-range-{date}-{rotator_id}-{role}".replace(" ", "-").lower(),
                    "date": date,
                    "rotatorId": rotator_id,
                    "role": role,
                    "source": "Range-Assigned",
                }
            )
    elif phase == "outpatient":
        next_op = state.get("outpatientSessions", [])
        no_clinic_holidays = {
            h.get("date")
            for h in (block or {}).get("holidays", [])
            if isinstance(h, dict) and h.get("noClinic")
        }
        existing_op_slots = {
            f"{item.get('date')}|{item.get('period')}"
            for item in next_op
            if item.get("rotatorId") == rotator_id
        }
        additions: list[dict[str, Any]] = []
        for date in apply_dates:
            weekday = weekday_name(date)
            if weekday in {"Saturday", "Sunday"}:
                continue
            if date in no_clinic_holidays:
                continue
            continuity_periods = continuity_periods_for_weekday((rotator or {}).get("continuityClinic"), weekday)
            for period in [p for p in ["AM", "PM"] if p not in continuity_periods]:
                key = f"{date}|{period}"
                if key in existing_op_slots:
                    continue
                existing_op_slots.add(key)
                additions.append(
                    {
                        "id": f"out-range-{date}-{period}-{rotator_id}".lower(),
                        "date": date,
                        "period": period,
                        "clinic": clinic,
                        "provider": "",
                        "rotatorId": rotator_id,
                        "status": "Scheduled",
                        "source": "Range-Assigned",
                    }
                )
        next_op = [*next_op, *additions]
    elif phase == "off":
        for date in apply_dates:
            next_ip.append(
                {
                    "id": f"off-{date}-{rotator_id}".replace(" ", "-").lower(),
                    "date": date,
                    "rotatorId": rotator_id,
                    "role": "Off",
                    "source": "Range-Assigned",
                }
            )

    return {**state, "inpatientAssignments": next_ip, "outpatientSessions": next_op}


def remove_inpatient_assignment(state: dict[str, Any], assignment_ref: str) -> dict[str, Any]:
    next_assignments = [
        item for item in state.get("inpatientAssignments", [])
        if item.get("id") != assignment_ref
    ]
    if len(next_assignments) == len(state.get("inpatientAssignments", [])):
        return state
    return {**state, "inpatientAssignments": next_assignments}


def remove_outpatient_session(state: dict[str, Any], session_ref: str) -> dict[str, Any]:
    next_sessions = [
        item for item in state.get("outpatientSessions", [])
        if item.get("id") != session_ref
    ]
    if len(next_sessions) == len(state.get("outpatientSessions", [])):
        return state
    return {**state, "outpatientSessions": next_sessions}


def _normalize_label(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).split()).strip()


def _first_label(*values: Any) -> str:
    for value in values:
        normalized = _normalize_label(value)
        if normalized:
            return normalized
    return ""


def normalize_outpatient_detail(detail: Any = None) -> dict[str, str]:
    input_ = detail if isinstance(detail, dict) else {}
    return {
        "clinic": _first_label(input_.get("clinic"), input_.get("clinicName")),
        "attending": _first_label(input_.get("attending"), input_.get("provider")),
        "task": _first_label(input_.get("task")),
        "notes": _first_label(input_.get("notes"), input_.get("note")),
    }


def normalize_outpatient_details(details: Any) -> list[dict[str, str]]:
    if not isinstance(details, list):
        return []
    normalized = [normalize_outpatient_detail(detail) for detail in details]
    return [
        detail
        for detail in normalized
        if detail["clinic"] or detail["attending"] or detail["task"] or detail["notes"]
    ]


def schedule_outpatient_session(state: dict[str, Any], input_: dict[str, Any]) -> dict[str, Any]:
    details = normalize_outpatient_details(input_.get("details"))
    next_session: dict[str, Any] = {
        "id": f"out-{input_['date']}-{input_['period']}-{input_['rotatorId']}".lower(),
        "date": input_["date"],
        "period": input_["period"],
        "clinic": input_.get("clinic") or "Continuity Clinic",
        "provider": input_.get("provider") or "",
        "rotatorId": input_["rotatorId"],
        "status": "Scheduled",
    }
    if details:
        next_session["details"] = details
    return {
        **state,
        "outpatientSessions": [
            item
            for item in state.get("outpatientSessions", [])
            if not (
                item.get("date") == input_["date"]
                and item.get("period") == input_["period"]
                and item.get("rotatorId") == input_["rotatorId"]
            )
        ]
        + [next_session],
    }
