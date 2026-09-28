"""Python port of the inpatient fair-fill draft engine.

This module ports shared/scheduler/scheduler.js::proposeSchedule and its
direct hard-rule helpers. It is intentionally pure: callers pass scheduler
state plus a service block and receive a new state/unmet pair.
"""

from __future__ import annotations

import math
import re
from copy import deepcopy
from typing import Any

from backend_py.domain.calendar_utils import add_days_to_iso, date_range, days_between, weekday_name

DEFAULT_COVERAGE_COUNT = {"weekday": 2, "saturday": 2, "sunday": 2, "holiday": 2}
METHODIST_ROTATION_LENGTH_DAYS = 28
METHODIST_OUTPATIENT_DAYS = 14
OP_PLACEHOLDER_CLINIC = "Outpatient (clinic TBD)"
METHODIST_OP_CLINIC = "Methodist Outpatient"
OUTPATIENT_TARGET_ROTATORS = 2
LENGTH_SPLIT_SCHOOL_TYPES = {"ut-peds", "ut-adult", "ut-psychiatry"}


def infer_school_type(program_name: str | None) -> str:
    return {
        "Methodist": "methodist",
        "UT Adult Neuro": "ut-adult",
        "UT Pediatrics": "ut-peds",
        "UT Pediatric Neurology Fellow": "ut-peds",
        "UT Med Student": "ut-student",
        "UT Psychiatry": "ut-psychiatry",
    }.get(program_name, "other")


def classify_rotator(rotator: dict[str, Any] | None) -> str:
    if not rotator:
        return "other"
    return rotator.get("schoolType") or infer_school_type(rotator.get("program"))


def get_rotator(state: dict[str, Any], rotator_id: str) -> dict[str, Any] | None:
    return next((r for r in state.get("rotators", []) if r.get("id") == rotator_id), None)


def is_rotator_active_on(rotator: dict[str, Any] | None, date_str: str | None) -> bool:
    if not rotator or not date_str:
        return False
    segments = rotator.get("segments") if isinstance(rotator.get("segments"), list) else []
    return any(
        seg and seg.get("start") and seg.get("end") and seg["start"] <= date_str <= seg["end"]
        for seg in segments
    )


def is_rotator_unavailable(rotator: dict[str, Any] | None, date_str: str) -> dict[str, str] | None:
    if not rotator:
        return None
    wd = weekday_name(date_str)
    day_off = rotator.get("dayOff") if isinstance(rotator.get("dayOff"), list) else []
    if wd in day_off:
        return {"reason": "day-off", "label": wd}
    ranges = rotator.get("unavailableRanges") if isinstance(rotator.get("unavailableRanges"), list) else []
    for range_ in ranges:
        if range_ and range_.get("start") and range_.get("end") and range_["start"] <= date_str <= range_["end"]:
            return {"reason": "range", "label": f"{range_['start']} to {range_['end']}"}
    return None


def parse_continuity_clinic(value: Any) -> dict[str, str] | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip().lower()
    if not cleaned:
        return None
    tokens = [token for token in re.split(r"[\s,/\-]+", cleaned) if token]
    weekday = None
    period = None
    weekday_names = [name.lower() for name in ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]]
    for token in tokens:
        if weekday is None:
            match = next((name for name in weekday_names if name == token or (len(token) >= 3 and name.startswith(token))), None)
            if match:
                weekday = match[:1].upper() + match[1:]
                continue
        if period is None:
            if token in {"am", "a.m.", "morning"}:
                period = "AM"
            elif token in {"pm", "p.m.", "afternoon"}:
                period = "PM"
    if not weekday or not period:
        return None
    return {"weekday": weekday, "period": period}


def parse_continuity_clinic_slots(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, str):
        return []
    chunks = [chunk.strip() for chunk in re.split(r"\s*,\s*|\s+and\s+", value, flags=re.IGNORECASE) if chunk.strip()]
    slots: list[dict[str, str]] = []
    seen: set[str] = set()
    for chunk in chunks:
        parsed = parse_continuity_clinic(chunk)
        if not parsed:
            continue
        key = f"{parsed['weekday']}|{parsed['period']}"
        if key in seen:
            continue
        seen.add(key)
        slots.append(parsed)
    return slots


def continuity_periods_for_weekday(value: Any, weekday: str) -> set[str]:
    return {
        slot["period"]
        for slot in parse_continuity_clinic_slots(value)
        if slot.get("weekday") == weekday
    }


def _is_half_day_continuity_pullout_fact(fact: Any) -> bool:
    if not isinstance(fact, dict):
        return False
    status = str(fact.get("status") or "").strip().upper()
    if status in {"OP", "OFF", "UNAVAILABLE"}:
        return True
    text = " ".join(
        str(fact.get(key) or "").lower()
        for key in ("kind", "label", "source", "sourceText")
    )
    return bool(re.search(r"\b(continuity|clinic|ahd|op|off)\b", text))


def _has_half_day_continuity_pullout_fact(
    state: dict[str, Any],
    rotator_id: str | None,
    date: str,
    period: str,
) -> bool:
    return any(
        isinstance(fact, dict)
        and fact.get("date") == date
        and fact.get("rotatorId") == rotator_id
        and fact.get("period") == period
        and _is_half_day_continuity_pullout_fact(fact)
        for fact in state.get("halfDayFacts", [])
    )


def continuity_periods_needing_whole_day_warning(
    state: dict[str, Any],
    rotator: dict[str, Any] | None,
    date: str,
) -> set[str]:
    periods = continuity_periods_for_weekday((rotator or {}).get("continuityClinic"), weekday_name(date))
    if not periods:
        return periods
    # Two continuity half-days amount to a whole-day commitment; preserve the
    # original whole-day inpatient block/warning even when imported facts exist.
    if {"AM", "PM"}.issubset(periods):
        return periods
    rotator_id = (rotator or {}).get("id")
    return {
        period
        for period in periods
        if not _has_half_day_continuity_pullout_fact(state, rotator_id, date, period)
    }


