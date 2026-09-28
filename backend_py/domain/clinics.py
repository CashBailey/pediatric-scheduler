"""Clinic-stage occurrence selectors and assignment mutators.

Python port of shared/scheduler/clinic-selectors.js and the writer portion of
clinic-validation.js. Attending clinic occurrences are generated from
configuration; only rotator placements into those occurrences are persisted in
state.clinicAssignments.
"""

from __future__ import annotations

import re
from typing import Any

from backend_py.domain.calendar_utils import date_range, week_buckets, weekday_name
from backend_py.domain.draft import (
    METHODIST_OP_CLINIC,
    OP_PLACEHOLDER_CLINIC,
    is_rotator_active_on,
    is_rotator_unavailable,
)

PERIODS = {"AM", "PM"}
CLINIC_ROLE_ORDER = ["Resident", "Fellow", "Student"]
CLINIC_ROLE_SET = set(CLINIC_ROLE_ORDER)

REASON_TEXT = {
    "occurrence-missing": "That clinic session no longer exists.",
    "date-session-mismatch": "Clinic session date/period doesn't match.",
    "not-outpatient": "Rotator isn't on outpatient service that day.",
    "already-in-session": "Rotator already has a clinic in that AM/PM session.",
    "over-capacity": "That clinic session is already full.",
    "role-not-allowed": "Rotator role is not allowed for that clinic.",
}


def slug(value: Any) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower())
    out = re.sub(r"^-+|-+$", "", out)
    return out or "x"


def normalize_allowed_clinic_roles(raw: Any) -> list[str]:
    if isinstance(raw, list):
        values = raw
    elif isinstance(raw, str):
        values = re.split(r"\s*,\s*", raw)
    else:
        values = []
    seen = {
        str(value).strip()
        for value in values
        if str(value).strip() in CLINIC_ROLE_SET
    }
    return [role for role in CLINIC_ROLE_ORDER if role in seen]


