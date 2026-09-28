"""Command dispatcher — Python port of shared/scheduler/commands.js
::executeSchedulerCommand.

The React client funnels every mutation through a single command dispatcher;
the native macOS client does the same over POST /api/scheduler/command. This
module is the server-side twin: one entry point, `execute_scheduler_command`,
that maps a `{type, input}` command onto a pure state mutator and returns a
uniform result envelope.

Result envelope (matches commands.js exactly so the contract is identical
whichever client calls it):
  success -> {ok: True,  type, state, changed, message, data, [warnings]}
  failure -> {ok: False, type, state, changed: False, error: {code, message, ...}}

Port status: scheduler rules, service block management, draft generation,
range assignment, planning-grid projection, inpatient/outpatient assignment,
daily reports, export packages/PDFs/Word docs, rotator roster editing/cleanup, and clinic
attending/source program management are live. The remaining commands slot in
here as their underlying engine functions are ported — the dispatch table +
envelope helpers are shared so each addition is just one handler.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable

from backend_py.domain.assignments import (
    apply_range_assignment,
    remove_inpatient_assignment,
    remove_outpatient_session,
    schedule_outpatient_session,
)
from backend_py.domain.blocks import add_service_block, remove_service_block, set_active_block, update_block
from backend_py.domain.calendar_utils import extend_block_end, extend_block_start, weekday_name
from backend_py.domain.clinics import assign_clinic, unassign_clinic
from backend_py.domain.draft import (
    apply_methodist_auto_assign,
    apply_preassignments,
    choose_methodist_start_side,
    classify_rotator,
    methodist_rotation_window,
    generate_draft,
    is_rotator_active_on,
    is_rotator_unavailable,
    schedule_inpatient_assignment,
    validate_drop,
)
from backend_py.domain.exports import build_export_package
from backend_py.domain.coordinator_exports import build_coordinator_bundle
from backend_py.domain.pdf_exports import build_pdf_exports
from backend_py.domain.planning import build_planning_grid
from backend_py.domain.reports import detect_conflicts, generate_daily_report
from backend_py.domain.rotators import add_rotator, dedupe_rotators_by_name, remove_rotator, remove_rotators, update_rotator
from backend_py.domain.state_ops import (
    add_source,
    remove_source,
    set_attendings,
    set_expected_source_programs,
    update_poster_settings,
    update_rules,
)
from backend_py.domain.word_exports import build_word_exports

Command = dict[str, Any]
Result = dict[str, Any]
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ASSIGNMENT_PHASES = {"inpatient", "outpatient", "off", "clear"}
PERIODS = {"AM", "PM"}
POST_FINAL_LEDGER_EXEMPT_COMMANDS = {"block.add", "block.use", "block.delete"}


def _input_of(command: Command) -> dict[str, Any]:
    """Mirror commands.js inputOf: merge command.input with any sibling keys
    (so both {type, input:{...}} and {type, ...args} shapes work)."""
    rest = {k: v for k, v in (command or {}).items() if k not in ("type", "input")}
    return {**((command or {}).get("input") or {}), **rest}


def _ok(
    type_: str,
    state: dict,
    next_state: dict,
    message: str,
    data: dict | None = None,
    warnings: list | None = None,
) -> Result:
    result: Result = {
        "ok": True,
        "type": type_,
        "state": next_state,
        "changed": next_state is not state,
        "message": message,
        "data": data or {},
    }
    if warnings:
        result["warnings"] = warnings
    return result


def _fail(type_: str, state: dict, code: str, message: str, **extra: Any) -> Result:
    return {
        "ok": False,
        "type": type_,
        "state": state,
        "changed": False,
        "error": {"code": code, "message": message, **extra},
    }


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _is_final_block(block: dict | None) -> bool:
    return str((block or {}).get("status") or "").lower() == "final"


def _ledger_block_id(state: dict, input_: dict) -> str | None:
    block_ref = input_.get("blockRef") or input_.get("blockId") or input_.get("name")
    if block_ref:
        try:
            return _resolve_block(state, block_ref).get("id")
        except _ReferenceError:
            return None
    block = _active_block(state)
    return block.get("id") if block else None


def _post_final_reason(type_: str, input_: dict) -> str:
    explicit = input_.get("postFinalReason") or input_.get("changeReason") or input_.get("reason")
    reason = str(explicit or "").strip()
    return reason or f"{type_} after finalization"


def _with_post_final_change(state: dict, type_: str, input_: dict, result: Result) -> Result:
    if not result.get("ok") or not result.get("changed"):
        return result
    if type_ in POST_FINAL_LEDGER_EXEMPT_COMMANDS:
        return result
    next_state = result.get("state")
    if not isinstance(next_state, dict):
        return result

    block_id = _ledger_block_id(state, input_)
    before_block = next((block for block in state.get("serviceBlocks") or [] if block.get("id") == block_id), None)
    if not block_id or not _is_final_block(before_block):
        return result

    after_blocks = next_state.get("serviceBlocks") if isinstance(next_state.get("serviceBlocks"), list) else []
    if not any(block.get("id") == block_id for block in after_blocks):
        return result

    existing = before_block.get("postFinalChanges") if isinstance(before_block.get("postFinalChanges"), list) else []
    changed_at = _utc_now_iso()
    entry = {
        "id": f"post-final-{len(existing) + 1}-{changed_at.replace(':', '').replace('-', '')}",
        "blockId": block_id,
        "changedAt": changed_at,
        "changedBy": str(input_.get("changedBy") or "scheduler-command"),
        "command": type_,
        "reason": _post_final_reason(type_, input_),
        "summary": result.get("message") or "",
    }
    next_blocks = [
        (
            {
                **block,
                "postFinalChanges": [
                    *(block.get("postFinalChanges") if isinstance(block.get("postFinalChanges"), list) else []),
                    entry,
                ],
            }
            if block.get("id") == block_id
            else block
        )
        for block in after_blocks
    ]
    return {
        **result,
        "state": {**next_state, "serviceBlocks": next_blocks},
        "data": {**(result.get("data") or {}), "postFinalChange": entry},
    }


def _require_value(type_: str, state: dict, input_: dict, field: str) -> Result | None:
    value = input_.get(field)
    if value is None or value == "":
        return _fail(type_, state, "missing_field", f"{field} is required", field=field)
    return None


def _require_iso_date(type_: str, state: dict, input_: dict, field: str) -> Result | None:
    missing = _require_value(type_, state, input_, field)
    if missing:
        return missing
    if not ISO_DATE.match(str(input_.get(field))):
        return _fail(type_, state, "invalid_date", f"{field} must be YYYY-MM-DD", field=field, value=input_.get(field))
    return None


def _first_error(*checks: Result | None) -> Result | None:
    return next((check for check in checks if check), None)


def _is_plain_object(value: Any) -> bool:
    return isinstance(value, dict)


def _optional_patch_object(type_: str, state: dict, input_: dict) -> tuple[dict[str, Any] | None, Result | None]:
    if "patch" not in input_:
        return {}, None
    patch = input_.get("patch")
    if not _is_plain_object(patch):
        return None, _fail(type_, state, "invalid_type", "patch must be an object", field="patch", value=patch)
    return patch, None


def _invalid_type(type_: str, state: dict, field: str, message: str, value: Any) -> Result:
    return _fail(type_, state, "invalid_type", message, field=field, value=value)


class _ReferenceError(Exception):
    def __init__(self, code: str, message: str, field: str, value: Any):
        super().__init__(message)
        self.code = code
        self.field = field
        self.value = value


def _resolve_block(state: dict, block_ref: Any = None) -> dict:
    if not block_ref:
        block = _active_block(state)
        if block:
            return block
        raise _ReferenceError("block_not_found", "block not found: None", "blockRef", block_ref)
    for block in state.get("serviceBlocks") or []:
        if block.get("id") == block_ref or block.get("name") == block_ref:
            return block
    raise _ReferenceError("block_not_found", f"block not found: {block_ref}", "blockRef", block_ref)


def _resolve_rotator(state: dict, rotator_ref: Any) -> dict:
    for rotator in state.get("rotators") or []:
        if rotator.get("id") == rotator_ref or rotator.get("fullName") == rotator_ref or rotator.get("displayName") == rotator_ref:
            return rotator
    raise _ReferenceError("rotator_not_found", f"rotator not found: {rotator_ref}", "rotatorRef", rotator_ref)


def _resolve_error(type_: str, state: dict, error: _ReferenceError) -> Result:
    return _fail(type_, state, error.code or "invalid_reference", str(error), field=error.field, value=error.value)


# --- handlers ---------------------------------------------------------------


def _cmd_rules_patch(state: dict, type_: str, input_: dict) -> Result:
    patch, error = _optional_patch_object(type_, state, input_)
    if error:
        return error
    next_state = update_rules(state, patch)
    return _ok(type_, state, next_state, "Updated scheduler rules.", {"patch": patch})


def _validate_poster_patch(state: dict, type_: str, patch: dict[str, Any]) -> Result | None:
    for field in ("programName", "chief", "tagline"):
        if patch.get(field) is not None and not isinstance(patch.get(field), str):
            return _invalid_type(type_, state, field, f"{field} must be a string", patch.get(field))
    notes = patch.get("notes")
    if notes is not None and (
        not isinstance(notes, list) or any(not isinstance(note, str) for note in notes)
    ):
        return _invalid_type(type_, state, "notes", "notes must be an array of strings", notes)
    locations = patch.get("locations")
    if locations is not None:
        if not isinstance(locations, list):
            return _invalid_type(type_, state, "locations", "locations must be an array", locations)
        invalid_location = next(
            (
                location for location in locations
                if not isinstance(location, dict)
                or (location.get("name") is not None and not isinstance(location.get("name"), str))
                or (location.get("address") is not None and not isinstance(location.get("address"), str))
            ),
            None,
        )
        if invalid_location is not None:
            return _invalid_type(
                type_,
                state,
                "locations",
                "locations must contain objects with string name/address fields",
                invalid_location,
            )
    return None


def _cmd_poster_settings_patch(state: dict, type_: str, input_: dict) -> Result:
    patch, error = _optional_patch_object(type_, state, input_)
    if error:
        return error
    invalid_patch = _validate_poster_patch(state, type_, patch)
    if invalid_patch:
        return invalid_patch
    next_state = update_poster_settings(state, patch)
    return _ok(type_, state, next_state, "Updated poster settings.", {"patch": patch})


def _cmd_attending_add(state: dict, type_: str, input_: dict) -> Result:
    error = _require_value(type_, state, input_, "name")
    if error:
        return error
    name = str(input_.get("name") or "").strip()
    if not name:
        return _fail(type_, state, "missing_field", "name is required", field="name")
    existing = state.get("attendings") if isinstance(state.get("attendings"), list) else []
    has_duplicate = any(
        str((attending or {}).get("name") or "").lower() == name.lower()
        for attending in existing
        if isinstance(attending, dict)
    )
    if has_duplicate:
        return _fail(type_, state, "no_effect", f"{name} is already in the attendings list.", field="name", value=name)
    next_state = set_attendings(
        state,
        [
            *existing,
            {"name": name, "recurringClinics": [], "oneOffDates": []},
        ],
    )
    return _ok(type_, state, next_state, f"Added {name} to the attendings list.", {"name": name})


def _cmd_attending_remove(state: dict, type_: str, input_: dict) -> Result:
    error = _require_value(type_, state, input_, "name")
    if error:
        return error
    name = str(input_.get("name"))
    existing = state.get("attendings") if isinstance(state.get("attendings"), list) else []
    next_state = set_attendings(
        state,
        [
            attending for attending in existing
            if not (isinstance(attending, dict) and attending.get("name") == name)
        ],
    )
    return _ok(type_, state, next_state, f"Removed {name} from the attendings list.", {"name": name})


def _cmd_attending_update(state: dict, type_: str, input_: dict) -> Result:
    error = _require_value(type_, state, input_, "name")
    if error:
        return error
    name = str(input_.get("name"))
    patch, patch_error = _optional_patch_object(type_, state, input_)
    if patch_error:
        return patch_error
    existing = state.get("attendings") if isinstance(state.get("attendings"), list) else []
    next_state = set_attendings(
        state,
        [
            (
                {**attending, **patch}
                if isinstance(attending, dict) and attending.get("name") == name
                else attending
            )
            for attending in existing
        ],
    )
    return _ok(type_, state, next_state, f"Updated attending {patch.get('name') or name}.", {"name": name})


def _cmd_expected_source_add(state: dict, type_: str, input_: dict) -> Result:
    error = _require_value(type_, state, input_, "program")
    if error:
        return error
    program = str(input_.get("program") or "").strip()
    if not program:
        return _fail(type_, state, "missing_field", "program is required", field="program")
    programs = state.get("expectedSourcePrograms") if isinstance(state.get("expectedSourcePrograms"), list) else []
    next_programs = programs if program in programs else [*programs, program]
    next_state = set_expected_source_programs(state, next_programs)
    return _ok(type_, state, next_state, f"Added expected source {program}.", {"program": program})


def _cmd_expected_source_remove(state: dict, type_: str, input_: dict) -> Result:
    error = _require_value(type_, state, input_, "program")
    if error:
        return error
    program = str(input_.get("program"))
    programs = state.get("expectedSourcePrograms") if isinstance(state.get("expectedSourcePrograms"), list) else []
    next_state = set_expected_source_programs(state, [item for item in programs if item != program])
    return _ok(type_, state, next_state, f"Removed expected source {program}.", {"program": program})


def _cmd_source_delete(state: dict, type_: str, input_: dict) -> Result:
    source_ref = input_.get("sourceId") or input_.get("sourceRef") or input_.get("id")
    if not source_ref:
        return _fail(type_, state, "missing_field", "sourceId is required", field="sourceId")
    sources = state.get("sources") if isinstance(state.get("sources"), list) else []
    source = next(
        (
            item for item in sources
            if isinstance(item, dict)
            and (item.get("id") == source_ref or item.get("fileName") == source_ref)
        ),
        None,
    )
    if not source:
        return _fail(type_, state, "source_not_found", f"source not found: {source_ref}", field="sourceId", value=source_ref)
    next_state = remove_source(state, source.get("id"))
    file_name = source.get("fileName") or source.get("id")
    return _ok(
        type_,
        state,
        next_state,
        f"Removed source {file_name}.",
        {"sourceId": source.get("id"), "fileName": file_name},
    )


def _cmd_source_add(state: dict, type_: str, input_: dict) -> Result:
    source = input_.get("source") if isinstance(input_.get("source"), dict) else {**input_}
    for field in ("id", "fileName", "fileType", "program", "status", "content", "importedAt"):
        if source.get(field) is not None and not isinstance(source.get(field), str):
            return _invalid_type(type_, state, field, f"{field} must be a string", source.get(field))
    for field in ("importedRotatorCount", "importWarningCount"):
        value = source.get(field)
        if value is not None and (type(value) is not int or value < 0):
            return _invalid_type(type_, state, field, f"{field} must be a non-negative integer", value)
    import_warnings = source.get("importWarnings")
    if import_warnings is not None and (
        not isinstance(import_warnings, list) or any(not isinstance(warning, str) for warning in import_warnings)
    ):
        return _invalid_type(type_, state, "importWarnings", "importWarnings must be an array of strings", import_warnings)
    if source.get("parsedRows") is not None and not isinstance(source.get("parsedRows"), list):
        return _invalid_type(type_, state, "parsedRows", "parsedRows must be an array", source.get("parsedRows"))
    file_name = str(source.get("fileName") or "Manual source").strip() or "Manual source"
    source_id = str(source.get("id") or "").strip()
    sources = state.get("sources") if isinstance(state.get("sources"), list) else []
    if source_id and any(isinstance(item, dict) and item.get("id") == source_id for item in sources):
        return _fail(type_, state, "duplicate_source", f"source already exists: {source_id}", field="id", value=source_id)
    next_state = add_source(state, {**source, "fileName": file_name})
    added = (next_state.get("sources") or [])[-1]
    return _ok(
        type_,
        state,
        next_state,
        f"Added source {added.get('fileName')}.",
        {"sourceId": added.get("id"), "fileName": added.get("fileName")},
    )


def _cmd_block_add(state: dict, type_: str, input_: dict) -> Result:
    has_any_override = bool(input_.get("name") or input_.get("startDate") or input_.get("endDate"))
    if has_any_override:
        error = _first_error(
            _require_value(type_, state, input_, "name"),
            _require_iso_date(type_, state, input_, "startDate"),
            _require_iso_date(type_, state, input_, "endDate"),
        )
        if error:
            return error
    next_state = add_service_block(
        state,
        {
            "name": input_.get("name"),
            "startDate": input_.get("startDate"),
            "endDate": input_.get("endDate"),
        },
    )
    block = _active_block(next_state)
    return _ok(
        type_,
        state,
        next_state,
        f"Created block {block.get('name')} ({block.get('id')}) and set it active.",
        {"blockId": block.get("id")},
    )


def _cmd_block_use(state: dict, type_: str, input_: dict) -> Result:
    block_ref = input_.get("blockRef") or input_.get("blockId") or input_.get("name")
    if not block_ref:
        return _fail(type_, state, "missing_field", "blockRef is required", field="blockRef")
    try:
        block = _resolve_block(state, block_ref)
    except _ReferenceError as exc:
        return _resolve_error(type_, state, exc)
    next_state = set_active_block(state, block["id"])
    return _ok(
        type_,
        state,
        next_state,
        f"Active block is now {block.get('name')} ({block.get('id')}).",
        {"blockId": block.get("id")},
    )


def _cmd_block_update(state: dict, type_: str, input_: dict) -> Result:
    block_ref = input_.get("blockRef") or input_.get("blockId") or input_.get("name")
    patch, error = _optional_patch_object(type_, state, input_)
    if error:
        return error
    if not block_ref:
        return _fail(type_, state, "missing_field", "blockRef is required", field="blockRef")
    if patch.get("startDate") and not ISO_DATE.match(str(patch.get("startDate"))):
        return _fail(type_, state, "invalid_date", "startDate must be YYYY-MM-DD", field="startDate")
    if patch.get("endDate") and not ISO_DATE.match(str(patch.get("endDate"))):
        return _fail(type_, state, "invalid_date", "endDate must be YYYY-MM-DD", field="endDate")
    try:
        block = _resolve_block(state, block_ref)
    except _ReferenceError as exc:
        return _resolve_error(type_, state, exc)
    if state.get("activeBlockId") == block.get("id"):
        next_state = update_block(state, patch)
    else:
        next_state = {
            **state,
            "serviceBlocks": [
                {**item, **patch} if item.get("id") == block.get("id") else item
                for item in state.get("serviceBlocks") or []
            ],
        }
    return _ok(
        type_,
        state,
        next_state,
        f"Updated block {patch.get('name') or block.get('name')}.",
        {"blockId": block.get("id")},
    )


def _cmd_block_delete(state: dict, type_: str, input_: dict) -> Result:
    block_ref = input_.get("blockRef") or input_.get("blockId") or input_.get("name")
    if not block_ref:
        return _fail(type_, state, "missing_field", "blockRef is required", field="blockRef")
    try:
        block = _resolve_block(state, block_ref)
    except _ReferenceError as exc:
        return _resolve_error(type_, state, exc)
    result = remove_service_block(state, block["id"])
    if not result.get("ok"):
        return _fail(
            type_,
            state,
            "no_effect",
            result.get("reason") or f"Could not delete {block.get('name')}",
            blockId=block.get("id"),
        )
    return _ok(type_, state, result["state"], f"Deleted block {block.get('name')}.", {"blockId": block.get("id")})


def _cmd_rotator_add(state: dict, type_: str, input_: dict) -> Result:
    error = _first_error(
        _require_value(type_, state, input_, "fullName"),
        _require_value(type_, state, input_, "program"),
        _require_value(type_, state, input_, "level"),
    )
    if error:
        return error
    next_state = add_rotator(state, input_)
    rotator = next_state.get("rotators", [])[-1]
    return _ok(
        type_,
        state,
        next_state,
        f"Added rotator {rotator.get('fullName')} ({rotator.get('id')}).",
        {"rotatorId": rotator.get("id")},
    )


def _cmd_rotator_update(state: dict, type_: str, input_: dict) -> Result:
    patch, error = _optional_patch_object(type_, state, input_)
    if error:
        return error
    rotator_ref = input_.get("rotatorRef") or input_.get("rotatorId")
    if not rotator_ref:
        return _fail(type_, state, "missing_field", "rotatorRef is required", field="rotatorRef")
    try:
        rotator = _resolve_rotator(state, rotator_ref)
    except _ReferenceError as exc:
        return _resolve_error(type_, state, exc)
    next_state = update_rotator(state, rotator["id"], patch)
    return _ok(
        type_,
        state,
        next_state,
        f"Updated rotator {patch.get('fullName') or rotator.get('fullName')}.",
        {"rotatorId": rotator.get("id")},
    )


def _cmd_rotator_delete(state: dict, type_: str, input_: dict) -> Result:
    rotator_ref = input_.get("rotatorRef") or input_.get("rotatorId")
    if not rotator_ref:
        return _fail(type_, state, "missing_field", "rotatorRef is required", field="rotatorRef")
    try:
        rotator = _resolve_rotator(state, rotator_ref)
    except _ReferenceError as exc:
        return _resolve_error(type_, state, exc)
    next_state = remove_rotator(state, rotator["id"])
    return _ok(
        type_,
        state,
        next_state,
        f"Deleted rotator {rotator.get('fullName')}.",
        {"rotatorId": rotator.get("id")},
    )


def _cmd_rotators_delete(state: dict, type_: str, input_: dict) -> Result:
    refs = input_.get("rotatorRefs") or input_.get("rotatorIds") or []
    if not isinstance(refs, list) or not refs:
        return _fail(type_, state, "missing_field", "rotatorRefs is required", field="rotatorRefs")
    try:
        rotator_ids = [_resolve_rotator(state, ref)["id"] for ref in refs]
    except _ReferenceError as exc:
        return _resolve_error(type_, state, exc)
    next_state = remove_rotators(state, rotator_ids)
    return _ok(type_, state, next_state, f"Deleted {len(rotator_ids)} rotators.", {"rotatorIds": rotator_ids})


def _cmd_roster_dedupe(state: dict, type_: str, input_: dict) -> Result:
    result = dedupe_rotators_by_name(state)
    return _ok(
        type_,
        state,
        result["state"],
        f"Removed {result['removedCount']} duplicate rotators.",
        {"removedCount": result["removedCount"]},
    )


def _active_block(state: dict) -> dict | None:
    blocks = state.get("serviceBlocks") or []
    active_id = state.get("activeBlockId")
    return next((block for block in blocks if block.get("id") == active_id), None) or (blocks[0] if blocks else None)


def _cmd_inpatient_draft(state: dict, type_: str, input_: dict) -> Result:
    block = _active_block(state)
    if not block:
        return _fail(type_, state, "block_not_found", "No active block is available.")
    preassigned = apply_preassignments(state, block)
    result = generate_draft(preassigned, block, baseline_state=state)
    next_state = result["state"]
    report = result["report"]
    summary = report.get("summary") or {}
    inpatient_added = summary.get("inpatientAdded") or 0
    outpatient_added = summary.get("outpatientAdded") or 0
    total_added = inpatient_added + outpatient_added
    unmet = report.get("unmet") or []
    if total_added:
        message = (
            f"Generated draft schedule: added {inpatient_added} inpatient and "
            f"{outpatient_added} outpatient assignment{'s' if total_added != 1 else ''}."
        )
    elif unmet:
        message = "Draft schedule could not fill all required inpatient coverage."
    else:
        message = "Draft schedule already has required inpatient coverage."
    return _ok(
        type_,
        state,
        next_state,
        message,
        {
            "inpatientAdded": inpatient_added,
            "outpatientAdded": outpatient_added,
            "unmet": unmet,
            "report": report,
        },
    )


def _cmd_methodist_auto(state: dict, type_: str, input_: dict) -> Result:
    try:
        block = _resolve_block(state, input_.get("blockRef") or input_.get("blockId"))
    except _ReferenceError as exc:
        return _resolve_error(type_, state, exc)

    methodist_count = len([rotator for rotator in state.get("rotators") or [] if classify_rotator(rotator) == "methodist"])
    if methodist_count == 0:
        return _ok(
            type_,
            state,
            state,
            "No Methodist rotators are in the roster.",
            {"methodistCount": 0, "inpatientAdded": 0, "outpatientAdded": 0, "startSidesSet": 0},
        )

    start_sides_set = 0
    rotators = []
    for rotator in state.get("rotators") or []:
        if classify_rotator(rotator) == "methodist" and methodist_rotation_window(rotator) and not rotator.get("methodistStartSide"):
            rotators.append({**rotator, "methodistStartSide": choose_methodist_start_side(rotator, block)})
            start_sides_set += 1
        else:
            rotators.append(rotator)

    working = {**state, "rotators": rotators} if start_sides_set else state
    next_state = apply_methodist_auto_assign(working, block)
    inpatient_added = len(next_state.get("inpatientAssignments") or []) - len(state.get("inpatientAssignments") or [])
    outpatient_added = len(next_state.get("outpatientSessions") or []) - len(state.get("outpatientSessions") or [])
    total_added = inpatient_added + outpatient_added
    if total_added:
        message = (
            f"Generated Methodist 14/14 schedule for {methodist_count} provider"
            f"{'' if methodist_count == 1 else 's'}."
        )
    elif start_sides_set:
        message = (
            f"Computed Methodist start side for {start_sides_set} provider"
            f"{'' if start_sides_set == 1 else 's'}."
        )
    else:
        message = "Methodist 14/14 schedule is already up to date."
    return _ok(
        type_,
        state,
        next_state,
        message,
        {
            "methodistCount": methodist_count,
            "inpatientAdded": inpatient_added,
            "outpatientAdded": outpatient_added,
            "startSidesSet": start_sides_set,
        },
    )


def _cmd_assign_range(state: dict, type_: str, input_: dict) -> Result:
    error = _first_error(
        _require_value(type_, state, input_, "rotatorRef"),
        _require_iso_date(type_, state, input_, "startDate"),
        _require_iso_date(type_, state, input_, "endDate"),
        _require_value(type_, state, input_, "phase"),
    )
    if error:
        return error
    if input_.get("phase") not in ASSIGNMENT_PHASES:
        return _fail(
            type_,
            state,
            "invalid_enum",
            "phase must be inpatient, outpatient, off, or clear",
            field="phase",
            value=input_.get("phase"),
        )
    try:
        block = _resolve_block(state, input_.get("blockRef") or input_.get("blockId"))
        rotator = _resolve_rotator(state, input_.get("rotatorRef") or input_.get("rotatorId"))
    except _ReferenceError as exc:
        return _resolve_error(type_, state, exc)
    next_state = apply_range_assignment(
        state,
        block,
        {
            "rotatorId": rotator["id"],
            "startDate": input_["startDate"],
            "endDate": input_["endDate"],
            "phase": input_["phase"],
            "role": input_.get("role"),
            "clinic": input_.get("clinic"),
        },
    )
    label = rotator.get("displayName") or rotator.get("fullName")
    if next_state is state:
        message = f"No changes for {label}: no applicable days from {input_['startDate']} to {input_['endDate']}."
    else:
        message = f"Assigned {label} {input_['phase']} from {input_['startDate']} to {input_['endDate']} in {block.get('name')}."
    return _ok(
        type_,
        state,
        next_state,
        message,
        {
            "blockId": block.get("id"),
            "rotatorId": rotator.get("id"),
            "phase": input_["phase"],
            "startDate": input_["startDate"],
            "endDate": input_["endDate"],
        },
    )


def _invalid_inpatient_reason(block: dict | None, state: dict, rotator: dict, date: str) -> str | None:
    if not block or date < block.get("startDate", "") or date > block.get("endDate", ""):
        return f"Date {date} is outside the active block."
    check = validate_drop(state, rotator.get("id"), date)
    return None if check.get("valid") else (check.get("reason") or "Inpatient assignment is not allowed.")


def _cmd_inpatient_assign(state: dict, type_: str, input_: dict) -> Result:
    error = _first_error(
        _require_value(type_, state, input_, "rotatorRef"),
        _require_iso_date(type_, state, input_, "date"),
    )
    if error:
        return error
    try:
        block = _resolve_block(state, input_.get("blockRef") or input_.get("blockId"))
        rotator = _resolve_rotator(state, input_.get("rotatorRef") or input_.get("rotatorId"))
    except _ReferenceError as exc:
        return _resolve_error(type_, state, exc)

    invalid_reason = _invalid_inpatient_reason(block, state, rotator, input_["date"])
    if invalid_reason:
        return _fail(
            type_,
            state,
            "invalid_inpatient_assignment",
            invalid_reason,
            rotatorId=rotator.get("id"),
            date=input_["date"],
        )

    role = input_.get("role") or "Resident"
    next_state = schedule_inpatient_assignment(
        state,
        {
            "date": input_["date"],
            "rotatorId": rotator["id"],
            "role": role,
            "source": input_.get("source"),
        },
    )
    label = rotator.get("displayName") or rotator.get("fullName")
    return _ok(
        type_,
        state,
        next_state,
        f"Assigned {label} inpatient on {input_['date']}.",
        {
            "rotatorId": rotator.get("id"),
            "date": input_["date"],
            "role": role,
        },
    )


def _cmd_inpatient_fellow_resolve(state: dict, type_: str, input_: dict) -> Result:
    error = _require_value(type_, state, input_, "rotatorRef")
    if error:
        return error
    raw_dates = input_.get("dates") if isinstance(input_.get("dates"), list) else ([input_.get("date")] if input_.get("date") else [])
    if not raw_dates:
        return _fail(type_, state, "missing_field", "dates is required", field="dates")
    invalid_date = next((date for date in raw_dates if not ISO_DATE.match(str(date))), None)
    if invalid_date:
        return _fail(type_, state, "invalid_date", "dates must contain YYYY-MM-DD values", field="dates", value=invalid_date)
    try:
        rotator = _resolve_rotator(state, input_.get("rotatorRef") or input_.get("rotatorId"))
    except _ReferenceError as exc:
        return _resolve_error(type_, state, exc)

    next_state = state
    for date in raw_dates:
        check = validate_drop(next_state, rotator.get("id"), date, {"requiredRole": "Fellow"})
        if not check.get("valid"):
            return _fail(
                type_,
                state,
                "invalid_fellow_resolution",
                check.get("reason") or "Fellow resolution is not allowed.",
                rotatorId=rotator.get("id"),
                date=date,
            )
        next_state = schedule_inpatient_assignment(
            next_state,
            {
                "date": date,
                "rotatorId": rotator["id"],
                "role": "Fellow",
                "source": "Manual",
            },
        )

    label = rotator.get("displayName") or rotator.get("fullName")
    return _ok(
        type_,
        state,
        next_state,
        f"Resolved {len(raw_dates)} fellow assignment{'' if len(raw_dates) == 1 else 's'} for {label}.",
        {
            "rotatorId": rotator.get("id"),
            "dates": raw_dates,
            "role": "Fellow",
        },
    )


def _cmd_inpatient_drop(state: dict, type_: str, input_: dict) -> Result:
    error = _first_error(
        _require_value(type_, state, input_, "rotatorRef"),
        _require_iso_date(type_, state, input_, "date"),
    )
    if error:
        return error
    try:
        rotator = _resolve_rotator(state, input_.get("rotatorRef") or input_.get("rotatorId"))
    except _ReferenceError as exc:
        return _resolve_error(type_, state, exc)

    check = validate_drop(state, rotator.get("id"), input_["date"])
    if not check.get("valid"):
        return _fail(
            type_,
            state,
            "invalid_drop",
            check.get("reason") or "Drop is not allowed.",
            rotatorId=rotator.get("id"),
            date=input_["date"],
        )
    role = input_.get("role") or "Resident"
    next_state = schedule_inpatient_assignment(
        state,
        {
            "date": input_["date"],
            "rotatorId": rotator["id"],
            "role": role,
            "source": "Drag-Drop",
        },
    )
    label = rotator.get("displayName") or rotator.get("fullName")
    return _ok(
        type_,
        state,
        next_state,
        f"Dropped {label} onto inpatient {input_['date']}.",
        {
            "rotatorId": rotator.get("id"),
            "date": input_["date"],
            "role": role,
        },
    )


def _cmd_inpatient_delete(state: dict, type_: str, input_: dict) -> Result:
    assignment_ref = input_.get("assignmentRef") or input_.get("assignmentId") or input_.get("id")
    if not assignment_ref:
        return _fail(type_, state, "missing_field", "assignmentRef is required", field="assignmentRef")
    assignment = next(
        (item for item in state.get("inpatientAssignments") or [] if item.get("id") == assignment_ref),
        None,
    )
    if not assignment:
        return _fail(type_, state, "assignment_not_found", f"inpatient assignment not found: {assignment_ref}", field="assignmentRef", value=assignment_ref)
    next_state = remove_inpatient_assignment(state, assignment_ref)
    return _ok(
        type_,
        state,
        next_state,
        f"Removed inpatient assignment on {assignment.get('date')}.",
        {"assignmentId": assignment_ref},
    )


def _invalid_outpatient_reason(block: dict | None, rotator: dict, date: str) -> str | None:
    if not block or not block.get("startDate") or not block.get("endDate") or date < block["startDate"] or date > block["endDate"]:
        return "Outpatient date must be inside the active block."
    weekday = weekday_name(date)
    if weekday in {"Saturday", "Sunday"}:
        return f"Outpatient clinics are closed on {weekday}."
    holiday = next(
        (
            item for item in block.get("holidays") or []
            if isinstance(item, dict) and item.get("noClinic") and item.get("date") == date
        ),
        None,
    )
    if holiday:
        return f"Outpatient clinics are closed on {holiday.get('label') or date}."
    label = rotator.get("displayName") or rotator.get("fullName") or "Rotator"
    if not is_rotator_active_on(rotator, date):
        return f"{label} is not active on {date}."
    unavailable = is_rotator_unavailable(rotator, date)
    if unavailable:
        return f"{label} is unavailable on {date} ({unavailable.get('label') or unavailable.get('reason')})."
    return None


def _cmd_outpatient_assign(state: dict, type_: str, input_: dict) -> Result:
    error = _first_error(
        _require_value(type_, state, input_, "rotatorRef"),
        _require_iso_date(type_, state, input_, "date"),
        _require_value(type_, state, input_, "period"),
    )
    if error:
        return error
    if input_.get("period") not in PERIODS:
        return _fail(
            type_,
            state,
            "invalid_enum",
            "period must be AM or PM",
            field="period",
            value=input_.get("period"),
        )
    try:
        rotator = _resolve_rotator(state, input_.get("rotatorRef") or input_.get("rotatorId"))
        block = _resolve_block(state, input_.get("blockRef") or input_.get("blockId"))
    except _ReferenceError as exc:
        return _resolve_error(type_, state, exc)
    invalid_reason = _invalid_outpatient_reason(block, rotator, input_["date"])
    if invalid_reason:
        return _fail(
            type_,
            state,
            "invalid_outpatient_assignment",
            invalid_reason,
            rotatorId=rotator.get("id"),
            date=input_["date"],
        )
    next_state = schedule_outpatient_session(
        state,
        {
            "date": input_["date"],
            "period": input_["period"],
            "clinic": input_.get("clinic"),
            "provider": input_.get("provider"),
            "rotatorId": rotator["id"],
            "details": input_.get("details"),
        },
    )
    label = rotator.get("displayName") or rotator.get("fullName")
    return _ok(
        type_,
        state,
        next_state,
        f"Assigned {label} outpatient {input_['period']} on {input_['date']}.",
        {
            "rotatorId": rotator.get("id"),
            "date": input_["date"],
            "period": input_["period"],
        },
    )


def _cmd_outpatient_delete(state: dict, type_: str, input_: dict) -> Result:
    session_ref = input_.get("sessionRef") or input_.get("sessionId") or input_.get("id")
    if not session_ref:
        return _fail(type_, state, "missing_field", "sessionRef is required", field="sessionRef")
    session = next(
        (item for item in state.get("outpatientSessions") or [] if item.get("id") == session_ref),
        None,
    )
    if not session:
        return _fail(type_, state, "session_not_found", f"outpatient session not found: {session_ref}", field="sessionRef", value=session_ref)
    next_state = remove_outpatient_session(state, session_ref)
    return _ok(
        type_,
        state,
        next_state,
        f"Removed outpatient {session.get('period')} session on {session.get('date')}.",
        {"sessionId": session_ref},
    )


def _cmd_clinic_assign(state: dict, type_: str, input_: dict) -> Result:
    session = input_.get("session") or input_.get("period")
    normalized = {**input_, "session": session}
    rotator_ref = normalized.get("rotatorRef") or normalized.get("rotatorId")
    error = _first_error(
        _require_value(type_, state, normalized, "clinicOccurrenceId"),
        _require_iso_date(type_, state, normalized, "date"),
        _require_value(type_, state, normalized, "session"),
    )
    if error:
        return error
    if not rotator_ref:
        return _fail(type_, state, "missing_field", "rotatorRef is required", field="rotatorRef")
    if session not in PERIODS:
        return _fail(type_, state, "invalid_enum", "session must be AM or PM", field="session", value=session)
    try:
        rotator = _resolve_rotator(state, rotator_ref)
    except _ReferenceError as exc:
        return _resolve_error(type_, state, exc)

    result = assign_clinic(
        state,
        {
            "clinicOccurrenceId": normalized["clinicOccurrenceId"],
            "rotatorId": rotator["id"],
            "date": normalized["date"],
            "session": session,
            "source": normalized.get("source") or "manual",
        },
    )
    if not result.get("ok"):
        return _fail(
            type_,
            state,
            result.get("reason") or "invalid_clinic_assignment",
            result.get("message") or "Clinic assignment is not allowed.",
        )
    label = rotator.get("displayName") or rotator.get("fullName") or rotator.get("id")
    return _ok(
        type_,
        state,
        result["state"],
        f"Assigned {label} to clinic {session} on {normalized['date']}.",
        {
            "assignmentId": result["assignment"]["id"],
            "clinicOccurrenceId": normalized["clinicOccurrenceId"],
            "rotatorId": rotator.get("id"),
            "date": normalized["date"],
            "session": session,
        },
    )


def _cmd_clinic_delete(state: dict, type_: str, input_: dict) -> Result:
    normalized = {**input_}
    if normalized.get("period") and not normalized.get("session"):
        normalized["session"] = normalized["period"]
    assignment_ref = normalized.get("assignmentRef") or normalized.get("assignmentId") or normalized.get("id")
    if not assignment_ref:
        rotator_ref = normalized.get("rotatorRef") or normalized.get("rotatorId")
        missing = _first_error(
            _require_value(type_, state, normalized, "clinicOccurrenceId"),
        )
        if missing:
            return missing
        if not rotator_ref:
            return _fail(type_, state, "missing_field", "rotatorRef is required", field="rotatorRef")
        try:
            rotator = _resolve_rotator(state, rotator_ref)
        except _ReferenceError as exc:
            return _resolve_error(type_, state, exc)
        normalized["rotatorId"] = rotator["id"]
    result = unassign_clinic(state, normalized)
    if not result.get("ok"):
        return _fail(
            type_,
            state,
            result.get("reason") or "assignment_not_found",
            result.get("message") or "clinic assignment not found",
            field="assignmentRef" if assignment_ref else "clinicOccurrenceId",
            value=assignment_ref or normalized.get("clinicOccurrenceId"),
        )
    return _ok(
        type_,
        state,
        result["state"],
        "Removed clinic assignment.",
        {"assignmentId": assignment_ref} if assignment_ref else {
            "clinicOccurrenceId": normalized.get("clinicOccurrenceId"),
            "rotatorId": normalized.get("rotatorId"),
        },
    )


def _cmd_daily_report(state: dict, type_: str, input_: dict) -> Result:
    error = _require_iso_date(type_, state, input_, "date")
    if error:
        return error
    date = input_["date"]
    return _ok(
        type_,
        state,
        state,
        f"Generated daily report for {date}.",
        {"report": generate_daily_report(state, date)},
    )


def _cmd_conflicts_list(state: dict, type_: str, input_: dict) -> Result:
    conflicts = [
        conflict
        for conflict in detect_conflicts(state)
        if not input_.get("date") or conflict.get("date") == input_.get("date")
    ]
    return _ok(type_, state, state, f"Found {len(conflicts)} conflicts.", {"conflicts": conflicts})


def _cmd_export_package(state: dict, type_: str, input_: dict) -> Result:
    return _ok(type_, state, state, "Built export package.", {"package": build_export_package(state)})


def _cmd_export_pdfs(state: dict, type_: str, input_: dict) -> Result:
    files = build_pdf_exports(state)
    return _ok(type_, state, state, f"Built {len(files)} PDF exports.", {"files": files})


def _cmd_export_word(state: dict, type_: str, input_: dict) -> Result:
    files = build_word_exports(state)
    return _ok(type_, state, state, f"Built {len(files)} Word exports.", {"files": files})


def _cmd_export_coordinator_bundle(state: dict, type_: str, input_: dict) -> Result:
    files = build_coordinator_bundle(state)
    return _ok(
        type_,
        state,
        state,
        "Built the Master, Inpatient, and Outpatient schedules as Word and PDF.",
        {"files": files},
    )


PEEK_BUFFER_DAYS = 14


def _planning_grid_effective_block(state: dict, block: dict, input_: dict) -> dict:
    if not input_.get("peekBeforeBlock") and not input_.get("peekPastBlock"):
        return block

    out = dict(block)
    if input_.get("peekBeforeBlock"):
        out = extend_block_start(out, PEEK_BUFFER_DAYS)

    if input_.get("peekPastBlock"):
        out = extend_block_end(out, PEEK_BUFFER_DAYS)

    # Neighboring blocks can contribute holiday styling inside the fixed
    # context window, but they never choose its boundaries.
    holidays: list[dict] = []
    seen_holiday_dates: set[str] = set()
    for source_block in [block, *(state.get("serviceBlocks") or [])]:
        for holiday in source_block.get("holidays") or []:
            holiday_date = str(holiday.get("date") or "")
            if (
                not holiday_date
                or holiday_date in seen_holiday_dates
                or holiday_date < str(out.get("startDate") or "")
                or holiday_date > str(out.get("endDate") or "")
            ):
                continue
            seen_holiday_dates.add(holiday_date)
            holidays.append(holiday)

    return {**out, "holidays": holidays}


def _cmd_grid_show(state: dict, type_: str, input_: dict) -> Result:
    try:
        block = _resolve_block(state, input_.get("blockRef") or input_.get("blockId"))
    except _ReferenceError as exc:
        return _resolve_error(type_, state, exc)
    effective_block = _planning_grid_effective_block(state, block, input_)
    return _ok(
        type_,
        state,
        state,
        f"Built planning grid for {block.get('name')}.",
        {
            "blockId": block.get("id"),
            "rawStartDate": block.get("startDate"),
            "rawEndDate": block.get("endDate"),
            "effectiveStartDate": effective_block.get("startDate"),
            "effectiveEndDate": effective_block.get("endDate"),
            "peekBeforeBlock": bool(input_.get("peekBeforeBlock")),
            "peekPastBlock": bool(input_.get("peekPastBlock")),
            "grid": build_planning_grid(state, effective_block),
        },
    )


# Dispatch table. Each new command adds one entry once its mutator is ported.
_HANDLERS: dict[str, Callable[[dict, str, dict], Result]] = {
    "assign.range": _cmd_assign_range,
    "attending.add": _cmd_attending_add,
    "attending.remove": _cmd_attending_remove,
    "attending.update": _cmd_attending_update,
    "block.add": _cmd_block_add,
    "block.delete": _cmd_block_delete,
    "block.update": _cmd_block_update,
    "block.use": _cmd_block_use,
    "clinic.assign": _cmd_clinic_assign,
    "clinic.delete": _cmd_clinic_delete,
    "conflicts.list": _cmd_conflicts_list,
    "draft.generate": _cmd_inpatient_draft,
    "export.package": _cmd_export_package,
    "export.pdfs": _cmd_export_pdfs,
    "export.word": _cmd_export_word,
    "export.coordinatorBundle": _cmd_export_coordinator_bundle,
    "expectedSource.add": _cmd_expected_source_add,
    "expectedSource.remove": _cmd_expected_source_remove,
    "inpatient.fellow.resolve": _cmd_inpatient_fellow_resolve,
    "grid.show": _cmd_grid_show,
    "inpatient.assign": _cmd_inpatient_assign,
    "inpatient.delete": _cmd_inpatient_delete,
    "inpatient.draft": _cmd_inpatient_draft,
    "inpatient.drop": _cmd_inpatient_drop,
    "methodist.auto": _cmd_methodist_auto,
    "outpatient.assign": _cmd_outpatient_assign,
    "outpatient.delete": _cmd_outpatient_delete,
    "posterSettings.patch": _cmd_poster_settings_patch,
    "report.daily": _cmd_daily_report,
    "roster.dedupe": _cmd_roster_dedupe,
    "rotator.add": _cmd_rotator_add,
    "rotator.delete": _cmd_rotator_delete,
    "rotator.update": _cmd_rotator_update,
    "rotators.delete": _cmd_rotators_delete,
    "rules.patch": _cmd_rules_patch,
    "source.add": _cmd_source_add,
    "source.delete": _cmd_source_delete,
    "source.remove": _cmd_source_delete,
}


def execute_scheduler_command(state: dict, command: Command) -> Result:
    """Run a single scheduler command against `state`, returning the result
    envelope. Never mutates `state`."""
    type_ = (command or {}).get("type")
    input_ = _input_of(command)
    handler = _HANDLERS.get(type_) if type_ else None
    if handler is None:
        return _fail(
            type_ or "(none)",
            state,
            "unknown_command",
            f"unknown command: {type_ or '(none)'}",
            field="type",
            value=type_,
        )
    return _with_post_final_change(state, type_, input_, handler(state, type_, input_))