def _assignment_id(date: str, rotator_id: str, role: str) -> str:
    return f"in-{date}-{rotator_id}-{role}".replace(" ", "-").lower()


def schedule_inpatient_assignment(state: dict[str, Any], input_: dict[str, Any]) -> dict[str, Any]:
    role = input_.get("role") or "Resident"
    next_assignment = {
        "id": _assignment_id(input_["date"], input_["rotatorId"], role),
        "date": input_["date"],
        "rotatorId": input_["rotatorId"],
        "role": role,
        "source": input_.get("source") or "Manual",
    }
    return {
        **state,
        "inpatientAssignments": [
            item
            for item in state.get("inpatientAssignments", [])
            if not (
                item.get("date") == input_["date"]
                and item.get("rotatorId") == input_["rotatorId"]
                and item.get("role") == role
            )
        ]
        + [next_assignment],
    }


def _weekend_pair_date(date_str: str) -> str | None:
    """The other half of the weekend: Sat -> its Sunday, Sun -> its Saturday."""
    wd = weekday_name(date_str)
    if wd == "Saturday":
        return add_days_to_iso(date_str, 1)
    if wd == "Sunday":
        return add_days_to_iso(date_str, -1)
    return None


def consecutive_inpatient_run(state: dict[str, Any], rotator_id: str, date: str) -> int:
    assigned = {
        item.get("date")
        for item in state.get("inpatientAssignments", [])
        if item.get("rotatorId") == rotator_id and item.get("role") != "Off"
    }
    assigned.add(date)
    length = 1
    cursor = add_days_to_iso(date, -1)
    while cursor in assigned:
        length += 1
        cursor = add_days_to_iso(cursor, -1)
    cursor = add_days_to_iso(date, 1)
    while cursor in assigned:
        length += 1
        cursor = add_days_to_iso(cursor, 1)
    return length


def validate_drop(state: dict[str, Any], rotator_id: str | None, date: str | None, options: dict[str, Any] | None = None) -> dict[str, Any]:
    options = options or {}
    if not state or not rotator_id or not date:
        return {"valid": False, "reason": "Missing arguments"}
    rotator = get_rotator(state, rotator_id)
    if not rotator:
        return {"valid": False, "reason": "Rotator not found"}
    label = rotator.get("displayName") or "Rotator"
    if not is_rotator_active_on(rotator, date):
        return {"valid": False, "reason": f"{label} is not on service on {date}"}
    unavailable = is_rotator_unavailable(rotator, date)
    if unavailable:
        return {"valid": False, "reason": f"{label} is unavailable on {date} ({unavailable.get('label') or unavailable.get('reason')})"}
    if any(s.get("date") == date and s.get("rotatorId") == rotator_id for s in state.get("outpatientSessions", [])):
        return {"valid": False, "reason": f"{label} already has an outpatient session on {date}"}
    max_consec = (state.get("rules") or {}).get("maxConsecutiveInpatientDays")
    if isinstance(max_consec, (int, float)) and math.isfinite(max_consec) and max_consec > 0:
        if consecutive_inpatient_run(state, rotator_id, date) > max_consec:
            return {"valid": False, "reason": f"{label} would exceed {max_consec:g} consecutive inpatient days"}
    # Coordinator 2026-07-29 #6b: one day off per weekend — no rotator works both
    # Saturday and Sunday of the same weekend on inpatient.
    pair = _weekend_pair_date(date)
    if pair and any(
        item.get("date") == pair and item.get("rotatorId") == rotator_id and item.get("role") != "Off"
        for item in state.get("inpatientAssignments", [])
    ):
        return {"valid": False, "reason": f"{label} already works {weekday_name(pair)} this weekend and needs one day off"}
    if options.get("avoidContinuity"):
        weekday = weekday_name(date)
        if continuity_periods_needing_whole_day_warning(state, rotator, date):
            return {"valid": False, "reason": f"{label} has continuity clinic on {weekday}"}
    required_role = options.get("requiredRole")
    matches_required_role = (
        is_fellow_rotator(rotator)
        if required_role == "Fellow"
        else rotator.get("role") == required_role
    )
    if required_role and not matches_required_role:
        return {"valid": False, "reason": f"{label} is not a {required_role}"}
    return {"valid": True}


def coverage_day_type(block: dict[str, Any], date_str: str) -> str:
    holiday_dates = {
        h.get("date")
        for h in (block.get("holidays") or [])
        if isinstance(h, dict)
    }
    if date_str in holiday_dates:
        return "holiday"
    wd = weekday_name(date_str)
    if wd == "Saturday":
        return "saturday"
    if wd == "Sunday":
        return "sunday"
    return "weekday"


def coverage_for_date(block: dict[str, Any], date_str: str) -> dict[str, Any]:
    day_type = coverage_day_type(block, date_str)
    ip = ((block.get("coverage") or {}).get(day_type) or {}).get("ip")
    count = ip.get("count") if isinstance(ip, dict) else None
    if not isinstance(count, (int, float)) or not math.isfinite(count):
        count = DEFAULT_COVERAGE_COUNT[day_type]
    by_role = ip.get("byRole") if isinstance(ip, dict) and isinstance(ip.get("byRole"), dict) else None
    return {"count": max(0, count), "byRole": by_role}