def expand_clinic_occurrences(state: dict[str, Any] | None, range_: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    if not state or not range_ or not range_.get("startDate") or not range_.get("endDate"):
        return []

    start_date = str(range_["startDate"])
    end_date = str(range_["endDate"])
    dates = date_range(start_date, end_date)
    if not dates:
        return []

    dates_by_weekday: dict[str, list[str]] = {}
    for date in dates:
        dates_by_weekday.setdefault(weekday_name(date), []).append(date)

    by_id: dict[str, dict[str, Any]] = {}

    def in_range(date: str) -> bool:
        return start_date <= date <= end_date

    def add(occurrence: dict[str, Any]) -> None:
        if occurrence["id"] not in by_id:
            by_id[occurrence["id"]] = occurrence

    for attending in state.get("attendings") or []:
        if not isinstance(attending, dict):
            continue
        name = attending.get("name") or ""
        recurring = attending.get("recurringClinics") if isinstance(attending.get("recurringClinics"), list) else []
        for index, slot in enumerate(recurring):
            if not isinstance(slot, dict) or slot.get("active") is False:
                continue
            session = slot.get("session") or slot.get("period")
            weekday = slot.get("weekday")
            if not weekday or not session:
                continue
            clinic_name = slot.get("clinicName") or ""
            template_id = slot.get("id") or f"{index}-{slug(weekday)}-{session}-{slug(clinic_name or 'clinic')}"
            for date in dates_by_weekday.get(str(weekday), []):
                add(
                    {
                        "id": _occurrence_id(name, template_id, date, session),
                        "date": date,
                        "session": session,
                        "attendingName": name,
                        "clinicName": clinic_name,
                        "location": slot.get("location") or "",
                        "capacity": _normalize_capacity(slot.get("capacity")),
                        "allowedRoles": normalize_allowed_clinic_roles(slot.get("allowedRoles")),
                        "source": "recurring",
                        "templateId": template_id,
                    }
                )

        one_offs = attending.get("oneOffDates") if isinstance(attending.get("oneOffDates"), list) else []
        for index, slot in enumerate(one_offs):
            if not isinstance(slot, dict):
                continue
            date = slot.get("date")
            session = slot.get("session") or slot.get("period")
            if not date or not session or not in_range(str(date)):
                continue
            clinic_name = slot.get("clinicName") or ""
            template_id = slot.get("id") or f"oneoff-{index}-{session}-{slug(clinic_name or 'clinic')}"
            add(
                {
                    "id": _occurrence_id(name, template_id, str(date), session),
                    "date": str(date),
                    "session": session,
                    "attendingName": name,
                    "clinicName": clinic_name,
                    "location": slot.get("location") or "",
                    "capacity": _normalize_capacity(slot.get("capacity")),
                    "allowedRoles": normalize_allowed_clinic_roles(slot.get("allowedRoles")),
                    "source": "one-off",
                    "templateId": template_id,
                }
            )

    for session_rec in state.get("outpatientSessions") or []:
        if not isinstance(session_rec, dict):
            continue
        date = session_rec.get("date")
        period = session_rec.get("period")
        clinic = session_rec.get("clinic")
        if not date or not period or not in_range(str(date)) or not _is_real_clinic_name(clinic):
            continue
        provider = session_rec.get("provider") or ""
        template_id = f"legacy-{slug(clinic)}-{slug(provider)}"
        add(
            {
                "id": _occurrence_id(provider, template_id, str(date), period),
                "date": str(date),
                "session": period,
                "attendingName": provider,
                "clinicName": clinic,
                "location": "",
                "capacity": None,
                "allowedRoles": [],
                "source": "legacy",
                "templateId": template_id,
            }
        )

    return list(by_id.values())


def get_clinic_assignments(state: dict[str, Any] | None, range_: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    if not state:
        return []
    start_date = range_.get("startDate") if range_ else None
    end_date = range_.get("endDate") if range_ else None

    def in_range(date: Any) -> bool:
        if not date:
            return False
        value = str(date)
        return (not start_date or value >= start_date) and (not end_date or value <= end_date)

    persisted = state.get("clinicAssignments") if isinstance(state.get("clinicAssignments"), list) else []
    out = [item for item in persisted if isinstance(item, dict) and in_range(item.get("date"))]
    seen = {f"{item.get('clinicOccurrenceId')}|{item.get('rotatorId')}" for item in out}

    for session_rec in state.get("outpatientSessions") or []:
        if not isinstance(session_rec, dict) or not in_range(session_rec.get("date")):
            continue
        if not _is_real_clinic_name(session_rec.get("clinic")):
            continue
        if not session_rec.get("rotatorId") or not session_rec.get("period"):
            continue
        provider = session_rec.get("provider") or ""
        template_id = f"legacy-{slug(session_rec.get('clinic'))}-{slug(provider)}"
        occ_id = _occurrence_id(provider, template_id, session_rec.get("date"), session_rec.get("period"))
        key = f"{occ_id}|{session_rec.get('rotatorId')}"
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "id": f"legacy-clinic-{slug(session_rec.get('id') or key)}",
                "clinicOccurrenceId": occ_id,
                "rotatorId": session_rec.get("rotatorId"),
                "date": session_rec.get("date"),
                "session": session_rec.get("period"),
                "source": "legacy",
            }
        )
    return out


