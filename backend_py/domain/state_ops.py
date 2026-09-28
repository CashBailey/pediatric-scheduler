"""Whole-state mutators — Python port of the small, pure state helpers in
shared/scheduler/scheduler.js.

Every function here takes the full scheduler state and returns a NEW state
(never mutates the input), mirroring the JS engine's copy-on-write style so
the command layer and the client's undo stack can rely on structural sharing.
This module starts with the leaf mutators the command endpoint needs first;
heavier operations (assignment writers, the draft engine) land in later
modules per the port roadmap.
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any

DEFAULT_POSTER_SETTINGS = {
    "programName": "Pediatric Neurology Residency",
    "chief": "",
    "notes": [
        "Please arrive 15 minutes before clinic starts.",
        "Check Epic for patient lists and clinic location details.",
        "Notify the chief of any schedule conflicts as soon as possible.",
        "This schedule is subject to change.",
    ],
    "locations": [
        {"name": "Main Campus", "address": ""},
    ],
    "tagline": "Thank you for all you do for our patients!",
}


def update_rules(state: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Shallow-merge patch over state.rules. Mirrors scheduler.js updateRules:
    { ...state, rules: { ...state.rules, ...patch } }."""
    return {**state, "rules": {**(state.get("rules") or {}), **(patch or {})}}


def set_attendings(state: dict[str, Any], attendings: list[Any]) -> dict[str, Any]:
    """Replace the attending profile list; mirrors scheduler.js setAttendings."""
    return {**state, "attendings": attendings if isinstance(attendings, list) else []}


def set_expected_source_programs(state: dict[str, Any], programs: list[Any]) -> dict[str, Any]:
    """Replace expected source programs; mirrors scheduler.js setExpectedSourcePrograms."""
    return {**state, "expectedSourcePrograms": programs if isinstance(programs, list) else []}


def remove_source(state: dict[str, Any], source_id: str) -> dict[str, Any]:
    """Remove a reviewed source record without touching imported providers."""
    sources = state.get("sources") if isinstance(state.get("sources"), list) else []
    return {
        **state,
        "sources": [
            source
            for source in sources
            if not (isinstance(source, dict) and source.get("id") == source_id)
        ],
    }


def add_source(state: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    """Append a reviewed manual source record without changing imported providers."""
    sources = state.get("sources") if isinstance(state.get("sources"), list) else []
    file_name = str((source or {}).get("fileName") or "Manual source").strip() or "Manual source"
    source_id = str((source or {}).get("id") or "").strip()
    if not source_id:
        source_id = f"source-{_slug(file_name)}-{int(time.time() * 1000)}"
    existing_ids = {item.get("id") for item in sources if isinstance(item, dict)}
    base_id = source_id
    suffix = 2
    while source_id in existing_ids:
        source_id = f"{base_id}-{suffix}"
        suffix += 1
    record = {
        "id": source_id,
        "importedAt": (source or {}).get("importedAt") or datetime.now(timezone.utc).date().isoformat(),
        "status": (source or {}).get("status") or "Reviewed",
        "program": (source or {}).get("program") or "Other",
        "fileName": file_name,
        "fileType": (source or {}).get("fileType") or "manual",
        "content": (source or {}).get("content") or "",
        "parsedRows": (source or {}).get("parsedRows") if isinstance((source or {}).get("parsedRows"), list) else [],
        "importWarnings": (source or {}).get("importWarnings") if isinstance((source or {}).get("importWarnings"), list) else [],
    }
    # Omit importWarningCount entirely when absent — the JS engine never
    # writes the key for manual sources, and scheduler-state.v1 declares it
    # as an integer, so a null here fails validation.
    warning_count = (source or {}).get("importWarningCount")
    if isinstance(warning_count, int):
        record["importWarningCount"] = warning_count
    return {**state, "sources": [*sources, record]}


def update_poster_settings(state: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Shallow-merge patch over editable poster metadata."""
    return {
        **state,
        "posterSettings": {
            **DEFAULT_POSTER_SETTINGS,
            **(state.get("posterSettings") or {}),
            **(patch or {}),
        },
    }


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "source"