def methodist_rotation_window(rotator: dict[str, Any] | None) -> dict[str, Any] | None:
    """Effective Methodist rotation window — mirrors scheduler.js
    methodistRotationWindow (Coordinator, 2026-07-10): explicit rotationStartDate
    wins; otherwise the first scheduled day (earliest segment start) is day 1.
    Rotations shorter than 28 days split in half (26-day block -> 13/13, odd
    lengths put the extra day on the first side); spans of 28+ keep the
    historical 14/14 fortnights. Returns {start, cycle, half, derived} or None
    when not Methodist / no start resolvable."""
    if not rotator or classify_rotator(rotator) != "methodist":
        return None
    segments = [
        seg for seg in (rotator.get("segments") if isinstance(rotator.get("segments"), list) else [])
        if seg and seg.get("start") and seg.get("end")
    ]
    segment_starts = sorted(seg["start"] for seg in segments)
    start = rotator.get("rotationStartDate") or (segment_starts[0] if segment_starts else None) or rotator.get("startDate")
    if not start:
        return None
    segment_ends = sorted(seg["end"] for seg in segments)
    last_end = (segment_ends[-1] if segment_ends else None) or rotator.get("endDate")
    cycle = METHODIST_ROTATION_LENGTH_DAYS
    if last_end:
        span = days_between(start, last_end)
        if span is not None and span >= 0:
            cycle = min(METHODIST_ROTATION_LENGTH_DAYS, span + 1)
    return {
        "start": start,
        "cycle": cycle,
        "half": (cycle + 1) // 2,
        "derived": not rotator.get("rotationStartDate"),
    }


def get_rotator_phase(rotator: dict[str, Any] | None, date_str: str | None) -> str | None:
    if not rotator or not date_str:
        return None
    window = methodist_rotation_window(rotator)
    if not window:
        return None
    day_index = days_between(window["start"], date_str)
    if day_index is None or day_index < 0 or day_index >= window["cycle"]:
        return None
    inpatient_first = rotator.get("methodistStartSide") == "inpatient"
    if day_index < window["half"]:
        return "inpatient" if inpatient_first else "outpatient"
    return "outpatient" if inpatient_first else "inpatient"


def choose_methodist_start_side(rotator: dict[str, Any] | None, block: dict[str, Any] | None) -> str:
    window = methodist_rotation_window(rotator)
    if not window or not block or not block.get("startDate") or not block.get("endDate"):
        return "outpatient"

    def days_in_block(offset: int, length: int) -> int:
        count = 0
        for index in range(length):
            date = add_days_to_iso(window["start"], offset + index)
            if block["startDate"] <= date <= block["endDate"]:
                count += 1
        return count

    if days_in_block(0, window["half"]) > days_in_block(window["half"], window["cycle"] - window["half"]):
        return "inpatient"
    return "outpatient"


def rotator_active_on_inline(rotator: dict[str, Any] | None, date_str: str | None) -> bool:
    if not rotator or not date_str:
        return False
    segments = rotator.get("segments") if isinstance(rotator.get("segments"), list) else None
    if segments:
        return any(
            seg and seg.get("start") and seg.get("end") and seg["start"] <= date_str <= seg["end"]
            for seg in segments
        )
    if rotator.get("startDate") and rotator.get("endDate"):
        return rotator["startDate"] <= date_str <= rotator["endDate"]
    return False


def get_rotator_segment_phase(rotator: dict[str, Any] | None, date_str: str | None) -> str | None:
    if not rotator or not date_str:
        return None
    segments = rotator.get("segments") if isinstance(rotator.get("segments"), list) else []
    for seg in segments:
        if not seg or not seg.get("start") or not seg.get("end"):
            continue
        if date_str < seg["start"] or date_str > seg["end"]:
            continue
        if seg.get("defaultPhase") in {"outpatient", "inpatient"}:
            return seg["defaultPhase"]
        return None
    return None


def apply_preassignments(state: dict[str, Any] | None, block: dict[str, Any] | None) -> dict[str, Any] | None:
    if not state or not block:
        return state
    block_dates = date_range(block.get("startDate"), block.get("endDate"))
    if not block_dates:
        return state

    no_clinic = _no_clinic_holidays(block)
    existing_inpatient = {
        f"{item.get('date')}|{item.get('rotatorId')}"
        for item in state.get("inpatientAssignments", [])
    }
    existing_outpatient = {
        f"{item.get('date')}|{item.get('rotatorId')}|{item.get('period')}"
        for item in state.get("outpatientSessions", [])
    }
    new_inpatient: list[dict[str, Any]] = []
    new_outpatient: list[dict[str, Any]] = []

    for rotator in state.get("rotators", []):
        segments = rotator.get("segments") if isinstance(rotator.get("segments"), list) else []
        for segment in segments:
            if not segment or not segment.get("start") or not segment.get("end"):
                continue
            phase = segment.get("defaultPhase")
            if phase not in {"inpatient", "outpatient"}:
                continue
            for date in block_dates:
                if date < segment["start"] or date > segment["end"]:
                    continue
                date_weekday = weekday_name(date)
                if date_weekday in {"Saturday", "Sunday"}:
                    continue
                if phase == "inpatient":
                    role = coverage_role_for_rotator(rotator)
                    key = f"{date}|{rotator.get('id')}"
                    if key in existing_inpatient:
                        continue
                    existing_inpatient.add(key)
                    new_inpatient.append(
                        {
                            "id": f"in-pre-{date}-{rotator['id']}".replace(" ", "-").lower(),
                            "date": date,
                            "rotatorId": rotator["id"],
                            "role": role,
                            "source": "Auto-Preassigned",
                        }
                    )
                else:
                    if date in no_clinic:
                        continue
                    continuity_periods = continuity_periods_for_weekday(rotator.get("continuityClinic"), date_weekday)
                    for period in [p for p in ["AM", "PM"] if p not in continuity_periods]:
                        key = f"{date}|{rotator.get('id')}|{period}"
                        if key in existing_outpatient:
                            continue
                        existing_outpatient.add(key)
                        new_outpatient.append(
                            {
                                "id": f"out-pre-{date}-{period}-{rotator['id']}".lower(),
                                "date": date,
                                "period": period,
                                "clinic": OP_PLACEHOLDER_CLINIC,
                                "provider": "",
                                "rotatorId": rotator["id"],
                                "status": "Scheduled",
                                "source": "Auto-Preassigned",
                            }
                        )

    if not new_inpatient and not new_outpatient:
        return state
    return {
        **state,
        "inpatientAssignments": [*(state.get("inpatientAssignments") or []), *new_inpatient],
        "outpatientSessions": [*(state.get("outpatientSessions") or []), *new_outpatient],
    }


