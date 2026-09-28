"""Planning-grid projection helpers.

Python port of the core shape from shared/scheduler/scheduler.js::buildPlanningGrid
plus the completion buckets from shared/scheduler/derived-views.js.
"""

from __future__ import annotations

from typing import Any

from backend_py.domain.calendar_utils import date_range, weekday_name
from backend_py.domain.draft import (
    get_rotator_phase,
    get_rotator_segment_phase,
    is_rotator_active_on,
    is_rotator_unavailable,
)


SECTION_IDS = ["needs", "mixed", "fullyIp", "fullyOp", "unavailable"]


def build_planning_grid(state: dict[str, Any] | None, block: dict[str, Any] | None) -> dict[str, Any]:
    if not state or not block or not block.get("startDate") or not block.get("endDate"):
        return {"dates": [], "rows": [], "totals": [], "sections": _empty_sections()}

    dates = date_range(block["startDate"], block["endDate"])
    ip_by_key: dict[str, list[dict[str, Any]]] = {}
    for item in state.get("inpatientAssignments") or []:
        key = f"{item.get('date')}|{item.get('rotatorId')}"
        ip_by_key.setdefault(key, []).append(item)

    op_by_key: dict[str, list[dict[str, Any]]] = {}
    for item in state.get("outpatientSessions") or []:
        key = f"{item.get('date')}|{item.get('rotatorId')}"
        op_by_key.setdefault(key, []).append(item)

    no_clinic_holidays = {
        item.get("date")
        for item in block.get("holidays") or []
        if isinstance(item, dict) and item.get("noClinic")
    }

    def is_weekend(date: str) -> bool:
        return weekday_name(date) in {"Saturday", "Sunday"}

    def is_off_calendar(date: str) -> bool:
        return is_weekend(date) or date in no_clinic_holidays

    rows = []
    for rotator in state.get("rotators") or []:
        cells = []
        rotator_id = rotator.get("id")
        for date in dates:
            if not is_rotator_active_on(rotator, date):
                cells.append({"date": date, "status": "absent"})
                continue

            unavailable = is_rotator_unavailable(rotator, date)
            ip_bucket = ip_by_key.get(f"{date}|{rotator_id}", [])
            op_bucket = op_by_key.get(f"{date}|{rotator_id}", [])
            real_ip = [item for item in ip_bucket if item.get("role") != "Off"]
            marked_off = any(item.get("role") == "Off" for item in ip_bucket)

            if unavailable and not real_ip and not op_bucket:
                cells.append(
                    {
                        "date": date,
                        "status": "off",
                        "reason": unavailable.get("reason"),
                        "label": unavailable.get("label"),
                    }
                )
            elif marked_off and not real_ip and not op_bucket:
                cells.append({"date": date, "status": "off", "reason": "marked-off"})
            elif real_ip and op_bucket:
                cells.append({"date": date, "status": "both", "ip": real_ip, "op": op_bucket})
            elif real_ip:
                cells.append({"date": date, "status": "inpatient", "ip": real_ip})
            elif op_bucket:
                cells.append({"date": date, "status": "outpatient", "op": op_bucket})
            elif is_weekend(date) and _is_outpatient_phase_on(rotator, date):
                cells.append({"date": date, "status": "off", "reason": "weekend-op"})
            else:
                cells.append({"date": date, "status": "unassigned", "offCalendar": is_off_calendar(date)})
        rows.append({"rotator": rotator, "cells": cells})

    totals = []
    for index, date in enumerate(dates):
        total = {"date": date, "ip": 0, "op": 0, "both": 0, "unassigned": 0, "present": 0}
        for row in rows:
            cell = row["cells"][index]
            if cell["status"] in {"absent", "off"}:
                continue
            total["present"] += 1
            if cell["status"] == "inpatient":
                total["ip"] += 1
            elif cell["status"] == "outpatient":
                total["op"] += 1
            elif cell["status"] == "both":
                total["ip"] += 1
                total["op"] += 1
                total["both"] += 1
            elif cell["status"] == "unassigned":
                total["unassigned"] += 1
        totals.append(total)

    return {
        "dates": dates,
        "rows": rows,
        "totals": totals,
        "sections": group_planning_rows_by_section(rows),
    }


def group_planning_rows_by_section(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    buckets = _empty_sections()
    for row in rows:
        buckets[_classify_row(row.get("cells") or [])].append(row)
    for key in buckets:
        buckets[key].sort(key=lambda row: str((row.get("rotator") or {}).get("displayName") or "").lower())
    return buckets


def _empty_sections() -> dict[str, list[dict[str, Any]]]:
    return {key: [] for key in SECTION_IDS}


def _classify_row(cells: list[dict[str, Any]]) -> str:
    ip = 0
    op = 0
    unassigned = 0
    present_at_all = False
    for cell in cells:
        status = cell.get("status")
        if status != "absent":
            present_at_all = True
        if status == "inpatient":
            ip += 1
        elif status == "outpatient":
            op += 1
        elif status == "both":
            ip += 1
            op += 1
        elif status == "unassigned" and not cell.get("offCalendar"):
            unassigned += 1
    if not present_at_all:
        return "unavailable"
    if unassigned > 0:
        return "needs"
    if ip > 0 and op > 0:
        return "mixed"
    if ip > 0:
        return "fullyIp"
    if op > 0:
        return "fullyOp"
    return "unavailable"


def _is_outpatient_phase_on(rotator: dict[str, Any], date: str) -> bool:
    return (
        get_rotator_segment_phase(rotator, date) == "outpatient"
        or get_rotator_phase(rotator, date) == "outpatient"
    )
