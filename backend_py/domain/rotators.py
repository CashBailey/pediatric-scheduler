"""Rotator roster mutators ported from shared/scheduler/scheduler.js."""

from __future__ import annotations

import re
import time
from datetime import date
from typing import Any

from backend_py.domain.draft import infer_school_type

WEEKDAYS = ("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
_WEEKDAY_SET = set(WEEKDAYS)
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def slug(value: Any) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", str(value).strip().lower())
    cleaned = re.sub(r"(^-|-$)", "", cleaned)
    return cleaned or "item"


def normalize_segment(segment: dict[str, Any] | None) -> dict[str, Any] | None:
    if not segment:
        return None
    start = segment.get("start") or ""
    end = segment.get("end") or ""
    if not start or not end:
        return None
    normalized: dict[str, Any] = {"start": start, "end": end}
    if segment.get("defaultPhase") in {"outpatient", "inpatient"}:
        normalized["defaultPhase"] = segment["defaultPhase"]
    return normalized


def normalize_segments(segments: Any) -> list[dict[str, Any]]:
    if not isinstance(segments, list):
        return []
    out = []
    for segment in segments:
        normalized = normalize_segment(segment)
        if normalized:
            out.append(normalized)
    return out


def _is_iso_date(value: Any) -> bool:
    if not isinstance(value, str) or not _ISO_DATE_RE.match(value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def normalize_day_off(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    requested = {day for day in value if isinstance(day, str) and day in _WEEKDAY_SET}
    return [day for day in WEEKDAYS if day in requested]


def normalize_unavailable_ranges(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    out: list[dict[str, Any]] = []
    for range_ in value:
        if not isinstance(range_, dict):
            continue
        start = range_.get("start")
        end = range_.get("end")
        if not _is_iso_date(start) or not _is_iso_date(end) or end < start:
            continue
        normalized: dict[str, Any] = {"start": start, "end": end}
        label = range_.get("label")
        if isinstance(label, str) and label.strip():
            normalized["label"] = label.strip()
        out.append(normalized)
    return out


def normalize_rotation_start_date(value: Any) -> str:
    trimmed = str(value or "").strip()
    return trimmed if _is_iso_date(trimmed) else ""


def normalize_methodist_start_side(value: Any) -> str:
    trimmed = str(value or "").strip().lower()
    return trimmed if trimmed in {"inpatient", "outpatient"} else ""


def normalize_pediatric_fellow_roles(state: Any) -> Any:
    """Repair the legacy Psychiatry-as-Pedi-Fellow import bug idempotently.

    Preserve names, academic levels, dates, and opaque IDs. Only the
    scheduler coverage role (and linked inpatient role labels) changes.
    """
    if not isinstance(state, dict) or not isinstance(state.get("rotators"), list):
        return state

    psychiatry_ids: set[str] = set()
    rotators_changed = False
    rotators: list[Any] = []
    for rotator in state["rotators"]:
        if not isinstance(rotator, dict):
            rotators.append(rotator)
            continue
        is_legacy_psych_fellow = (
            rotator.get("role") == "Fellow"
            and str(rotator.get("program") or "").strip().lower() == "ut psychiatry"
        )
        if is_legacy_psych_fellow:
            rotators_changed = True
            if rotator.get("id"):
                psychiatry_ids.add(str(rotator["id"]))
            rotators.append({**rotator, "role": "Resident", "schoolType": "ut-psychiatry"})
            continue
        # Coordinator 2026-07-29 #1: fellows imported before the fellow-specific
        # program existed are stuck labeled "UT Pediatrics" (or blank/Other).
        # Relabel them once; idempotent because the new label short-circuits.
        program = str(rotator.get("program") or "").strip()
        is_mislabeled_pedi_fellow = (
            rotator.get("role") == "Fellow"
            and program in {"", "Other", "UT Pediatrics"}
        )
        if is_mislabeled_pedi_fellow:
            rotators_changed = True
            rotators.append(
                {**rotator, "program": "UT Pediatric Neurology Fellow", "schoolType": "ut-peds"}
            )
            continue
        rotators.append(rotator)

    assignments_changed = False
    inpatient_assignments: list[Any] = []
    for assignment in state.get("inpatientAssignments") or []:
        if (
            isinstance(assignment, dict)
            and assignment.get("role") == "Fellow"
            and str(assignment.get("rotatorId") or "") in psychiatry_ids
        ):
            assignments_changed = True
            inpatient_assignments.append({**assignment, "role": "Resident"})
        else:
            inpatient_assignments.append(assignment)

    if not rotators_changed and not assignments_changed:
        return state
    normalized = {**state, "rotators": rotators}
    if assignments_changed:
        normalized["inpatientAssignments"] = inpatient_assignments
    return normalized


def normalize_rotator_patch(patch: dict[str, Any] | None) -> dict[str, Any]:
    normalized = dict(patch or {})
    if "dayOff" in normalized:
        normalized["dayOff"] = normalize_day_off(normalized.get("dayOff"))
    if "unavailableRanges" in normalized:
        normalized["unavailableRanges"] = normalize_unavailable_ranges(normalized.get("unavailableRanges"))
    if "rotationStartDate" in normalized:
        normalized["rotationStartDate"] = normalize_rotation_start_date(normalized.get("rotationStartDate"))
    if "methodistStartSide" in normalized:
        normalized["methodistStartSide"] = normalize_methodist_start_side(normalized.get("methodistStartSide"))
    return normalized


def make_rotator(id_: str, full_name: str, program: str, level: str, segments: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    program = program or ""
    level = level or ""
    return {
        "id": id_,
        "fullName": full_name,
        "displayName": full_name,
        "program": program,
        "level": level,
        "role": "Fellow" if level == "Fellow" or program == "UT Pediatric Neurology Fellow" else "Student" if level.startswith("MS") else "Resident",
        "segments": normalize_segments(segments or []),
        "schoolType": infer_school_type(program),
        "continuityClinic": "Tuesday PM" if ("Adult" in program or program == "Methodist") else "",
        "dayOff": [],
        "unavailableRanges": [],
    }


def add_rotator(state: dict[str, Any], input_: dict[str, Any], now_ms: int | None = None) -> dict[str, Any]:
    timestamp = now_ms if now_ms is not None else int(time.time() * 1000)
    full_name = str(input_.get("fullName", "")).strip()
    id_ = f"rot-{slug(full_name)}-{timestamp}"
    if isinstance(input_.get("segments"), list):
        segments = input_["segments"]
    elif input_.get("startDate") and input_.get("endDate"):
        segments = [{"start": input_["startDate"], "end": input_["endDate"]}]
    else:
        segments = []
    rotator = make_rotator(id_, full_name, input_.get("program"), input_.get("level"), segments)
    if input_.get("continuityClinic") is not None:
        rotator["continuityClinic"] = input_.get("continuityClinic")
    rotation_start_date = normalize_rotation_start_date(input_.get("rotationStartDate"))
    if rotation_start_date:
        rotator["rotationStartDate"] = rotation_start_date
    methodist_start_side = normalize_methodist_start_side(input_.get("methodistStartSide"))
    if methodist_start_side:
        rotator["methodistStartSide"] = methodist_start_side
    if "dayOff" in input_:
        rotator["dayOff"] = normalize_day_off(input_.get("dayOff"))
    if "unavailableRanges" in input_:
        rotator["unavailableRanges"] = normalize_unavailable_ranges(input_.get("unavailableRanges"))
    return {**state, "rotators": [*(state.get("rotators") or []), rotator]}


def update_rotator(state: dict[str, Any], rotator_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    normalized_patch = normalize_rotator_patch(patch)
    return {
        **state,
        "rotators": [
            {**rotator, **normalized_patch} if rotator.get("id") == rotator_id else rotator
            for rotator in state.get("rotators", [])
        ],
    }


def remove_rotator(state: dict[str, Any], rotator_id: str) -> dict[str, Any]:
    return {
        **state,
        "rotators": [rotator for rotator in state.get("rotators", []) if rotator.get("id") != rotator_id],
        "inpatientAssignments": [
            assignment
            for assignment in state.get("inpatientAssignments", [])
            if assignment.get("rotatorId") != rotator_id
        ],
        "outpatientSessions": [
            session
            for session in state.get("outpatientSessions", [])
            if session.get("rotatorId") != rotator_id
        ],
        "clinicAssignments": [
            assignment
            for assignment in state.get("clinicAssignments", [])
            if assignment.get("rotatorId") != rotator_id
        ],
    }


def remove_rotators(state: dict[str, Any], rotator_ids: list[str] | set[str]) -> dict[str, Any]:
    ids = set(rotator_ids or [])
    if not ids:
        return state
    return {
        **state,
        "rotators": [rotator for rotator in state.get("rotators", []) if rotator.get("id") not in ids],
        "inpatientAssignments": [
            assignment
            for assignment in state.get("inpatientAssignments", [])
            if assignment.get("rotatorId") not in ids
        ],
        "outpatientSessions": [
            session
            for session in state.get("outpatientSessions", [])
            if session.get("rotatorId") not in ids
        ],
        "clinicAssignments": [
            assignment
            for assignment in state.get("clinicAssignments", [])
            if assignment.get("rotatorId") not in ids
        ],
    }


def dedupe_rotators_by_name(state: dict[str, Any]) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for rotator in state.get("rotators", []) or []:
        key = str(rotator.get("fullName") or "").strip().lower()
        if not key:
            continue
        groups.setdefault(key, []).append(rotator)

    deduped_rotators: list[dict[str, Any]] = []
    id_remap: dict[str, str] = {}
    removed_count = 0

    for group in groups.values():
        keeper = group[0]
        segments: list[dict[str, Any]] = []
        segment_keys: set[str] = set()
        for member in group:
            id_remap[member.get("id")] = keeper.get("id")
            for segment in member.get("segments") or []:
                normalized = normalize_segment(segment)
                if not normalized:
                    continue
                key = f"{normalized['start']}|{normalized['end']}"
                if key in segment_keys:
                    if normalized.get("defaultPhase"):
                        existing = next(
                            (
                                item
                                for item in segments
                                if item.get("start") == normalized["start"] and item.get("end") == normalized["end"]
                            ),
                            None,
                        )
                        if existing is not None and not existing.get("defaultPhase"):
                            existing["defaultPhase"] = normalized["defaultPhase"]
                    continue
                segment_keys.add(key)
                segments.append(normalized)
        segments.sort(key=lambda item: (item.get("start") or "", item.get("end") or ""))
        deduped_rotators.append({**keeper, "segments": segments})
        removed_count += len(group) - 1

    def repoint(item: dict[str, Any]) -> dict[str, Any]:
        rotator_id = item.get("rotatorId")
        next_id = id_remap.get(rotator_id)
        if next_id and next_id != rotator_id:
            return {**item, "rotatorId": next_id}
        return item

    return {
        "state": {
            **state,
            "rotators": deduped_rotators,
            "inpatientAssignments": [repoint(item) for item in state.get("inpatientAssignments", [])],
            "outpatientSessions": [repoint(item) for item in state.get("outpatientSessions", [])],
            "clinicAssignments": [repoint(item) for item in state.get("clinicAssignments", [])],
        },
        "removedCount": removed_count,
    }