def is_fellow_rotator(rotator: dict[str, Any] | None) -> bool:
    if not rotator:
        return False
    fellow_signal = (
        rotator.get("role") == "Fellow"
        or str(rotator.get("level") or "").strip().lower() == "fellow"
    )
    if not fellow_signal:
        return False
    program = str(rotator.get("program") or "").strip().lower()
    return not program or program == "other" or "pedi" in program


def coverage_role_for_rotator(rotator: dict[str, Any] | None) -> str:
    if is_fellow_rotator(rotator):
        return "Fellow"
    role = (rotator or {}).get("role")
    return "Resident" if role == "Fellow" else (role or "Resident")


def rotator_label(rotator: dict[str, Any]) -> str:
    return rotator.get("displayName") or rotator.get("fullName") or rotator.get("id")


def _no_clinic_holidays(block: dict[str, Any]) -> set[str]:
    return {
        h.get("date")
        for h in (block.get("holidays") or [])
        if isinstance(h, dict) and h.get("noClinic")
    }


def _headcount(state: dict[str, Any], date: str) -> set[str]:
    return {
        item.get("rotatorId")
        for item in state.get("inpatientAssignments", [])
        if item.get("date") == date and item.get("role") != "Off"
    }


def _load_of(state: dict[str, Any], rotator_id: str, block: dict[str, Any]) -> int:
    return len(
        {
            item.get("date")
            for item in state.get("inpatientAssignments", [])
            if item.get("rotatorId") == rotator_id
            and item.get("role") != "Off"
            and block.get("startDate") <= item.get("date", "") <= block.get("endDate")
        }
    )


def _eligible_for(
    state: dict[str, Any],
    date: str,
    required_role: str | None,
    excluded_slots: set[str] | None = None,
) -> list[dict[str, Any]]:
    excluded_slots = excluded_slots or set()
    already = _headcount(state, date)
    return [
        rotator
        for rotator in state.get("rotators", [])
        if rotator.get("id") not in already
        and f"{date}|{rotator.get('id')}" not in excluded_slots
        and get_rotator_phase(rotator, date) != "outpatient"
        and get_rotator_segment_phase(rotator, date) != "outpatient"
        and validate_drop(state, rotator.get("id"), date, {"avoidContinuity": True, "requiredRole": required_role}).get("valid")
    ]