def clinic_assignment_rows(state: dict[str, Any] | None, block: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not state or not block or not block.get("startDate") or not block.get("endDate"):
        return []
    range_ = {"startDate": block["startDate"], "endDate": block["endDate"]}
    occurrences = expand_clinic_occurrences(state, range_)
    occ_by_id = {item.get("id"): item for item in occurrences}
    rows = []
    for assignment in get_clinic_assignments(state, range_):
        occurrence = occ_by_id.get(assignment.get("clinicOccurrenceId"))
        rows.append(
            {
                "id": assignment.get("id"),
                "clinicOccurrenceId": assignment.get("clinicOccurrenceId"),
                "rotatorId": assignment.get("rotatorId"),
                "rotatorName": _rotator_label(state, assignment.get("rotatorId")),
                "date": assignment.get("date"),
                "session": assignment.get("session"),
                "clinicName": (occurrence or {}).get("clinicName") or "",
                "attendingName": (occurrence or {}).get("attendingName") or "",
                "location": (occurrence or {}).get("location") or "",
                "source": assignment.get("source"),
                "stale": occurrence is None,
            }
        )
    return sorted(
        rows,
        key=lambda row: (
            str(row.get("date") or ""),
            str(row.get("session") or ""),
            str(row.get("attendingName") or "").lower(),
            str(row.get("clinicName") or "").lower(),
            str(row.get("rotatorName") or "").lower(),
        ),
    )


def build_week_grid(state: dict[str, Any] | None, block: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Weekly Mon-Fri AM/PM card model for exports.

    Mirrors the card shape of shared/scheduler/poster-weeks.js
    buildPosterWeeks: one Monday-anchored week per entry, each day carrying AM
    and PM card lists (clinicName, attendingName, location, rotatorNames).
    Holiday/no-clinic dates stay in the grid with a `holiday` label so
    renderers can draw dark cells instead of dropping the day.
    """
    if not state or not block or not block.get("startDate") or not block.get("endDate"):
        return []
    no_clinic_labels = {
        h.get("date"): (h.get("label") or "Holiday")
        for h in block.get("holidays") or []
        if isinstance(h, dict) and h.get("noClinic") and h.get("date")
    }
    grid_dates = [
        date
        for date in date_range(block["startDate"], block["endDate"])
        if weekday_name(date) not in {"Saturday", "Sunday"}
    ]
    rows = clinic_assignment_rows(state, block)
    names_by_occurrence: dict[str, list[str]] = {}
    for row in rows:
        if row.get("stale"):
            continue
        names_by_occurrence.setdefault(str(row.get("clinicOccurrenceId")), []).append(
            str(row.get("rotatorName") or "")
        )
    range_ = {"startDate": block["startDate"], "endDate": block["endDate"]}
    occurrences = [
        occ
        for occ in expand_clinic_occurrences(state, range_)
        if weekday_name(occ.get("date") or "") not in {"Saturday", "Sunday"}
        and occ.get("date") not in no_clinic_labels
    ]
    cards_by_date_session: dict[str, list[dict[str, Any]]] = {}
    for occ in occurrences:
        key = f"{occ.get('date')}|{occ.get('session')}"
        cards_by_date_session.setdefault(key, []).append(
            {
                "clinicName": occ.get("clinicName") or "",
                "attendingName": occ.get("attendingName") or "",
                "location": occ.get("location") or "",
                "rotatorNames": sorted(names_by_occurrence.get(str(occ.get("id")), [])),
            }
        )
    for cards in cards_by_date_session.values():
        cards.sort(key=lambda card: (card["attendingName"].lower(), card["clinicName"].lower()))
    weeks = []
    for index, dates in enumerate(week_buckets(grid_dates)):
        days = [
            {
                "date": date,
                "weekday": weekday_name(date),
                "holiday": no_clinic_labels.get(date),
                "AM": cards_by_date_session.get(f"{date}|AM", []),
                "PM": cards_by_date_session.get(f"{date}|PM", []),
            }
            for date in dates
        ]
        weeks.append(
            {
                "weekIndex": index + 1,
                "label": f"Week {index + 1}",
                "startDate": dates[0],
                "endDate": dates[-1],
                "days": days,
            }
        )
    return weeks


def week_grid_card_text(card: dict[str, Any]) -> str:
    """One-line card label shared by the Word and PDF week-grid exports:
    "Clinic (Attending) at Location: rotator, rotator"."""
    clinic = card.get("clinicName") or "Clinic"
    attending = card.get("attendingName") or ""
    # Legacy occurrences often carry the attending's name as the clinic name;
    # "Elm (Elm)" reads worse than "Elm".
    title = f"{clinic} ({attending})" if attending and attending != clinic else clinic
    if card.get("location"):
        title += f" at {card['location']}"
    names = ", ".join(card.get("rotatorNames") or [])
    return f"{title}: {names}" if names else title


def detect_clinic_assignment_conflicts(state: dict[str, Any] | None, block: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not state or not block or not block.get("startDate") or not block.get("endDate"):
        return []
    range_ = {"startDate": block["startDate"], "endDate": block["endDate"]}
    occurrences = expand_clinic_occurrences(state, range_)
    occ_by_id = {item.get("id"): item for item in occurrences}
    assignments = get_clinic_assignments(state, range_)
    conflicts: list[dict[str, Any]] = []

    by_session_rotator: dict[str, list[dict[str, Any]]] = {}
    for assignment in assignments:
        key = f"{assignment.get('date')}|{assignment.get('session')}|{assignment.get('rotatorId')}"
        by_session_rotator.setdefault(key, []).append(assignment)
    for key, items in by_session_rotator.items():
        if len(items) <= 1:
            continue
        date, session, rotator_id = key.split("|", 2)
        conflicts.append(
            {
                "type": "clinic-double-book",
                "severity": "Critical",
                "date": date,
                "session": session,
                "rotatorId": rotator_id,
                "occurrenceIds": [item.get("clinicOccurrenceId") for item in items],
            }
        )

    by_occurrence: dict[str, int] = {}
    for assignment in assignments:
        occ_id = assignment.get("clinicOccurrenceId")
        if occ_id not in occ_by_id:
            conflicts.append(
                {
                    "type": "clinic-stale-occurrence",
                    "severity": "Warning",
                    "date": assignment.get("date"),
                    "session": assignment.get("session"),
                    "rotatorId": assignment.get("rotatorId"),
                    "clinicOccurrenceId": occ_id,
                }
            )
            continue
        by_occurrence[occ_id] = by_occurrence.get(occ_id, 0) + 1
        rotator = _get_rotator(state, assignment.get("rotatorId"))
        allowed_roles = normalize_allowed_clinic_roles((occ_by_id.get(occ_id) or {}).get("allowedRoles"))
        if allowed_roles and not _role_allowed_for_clinic(occ_by_id.get(occ_id), rotator):
            conflicts.append(
                {
                    "type": "clinic-role-mismatch",
                    "severity": "Warning",
                    "date": assignment.get("date"),
                    "session": assignment.get("session"),
                    "rotatorId": assignment.get("rotatorId"),
                    "clinicOccurrenceId": occ_id,
                    "actualRole": (rotator or {}).get("role") or "",
                    "allowedRoles": allowed_roles,
                }
            )
    for occ_id, count in by_occurrence.items():
        occ = occ_by_id.get(occ_id) or {}
        capacity = occ.get("capacity")
        if capacity is not None and count > capacity:
            conflicts.append(
                {
                    "type": "clinic-over-capacity",
                    "severity": "Warning",
                    "date": occ.get("date"),
                    "session": occ.get("session"),
                    "clinicOccurrenceId": occ_id,
                    "capacity": capacity,
                    "assigned": count,
                }
            )
    return conflicts


def eligible_outpatient_rotators_for_date(state: dict[str, Any] | None, date: str) -> list[dict[str, Any]]:
    if not state or not date:
        return []
    return [
        rotator for rotator in state.get("rotators") or []
        if isinstance(rotator, dict) and service_type_for_rotator_date(state, rotator.get("id"), date) == "outpatient"
    ]


def service_type_for_rotator_date(state: dict[str, Any], rotator_id: Any, date: str) -> str:
    rotator = next((r for r in state.get("rotators") or [] if isinstance(r, dict) and r.get("id") == rotator_id), None)
    if not rotator:
        return "absent"
    if not is_rotator_active_on(rotator, date):
        return "absent"

    ip_bucket = [
        item for item in state.get("inpatientAssignments") or []
        if isinstance(item, dict) and item.get("date") == date and item.get("rotatorId") == rotator_id
    ]
    op_bucket = [
        item for item in state.get("outpatientSessions") or []
        if isinstance(item, dict) and item.get("date") == date and item.get("rotatorId") == rotator_id
    ]
    real_ip = [item for item in ip_bucket if item.get("role") != "Off"]
    marked_off = any(item.get("role") == "Off" for item in ip_bucket)
    unavailable = is_rotator_unavailable(rotator, date)

    if unavailable and not real_ip and not op_bucket:
        return "off"
    if marked_off and not real_ip and not op_bucket:
        return "off"
    if real_ip and op_bucket:
        return "both"
    if real_ip:
        return "inpatient"
    if op_bucket:
        return "outpatient"
    return "unassigned"


def validate_clinic_assignment(state: dict[str, Any], input_: dict[str, Any]) -> dict[str, Any]:
    clinic_occurrence_id = input_.get("clinicOccurrenceId")
    rotator_id = input_.get("rotatorId")
    date = input_.get("date")
    session = input_.get("session")

    occurrence = _find_occurrence(state, clinic_occurrence_id, date)
    if not occurrence:
        return _invalid("occurrence-missing")
    if occurrence.get("date") != date or occurrence.get("session") != session:
        return _invalid("date-session-mismatch")
    if service_type_for_rotator_date(state, rotator_id, date) != "outpatient":
        return _invalid("not-outpatient")
    if not _role_allowed_for_clinic(occurrence, _get_rotator(state, rotator_id)):
        return _invalid("role-not-allowed")

    day_assignments = get_clinic_assignments(state, {"startDate": date, "endDate": date})
    already_here = any(
        item.get("clinicOccurrenceId") == clinic_occurrence_id and item.get("rotatorId") == rotator_id
        for item in day_assignments
    )
    if not already_here:
        same_session = any(
            item.get("rotatorId") == rotator_id and item.get("session") == session
            for item in day_assignments
        )
        if same_session:
            return _invalid("already-in-session")
        if occurrence.get("capacity") is not None:
            occupants = len([item for item in day_assignments if item.get("clinicOccurrenceId") == clinic_occurrence_id])
            if occupants >= occurrence.get("capacity"):
                return _invalid("over-capacity")
    return {"ok": True}


def assign_clinic(state: dict[str, Any], input_: dict[str, Any]) -> dict[str, Any]:
    verdict = validate_clinic_assignment(state, input_)
    if not verdict.get("ok"):
        return {**verdict, "state": state}

    clinic_occurrence_id = input_["clinicOccurrenceId"]
    rotator_id = input_["rotatorId"]
    existing = state.get("clinicAssignments") if isinstance(state.get("clinicAssignments"), list) else []
    filtered = [
        item for item in existing
        if not (
            isinstance(item, dict)
            and item.get("clinicOccurrenceId") == clinic_occurrence_id
            and item.get("rotatorId") == rotator_id
        )
    ]
    record = {
        "id": f"clinic-assign::{clinic_occurrence_id}::{rotator_id}",
        "clinicOccurrenceId": clinic_occurrence_id,
        "rotatorId": rotator_id,
        "date": input_["date"],
        "session": input_["session"],
        "source": input_.get("source") or "manual",
    }
    return {"ok": True, "state": {**state, "clinicAssignments": [*filtered, record]}, "assignment": record}


def unassign_clinic(state: dict[str, Any], input_: dict[str, Any]) -> dict[str, Any]:
    clinic_occurrence_id = input_.get("clinicOccurrenceId")
    rotator_id = input_.get("rotatorId")
    assignment_ref = input_.get("assignmentRef") or input_.get("assignmentId") or input_.get("id")
    existing = state.get("clinicAssignments") if isinstance(state.get("clinicAssignments"), list) else []

    if assignment_ref and (not clinic_occurrence_id or not rotator_id):
        match = next((item for item in existing if isinstance(item, dict) and item.get("id") == assignment_ref), None)
        if not match:
            return {"ok": False, "reason": "assignment-not-found", "message": f"clinic assignment not found: {assignment_ref}", "state": state}
        clinic_occurrence_id = match.get("clinicOccurrenceId")
        rotator_id = match.get("rotatorId")

    filtered = [
        item for item in existing
        if not (
            isinstance(item, dict)
            and item.get("clinicOccurrenceId") == clinic_occurrence_id
            and item.get("rotatorId") == rotator_id
        )
    ]
    if len(filtered) == len(existing):
        return {"ok": False, "reason": "assignment-not-found", "message": "clinic assignment not found", "state": state}
    return {"ok": True, "state": {**state, "clinicAssignments": filtered}}


def _normalize_capacity(raw: Any) -> int | None:
    if raw is None or raw == "":
        return None
    try:
        n = float(raw)
    except (TypeError, ValueError):
        return None
    if n < 0 or not n == n:
        return None
    return int(n)


def _get_rotator(state: dict[str, Any] | None, rotator_id: Any) -> dict[str, Any] | None:
    return next(
        (
            rotator for rotator in (state or {}).get("rotators", [])
            if isinstance(rotator, dict) and rotator.get("id") == rotator_id
        ),
        None,
    )


def _role_allowed_for_clinic(occurrence: dict[str, Any] | None, rotator: dict[str, Any] | None) -> bool:
    allowed_roles = normalize_allowed_clinic_roles((occurrence or {}).get("allowedRoles"))
    return not allowed_roles or (rotator or {}).get("role") in allowed_roles


def _occurrence_id(attending_name: Any, template_id: Any, date: Any, session: Any) -> str:
    return f"clinic-occurrence::{slug(attending_name)}::{template_id}::{date}::{session}"


def _is_real_clinic_name(clinic: Any) -> bool:
    name = str(clinic or "").strip()
    return bool(name) and name != OP_PLACEHOLDER_CLINIC and name != METHODIST_OP_CLINIC


def _rotator_label(state: dict[str, Any], rotator_id: Any) -> str:
    rotator = next(
        (item for item in state.get("rotators") or [] if isinstance(item, dict) and item.get("id") == rotator_id),
        None,
    )
    return (rotator or {}).get("displayName") or (rotator or {}).get("fullName") or rotator_id or "[Removed]"


def _find_occurrence(state: dict[str, Any], clinic_occurrence_id: Any, date: Any) -> dict[str, Any] | None:
    occurrences = expand_clinic_occurrences(state, {"startDate": date, "endDate": date})
    return next((item for item in occurrences if item.get("id") == clinic_occurrence_id), None)


def _invalid(reason: str) -> dict[str, Any]:
    return {"ok": False, "reason": reason, "message": REASON_TEXT[reason]}
