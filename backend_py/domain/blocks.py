"""Service block mutators ported from shared/scheduler/scheduler.js."""

from __future__ import annotations

import datetime
import time
from typing import Any

from backend_py.domain.calendar_utils import add_days_to_iso


def active_block(state: dict[str, Any]) -> dict[str, Any] | None:
    blocks = state.get("serviceBlocks") or []
    active_id = state.get("activeBlockId")
    return next((block for block in blocks if block.get("id") == active_id), None) or (blocks[0] if blocks else None)


def add_service_block(state: dict[str, Any], overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    overrides = overrides or {}
    existing = state.get("serviceBlocks") or []
    latest_end = sorted(block.get("endDate") for block in existing if block.get("endDate"))
    start_date = overrides.get("startDate") or (
        add_days_to_iso(latest_end[-1], 1) if latest_end else datetime.date.today().isoformat()
    )
    end_date = overrides.get("endDate") or add_days_to_iso(start_date, 27)

    base_id = f"block-{int(time.time() * 1000)}"
    block_id = base_id
    suffix = 2
    while any(block.get("id") == block_id for block in existing):
        block_id = f"{base_id}-{suffix}"
        suffix += 1

    block = {
        "id": block_id,
        "name": overrides.get("name") or "New rotation block",
        "startDate": start_date,
        "endDate": end_date,
        "status": "Draft",
        "generate": {
            "inpatient": True,
            "outpatient": True,
            "dailyReport": True,
            "legend": True,
            "export": True,
        },
        "holidays": [],
    }
    return {**state, "serviceBlocks": [*existing, block], "activeBlockId": block_id}


def set_active_block(state: dict[str, Any], block_id: str) -> dict[str, Any]:
    if not any(block.get("id") == block_id for block in state.get("serviceBlocks") or []):
        return state
    return {**state, "activeBlockId": block_id}


def update_block(state: dict[str, Any], block_patch: dict[str, Any]) -> dict[str, Any]:
    return {
        **state,
        "serviceBlocks": [
            {**block, **block_patch} if block.get("id") == state.get("activeBlockId") else block
            for block in state.get("serviceBlocks") or []
        ],
    }


def remove_service_block(state: dict[str, Any], block_id: str) -> dict[str, Any]:
    existing = state.get("serviceBlocks") or []
    if len(existing) <= 1:
        return {
            "state": state,
            "ok": False,
            "reason": "Can't delete the only block. Add another block first, then delete this one.",
        }
    if not any(block.get("id") == block_id for block in existing):
        return {"state": state, "ok": False, "reason": "That block isn't in the list."}

    remaining = [block for block in existing if block.get("id") != block_id]
    next_active = remaining[0].get("id") if state.get("activeBlockId") == block_id else state.get("activeBlockId")
    return {
        "state": {**state, "serviceBlocks": remaining, "activeBlockId": next_active},
        "ok": True,
        "reason": None,
    }