def _sort_eligible(rotators: list[dict[str, Any]], state: dict[str, Any], block: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(rotators, key=lambda r: (_load_of(state, r.get("id"), block), r.get("id") or ""))


def apply_methodist_auto_assign(state: dict[str, Any] | None, block: dict[str, Any] | None) -> dict[str, Any] | None:
    if not state or not block:
        return state
    block_dates = date_range(block.get("startDate"), block.get("endDate"))
    if not block_dates:
        return state

    no_clinic = _no_clinic_holidays(block)
    existing_inpatient = {
        f"{item.get('date')}|{item.get('rotatorId')}"
        for item in state.get("inpatientAssignments", [])
    }
    existing_outpatient = {
        f"{item.get('date')}|{item.get('rotatorId')}|{item.get('period')}"
        for item in state.get("outpatientSessions", [])
    }
    new_inpatient: list[dict[str, Any]] = []
    new_outpatient: list[dict[str, Any]] = []

    for rotator in state.get("rotators", []):
        if classify_rotator(rotator) != "methodist":
            continue
        if not methodist_rotation_window(rotator):
            continue
        for date in block_dates:
            phase = get_rotator_phase(rotator, date)
            if not phase:
                continue
            if not rotator_active_on_inline(rotator, date):
                continue
            if phase == "inpatient":
                role = coverage_role_for_rotator(rotator)
                key = f"{date}|{rotator.get('id')}"
                if key in existing_inpatient:
                    continue
                existing_inpatient.add(key)
                new_inpatient.append(
                    {
                        "id": f"in-auto-{date}-{rotator['id']}".replace(" ", "-").lower(),
                        "date": date,
                        "rotatorId": rotator["id"],
                        "role": role,
                        "source": "Auto-Methodist",
                    }
                )
            else:
                date_weekday = weekday_name(date)
                if date_weekday in {"Saturday", "Sunday"}:
                    continue
                if date in no_clinic:
                    continue
                continuity_periods = continuity_periods_for_weekday(rotator.get("continuityClinic"), date_weekday)
                for period in [p for p in ["AM", "PM"] if p not in continuity_periods]:
                    key = f"{date}|{rotator.get('id')}|{period}"
                    if key in existing_outpatient:
                        continue
                    existing_outpatient.add(key)
                    new_outpatient.append(
                        {
                            "id": f"out-auto-{date}-{period}-{rotator['id']}".lower(),
                            "date": date,
                            "period": period,
                            "clinic": METHODIST_OP_CLINIC,
                            "provider": "",
                            "rotatorId": rotator["id"],
                            "status": "Scheduled",
                            "source": "Auto-Methodist",
                        }
                    )

    if not new_inpatient and not new_outpatient:
        return state
    return {
        **state,
        "inpatientAssignments": [*(state.get("inpatientAssignments") or []), *new_inpatient],
        "outpatientSessions": [*(state.get("outpatientSessions") or []), *new_outpatient],
    }


def segment_split_plan(segment: dict[str, Any] | None) -> list[dict[str, str]]:
    if not segment or not segment.get("start") or not segment.get("end"):
        return []
    days = days_between(segment["start"], segment["end"])
    if days is None or days < 0:
        return []
    weeks = max(1, round((days + 1) / 7))
    ip_weeks = math.ceil(weeks / 2)
    op_lead = math.floor((weeks - ip_weeks) / 2)
    plan = []
    for week in range(weeks):
        plan.append(
            {
                "start": add_days_to_iso(segment["start"], week * 7),
                "end": segment["end"] if week == weeks - 1 else add_days_to_iso(segment["start"], week * 7 + 6),
                "phase": "inpatient" if week >= op_lead and week < op_lead + ip_weeks else "outpatient",
            }
        )
    return plan


def apply_length_split_auto_assign(state: dict[str, Any] | None, block: dict[str, Any] | None) -> dict[str, Any] | None:
    if not state or not block:
        return state
    block_dates = date_range(block.get("startDate"), block.get("endDate"))
    if not block_dates:
        return state

    no_clinic = _no_clinic_holidays(block)
    existing_inpatient = {
        f"{item.get('date')}|{item.get('rotatorId')}"
        for item in state.get("inpatientAssignments", [])
    }
    existing_outpatient = {
        f"{item.get('date')}|{item.get('rotatorId')}|{item.get('period')}"
        for item in state.get("outpatientSessions", [])
    }
    existing_outpatient_day = {
        f"{item.get('date')}|{item.get('rotatorId')}"
        for item in state.get("outpatientSessions", [])
    }
    new_inpatient: list[dict[str, Any]] = []
    new_outpatient: list[dict[str, Any]] = []

    for rotator in state.get("rotators", []):
        if classify_rotator(rotator) not in LENGTH_SPLIT_SCHOOL_TYPES:
            continue
        if is_fellow_rotator(rotator):
            continue
        segments = rotator.get("segments") if isinstance(rotator.get("segments"), list) else []
        for segment in segments:
            if (segment or {}).get("defaultPhase") in {"outpatient", "inpatient"}:
                continue
            for chunk in segment_split_plan(segment):
                for date in block_dates:
                    if date < chunk["start"] or date > chunk["end"]:
                        continue
                    key = f"{date}|{rotator.get('id')}"
                    if chunk["phase"] == "inpatient":
                        if key in existing_inpatient:
                            continue
                        if key in existing_outpatient_day:
                            continue
                        existing_inpatient.add(key)
                        new_inpatient.append(
                            {
                                "id": f"in-split-{date}-{rotator['id']}".replace(" ", "-").lower(),
                                "date": date,
                                "rotatorId": rotator["id"],
                                "role": coverage_role_for_rotator(rotator),
                                "source": "Auto-Split",
                            }
                        )
                    else:
                        date_weekday = weekday_name(date)
                        if date_weekday in {"Saturday", "Sunday"}:
                            continue
                        if date in no_clinic:
                            continue
                        if key in existing_inpatient:
                            continue
                        continuity_periods = continuity_periods_for_weekday(rotator.get("continuityClinic"), date_weekday)
                        for period in [p for p in ["AM", "PM"] if p not in continuity_periods]:
                            slot = f"{date}|{rotator.get('id')}|{period}"
                            if slot in existing_outpatient:
                                continue
                            existing_outpatient.add(slot)
                            new_outpatient.append(
                                {
                                    "id": f"out-split-{date}-{period}-{rotator['id']}".lower(),
                                    "date": date,
                                    "period": period,
                                    "clinic": OP_PLACEHOLDER_CLINIC,
                                    "provider": "",
                                    "rotatorId": rotator["id"],
                                    "status": "Scheduled",
                                    "source": "Auto-Split",
                                }
                            )

    if not new_inpatient and not new_outpatient:
        return state
    return {
        **state,
        "inpatientAssignments": [*(state.get("inpatientAssignments") or []), *new_inpatient],
        "outpatientSessions": [*(state.get("outpatientSessions") or []), *new_outpatient],
    }


def propose_schedule(
    state: dict[str, Any] | None,
    block: dict[str, Any] | None,
    excluded_slots: set[str] | None = None,
) -> dict[str, Any]:
    if not state or not block or not block.get("startDate") or not block.get("endDate"):
        return {"proposedState": state, "unmet": []}

    excluded_slots = excluded_slots or set()
    working = state
    unmet: list[dict[str, Any]] = []
    dates = date_range(block["startDate"], block["endDate"])

    def fill_one(date: str, required_role: str | None) -> bool:
        nonlocal working
        eligible = _sort_eligible(_eligible_for(working, date, required_role, excluded_slots), working, block)
        if not eligible:
            return False
        chosen = eligible[0]
        working = schedule_inpatient_assignment(
            working,
            {
                "date": date,
                "rotatorId": chosen["id"],
                "role": chosen.get("role") or "Resident",
                "source": "Auto-Draft",
            },
        )
        return True

    open_dates = []
    for date in dates:
        required = coverage_for_date(block, date)["count"]
        if required <= 0:
            continue
        if len(_headcount(working, date)) >= required:
            continue
        open_dates.append({"date": date, "eligibleCount": len(_eligible_for(working, date, None, excluded_slots))})
    open_dates.sort(key=lambda item: (item["eligibleCount"], item["date"]))

    for item in open_dates:
        date = item["date"]
        demand = coverage_for_date(block, date)
        by_role = demand.get("byRole")
        if isinstance(by_role, dict):
            for role, min_count in by_role.items():
                have = len([rid for rid in _headcount(working, date) if (get_rotator(working, rid) or {}).get("role") == role])
                while have < min_count:
                    if not fill_one(date, role):
                        unmet.append({"date": date, "reason": f"No eligible {role} available on {date}", "requiredRole": role})
                        break
                    have += 1
        guard = 0
        while len(_headcount(working, date)) < demand["count"] and guard < 64:
            guard += 1
            if not fill_one(date, None):
                short = demand["count"] - len(_headcount(working, date))
                unmet.append({"date": date, "reason": f"No eligible resident available on {date} ({short} short)", "short": short})
                break

    def remove_one(next_state: dict[str, Any], rotator_id: str, date: str) -> dict[str, Any]:
        return {
            **next_state,
            "inpatientAssignments": [
                item
                for item in next_state.get("inpatientAssignments", [])
                if not (item.get("rotatorId") == rotator_id and item.get("date") == date)
            ],
        }

    still_unmet: list[dict[str, Any]] = []
    for unmet_item in unmet:
        if unmet_item.get("requiredRole"):
            still_unmet.append(unmet_item)
            continue
        short = max(1, unmet_item.get("short") or 1)
        while short > 0:
            moved = False
            for donor_date in dates:
                if donor_date == unmet_item["date"] or coverage_for_date(block, donor_date).get("byRole") is not None:
                    continue
                donors = sorted(
                    [
                        item
                        for item in working.get("inpatientAssignments", [])
                        if item.get("date") == donor_date and item.get("source") == "Auto-Draft" and item.get("role") != "Off"
                    ],
                    key=lambda item: item.get("rotatorId") or "",
                )
                for donor in donors:
                    if donor.get("rotatorId") in _headcount(working, unmet_item["date"]):
                        continue
                    if f"{unmet_item['date']}|{donor.get('rotatorId')}" in excluded_slots:
                        continue
                    removed = remove_one(working, donor["rotatorId"], donor_date)
                    if not validate_drop(removed, donor["rotatorId"], unmet_item["date"], {"avoidContinuity": True}).get("valid"):
                        continue
                    after_move = schedule_inpatient_assignment(
                        removed,
                        {
                            "date": unmet_item["date"],
                            "rotatorId": donor["rotatorId"],
                            "role": donor.get("role") or "Resident",
                            "source": "Auto-Draft",
                        },
                    )
                    backfills = _sort_eligible(_eligible_for(after_move, donor_date, None, excluded_slots), after_move, block)
                    if not backfills:
                        continue
                    working = schedule_inpatient_assignment(
                        after_move,
                        {
                            "date": donor_date,
                            "rotatorId": backfills[0]["id"],
                            "role": backfills[0].get("role") or "Resident",
                            "source": "Auto-Draft",
                        },
                    )
                    moved = True
                    break
                if moved:
                    break
            if not moved:
                break
            short -= 1
        if short > 0:
            still_unmet.append({**unmet_item, "short": short})

    return {"proposedState": working, "unmet": still_unmet}


def seed_fellow_inpatient(state: dict[str, Any] | None, block: dict[str, Any] | None) -> dict[str, Any]:
    if not state or not block:
        return {"state": state, "candidates": []}
    candidates: list[dict[str, Any]] = []
    working = state

    for date in date_range(block.get("startDate"), block.get("endDate")):
        if coverage_for_date(block, date)["count"] <= 0:
            continue
        assigned_ip = {
            item.get("rotatorId")
            for item in working.get("inpatientAssignments", [])
            if item.get("date") == date and item.get("role") != "Off"
        }
        assigned_op = {
            item.get("rotatorId")
            for item in working.get("outpatientSessions", [])
            if item.get("date") == date
        }
        blank_fellows = [
            rotator
            for rotator in working.get("rotators", [])
            if is_fellow_rotator(rotator)
            and is_rotator_active_on(rotator, date)
            and rotator.get("id") not in assigned_ip
            and rotator.get("id") not in assigned_op
            and not get_rotator_segment_phase(rotator, date)
        ]
        if len(blank_fellows) == 1:
            fellow = blank_fellows[0]
            if validate_drop(working, fellow.get("id"), date, {"avoidContinuity": True}).get("valid"):
                working = schedule_inpatient_assignment(
                    working,
                    {
                        "date": date,
                        "rotatorId": fellow["id"],
                        "role": coverage_role_for_rotator(fellow),
                        "source": "Auto-Draft",
                    },
                )
        elif len(blank_fellows) > 1:
            candidates.append(
                {
                    "date": date,
                    "names": sorted(f.get("displayName") or f.get("name") or f.get("id") for f in blank_fellows),
                    "rotatorIds": sorted(f.get("id") for f in blank_fellows if f.get("id")),
                }
            )

    return {"state": working, "candidates": candidates}


def _fellow_candidate_slot_keys(candidates: list[dict[str, Any]] | None) -> set[str]:
    keys: set[str] = set()
    for candidate in candidates if isinstance(candidates, list) else []:
        date = candidate.get("date")
        if not date:
            continue
        for rotator_id in candidate.get("rotatorIds") if isinstance(candidate.get("rotatorIds"), list) else []:
            if rotator_id:
                keys.add(f"{date}|{rotator_id}")
    return keys


def fill_outpatient_target(
    state: dict[str, Any] | None,
    block: dict[str, Any] | None,
    excluded_slots: set[str] | None = None,
) -> dict[str, Any] | None:
    if not state or not block:
        return state
    excluded_slots = excluded_slots or set()
    no_clinic = _no_clinic_holidays(block)
    working = state

    def op_load(s: dict[str, Any], rotator_id: str) -> int:
        days = {
            item.get("date")
            for item in s.get("outpatientSessions", [])
            if item.get("rotatorId") == rotator_id
            and block.get("startDate") <= item.get("date", "") <= block.get("endDate")
        }
        return len(days)

    for date in date_range(block.get("startDate"), block.get("endDate")):
        date_weekday = weekday_name(date)
        if date_weekday in {"Saturday", "Sunday"}:
            continue
        if date in no_clinic:
            continue

        op_rotators = {
            item.get("rotatorId")
            for item in working.get("outpatientSessions", [])
            if item.get("date") == date
        }
        if len(op_rotators) >= OUTPATIENT_TARGET_ROTATORS:
            continue

        ip_rotators = {
            item.get("rotatorId")
            for item in working.get("inpatientAssignments", [])
            if item.get("date") == date and item.get("role") != "Off"
        }
        eligible = sorted(
            [
                rotator
                for rotator in working.get("rotators", [])
                if rotator.get("id") not in op_rotators
                and rotator.get("id") not in ip_rotators
                and f"{date}|{rotator.get('id')}" not in excluded_slots
                and is_rotator_active_on(rotator, date)
                and not is_rotator_unavailable(rotator, date)
                and get_rotator_phase(rotator, date) != "inpatient"
                and get_rotator_segment_phase(rotator, date) != "inpatient"
            ],
            key=lambda r: (op_load(working, r.get("id")), r.get("id") or ""),
        )

        new_sessions: list[dict[str, Any]] = []
        added = 0
        for rotator in eligible:
            if len(op_rotators) + added >= OUTPATIENT_TARGET_ROTATORS:
                break
            continuity_periods = continuity_periods_for_weekday(rotator.get("continuityClinic"), date_weekday)
            for period in [p for p in ["AM", "PM"] if p not in continuity_periods]:
                new_sessions.append(
                    {
                        "id": f"out-fill-{date}-{period}-{rotator['id']}".lower(),
                        "date": date,
                        "period": period,
                        "clinic": OP_PLACEHOLDER_CLINIC,
                        "provider": "",
                        "rotatorId": rotator["id"],
                        "status": "Scheduled",
                        "source": "Auto-Draft",
                    }
                )
            added += 1
        if new_sessions:
            working = {
                **working,
                "outpatientSessions": [*(working.get("outpatientSessions") or []), *new_sessions],
            }

    return working


def apply_program_rules(state: dict[str, Any] | None, block: dict[str, Any] | None) -> dict[str, Any] | None:
    if not state or not block:
        return state
    handlers = {
        "methodist": apply_methodist_auto_assign,
        "ut-adult": apply_length_split_auto_assign,
        "ut-peds": apply_length_split_auto_assign,
        "ut-psychiatry": apply_length_split_auto_assign,
        "ut-student": lambda s, _b: s,
        "other": lambda s, _b: s,
    }
    next_state = state
    for school_type, handler in handlers.items():
        if any(classify_rotator(rotator) == school_type for rotator in (next_state or {}).get("rotators", [])):
            next_state = handler(next_state, block)
    return next_state


def empty_report(block: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "summary": {
            "blockName": (block or {}).get("name") or "",
            "startDate": (block or {}).get("startDate") or "",
            "endDate": (block or {}).get("endDate") or "",
            "inpatientAdded": 0,
            "outpatientAdded": 0,
            "errorCount": 0,
            "warningCount": 0,
        },
        "checks": [],
        "unmet": [],
    }


def build_draft_report(state: dict[str, Any], block: dict[str, Any], extras: dict[str, Any] | None = None) -> dict[str, Any]:
    extras = extras or {}
    checks: list[dict[str, Any]] = []
    dates = date_range(block.get("startDate"), block.get("endDate"))
    rotators = state.get("rotators", [])
    active_in_block = [rotator for rotator in rotators if any(is_rotator_active_on(rotator, date) for date in dates)]

    for date in dates:
        required = coverage_for_date(block, date)["count"]
        if required <= 0:
            continue
        staffed = {
            item.get("rotatorId")
            for item in state.get("inpatientAssignments", [])
            if item.get("date") == date and item.get("role") != "Off"
        }
        if len(staffed) < required:
            checks.append(
                {
                    "id": "ip-below-min",
                    "severity": "error",
                    "date": date,
                    "required": required,
                    "have": len(staffed),
                    "message": f"{date}: inpatient is staffed by {len(staffed)}, needs {required}.",
                }
            )

    for rotator in active_in_block:
        if classify_rotator(rotator) != "methodist":
            continue
        window = methodist_rotation_window(rotator)
        if not window:
            checks.append(
                {
                    "id": "methodist-no-start",
                    "severity": "warning",
                    "rotatorId": rotator.get("id"),
                    "message": f"{rotator_label(rotator)} is Methodist but has no rotation start date \u2014 the 14/14 inpatient/outpatient split can't be generated.",
                }
            )
        elif window["derived"]:
            # Coordinator 2026-07-10: first scheduled day counts as day 1 and short
            # rotations split in half \u2014 surface the assumption so a wrong guess
            # is visible and correctable.
            checks.append(
                {
                    "id": "methodist-derived-start",
                    "severity": "info",
                    "rotatorId": rotator.get("id"),
                    "message": (
                        f"{rotator_label(rotator)} has no explicit rotation start date \u2014 using their "
                        f"first scheduled day ({window['start']}) as day 1 of a "
                        f"{window['half']}/{window['cycle'] - window['half']} inpatient/outpatient split."
                    ),
                }
            )

    fellows = [rotator for rotator in active_in_block if is_fellow_rotator(rotator)]
    if fellows:
        fellow_ids = {f.get("id") for f in fellows}

        def in_block(date: str | None) -> bool:
            return bool(date and block.get("startDate") <= date <= block.get("endDate"))

        any_fellow_ip = any(
            item.get("role") != "Off" and item.get("rotatorId") in fellow_ids and in_block(item.get("date"))
            for item in state.get("inpatientAssignments", [])
        )
        any_fellow_op = any(
            item.get("rotatorId") in fellow_ids and in_block(item.get("date"))
            for item in state.get("outpatientSessions", [])
        )
        if not any_fellow_ip:
            checks.append(
                {
                    "id": "fellow-no-inpatient",
                    "severity": "warning",
                    "message": "No fellow is assigned to inpatient anywhere in this block.",
                }
            )
        if not any_fellow_op:
            checks.append(
                {
                    "id": "fellow-no-outpatient",
                    "severity": "warning",
                    "message": "No fellow is assigned to outpatient anywhere in this block.",
                }
            )

    candidate_groups: dict[str, list[str]] = {}
    for candidate in extras.get("fellowCandidates") if isinstance(extras.get("fellowCandidates"), list) else []:
        names = " / ".join(candidate.get("names") or [])
        candidate_groups.setdefault(names, []).append(candidate.get("date"))
    for names, candidate_dates in candidate_groups.items():
        first = candidate_dates[0]
        message_dates = first if len(candidate_dates) == 1 else f"{first} \u2013 {candidate_dates[-1]}"
        checks.append(
            {
                "id": "fellow-blank-candidates",
                "severity": "warning",
                "candidates": names.split(" / "),
                "dates": candidate_dates,
                "message": f"{len(candidate_dates)} day{'' if len(candidate_dates) == 1 else 's'} ({message_dates}) need a fellow: pick {names} on the Fellows page.",
            }
        )

    no_clinic = _no_clinic_holidays(block)
    op_short_dates = []
    for date in dates:
        wd = weekday_name(date)
        if wd in {"Saturday", "Sunday"} or date in no_clinic:
            continue
        op_count = len(
            {
                item.get("rotatorId")
                for item in state.get("outpatientSessions", [])
                if item.get("date") == date
            }
        )
        if op_count < OUTPATIENT_TARGET_ROTATORS:
            op_short_dates.append(date)
    if op_short_dates:
        checks.append(
            {
                "id": "op-below-target",
                "severity": "warning",
                "dates": op_short_dates,
                "message": f"{len(op_short_dates)} clinic day{'' if len(op_short_dates) == 1 else 's'} (first: {op_short_dates[0]}) have fewer than {OUTPATIENT_TARGET_ROTATORS} outpatient rotators.",
            }
        )

    for rotator in active_in_block:
        if is_fellow_rotator(rotator):
            continue
        flagged = False
        segments = rotator.get("segments") if isinstance(rotator.get("segments"), list) else []
        for segment in segments:
            chunks = segment_split_plan(segment)
            if len(chunks) < 3 or flagged:
                continue
            phases = []
            for chunk in chunks:
                ip_days = len(
                    {
                        item.get("date")
                        for item in state.get("inpatientAssignments", [])
                        if item.get("rotatorId") == rotator.get("id")
                        and item.get("role") != "Off"
                        and chunk["start"] <= item.get("date", "") <= chunk["end"]
                    }
                )
                op_days = len(
                    {
                        item.get("date")
                        for item in state.get("outpatientSessions", [])
                        if item.get("rotatorId") == rotator.get("id")
                        and chunk["start"] <= item.get("date", "") <= chunk["end"]
                    }
                )
                if ip_days > op_days:
                    phases.append("ip")
                elif op_days > ip_days:
                    phases.append("op")
                else:
                    phases.append(None)
            for index in range(1, len(phases) - 1):
                if phases[index] == "ip" and phases[index - 1] == "op" and phases[index + 1] == "op":
                    checks.append(
                        {
                            "id": "five-week-sandwich",
                            "severity": "warning",
                            "rotatorId": rotator.get("id"),
                            "message": f"{rotator_label(rotator)} has a single inpatient week sandwiched between outpatient weeks \u2014 keep inpatient weeks consecutive.",
                        }
                    )
                    flagged = True
                    break

    for rotator in rotators:
        type_ = classify_rotator(rotator)
        if type_ not in {"ut-peds", "ut-adult"}:
            continue
        ip_days = len(
            {
                item.get("date")
                for item in state.get("inpatientAssignments", [])
                if item.get("rotatorId") == rotator.get("id") and item.get("role") != "Off"
            }
        )
        op_days = len(
            {
                item.get("date")
                for item in state.get("outpatientSessions", [])
                if item.get("rotatorId") == rotator.get("id")
            }
        )
        if ip_days + op_days >= 14 and abs(ip_days - op_days) > 7:
            checks.append(
                {
                    "id": "year-balance",
                    "severity": "warning",
                    "rotatorId": rotator.get("id"),
                    "message": f"{rotator_label(rotator)} has {ip_days} inpatient vs {op_days} outpatient days across all blocks \u2014 rebalance future blocks.",
                }
            )

    inpatient_added = extras.get("inpatientAdded") if isinstance(extras.get("inpatientAdded"), (int, float)) and math.isfinite(extras.get("inpatientAdded")) else 0
    outpatient_added = extras.get("outpatientAdded") if isinstance(extras.get("outpatientAdded"), (int, float)) and math.isfinite(extras.get("outpatientAdded")) else 0
    return {
        "summary": {
            "blockName": block.get("name") or "",
            "startDate": block.get("startDate") or "",
            "endDate": block.get("endDate") or "",
            "inpatientAdded": inpatient_added,
            "outpatientAdded": outpatient_added,
            "errorCount": len([check for check in checks if check.get("severity") == "error"]),
            "warningCount": len([check for check in checks if check.get("severity") == "warning"]),
        },
        "checks": checks,
        "unmet": extras.get("unmet") if isinstance(extras.get("unmet"), list) else [],
    }


def generate_draft(
    state: dict[str, Any] | None,
    block: dict[str, Any] | None,
    baseline_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not state or not block:
        return {"state": state if state is not None else None, "report": empty_report(block)}

    # Report counts diff against the true pre-command state. Callers that
    # preassign first (inpatient.draft) pass the original state here so cells
    # added by preassignment still count as "added" in the report.
    baseline = baseline_state if baseline_state is not None else state
    input_ip_count = len(baseline.get("inpatientAssignments") or [])
    input_op_count = len(baseline.get("outpatientSessions") or [])

    with_sides = {
        **state,
        "rotators": [
            {
                **rotator,
                "methodistStartSide": choose_methodist_start_side(rotator, block),
            }
            if classify_rotator(rotator) == "methodist" and methodist_rotation_window(rotator) and not rotator.get("methodistStartSide")
            else rotator
            for rotator in state.get("rotators", [])
        ],
    }
    seeded = apply_program_rules(with_sides, block)
    fellow_result = seed_fellow_inpatient(seeded, block)
    fellow_candidate_slots = _fellow_candidate_slot_keys(fellow_result.get("candidates"))
    proposed = propose_schedule(fellow_result["state"], block, fellow_candidate_slots)
    op_filled = fill_outpatient_target(proposed["proposedState"], block, fellow_candidate_slots)
    report = build_draft_report(
        op_filled,
        block,
        {
            "unmet": proposed.get("unmet"),
            "fellowCandidates": fellow_result.get("candidates"),
            "inpatientAdded": len(op_filled.get("inpatientAssignments") or []) - input_ip_count,
            "outpatientAdded": len(op_filled.get("outpatientSessions") or []) - input_op_count,
        },
    )
    return {"state": op_filled, "report": report}
