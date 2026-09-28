from __future__ import annotations

from copy import deepcopy

from backend_py.domain.draft import (
    OUTPATIENT_TARGET_ROTATORS,
    apply_methodist_auto_assign,
    choose_methodist_start_side,
    generate_draft,
    is_fellow_rotator,
    parse_continuity_clinic_slots,
    propose_schedule,
    schedule_inpatient_assignment,
    segment_split_plan,
    validate_drop,
)
from backend_py.domain.assignments import apply_range_assignment
from backend_py.domain.calendar_utils import add_days_to_iso
from backend_py.domain.reports import detect_conflicts
from backend_py.initial_state import create_initial_state


FULL_WEEK_SEG = [{"start": "2026-05-04", "end": "2026-05-08"}]


def make_rotator(
    id_: str,
    full_name: str,
    program: str,
    level: str,
    segments: list[dict],
) -> dict:
    school_type = {
        "Methodist": "methodist",
        "UT Adult Neuro": "ut-adult",
        "UT Pediatrics": "ut-peds",
        "UT Med Student": "ut-student",
        "UT Psychiatry": "ut-psychiatry",
    }.get(program, "other")
    role = "Fellow" if level == "Fellow" else "Student" if level.startswith("MS") else "Resident"
    return {
        "id": id_,
        "fullName": full_name,
        "displayName": full_name,
        "program": program,
        "level": level,
        "role": role,
        "segments": segments,
        "schoolType": school_type,
        "continuityClinic": "Tuesday PM" if "Adult" in program or program == "Methodist" else "",
        "dayOff": [],
        "unavailableRanges": [],
    }


def methodist_rotator(**overrides: object) -> dict:
    rotator = make_rotator(
        str(overrides.get("id") or "rot-methodist-test"),
        "Casey Methodist",
        "Methodist",
        "PGY-3",
        overrides.get("segments")  # type: ignore[arg-type]
        or [{"start": "2026-06-01", "end": "2026-06-28"}],
    )
    if "rotationStartDate" in overrides:
        if overrides["rotationStartDate"] is not None:
            rotator["rotationStartDate"] = overrides["rotationStartDate"]
    else:
        rotator["rotationStartDate"] = "2026-06-01"
    if "methodistStartSide" in overrides:
        rotator["methodistStartSide"] = overrides["methodistStartSide"]
    return rotator


def block_of(
    id_: str,
    start: str,
    end: str,
    coverage: dict | None = None,
) -> dict:
    return {
        "id": id_,
        "name": id_,
        "startDate": start,
        "endDate": end,
        "status": "Draft",
        "generate": {},
        "holidays": [],
        "coverage": coverage or {
            "weekday": {"ip": {"count": 0}},
            "saturday": {"ip": {"count": 0}},
            "sunday": {"ip": {"count": 0}},
            "holiday": {"ip": {"count": 0}},
        },
    }


def state_with(block: dict, rotators: list[dict], **overrides: object) -> dict:
    state = create_initial_state()
    state.update(
        {
            "activeBlockId": block["id"],
            "serviceBlocks": [block],
            "rotators": rotators,
            "inpatientAssignments": [],
            "outpatientSessions": [],
        }
    )
    state.update(overrides)
    return state


def week_state(
    *,
    coverage: dict,
    rotators: list[dict],
    inpatient_assignments: list[dict] | None = None,
    outpatient_sessions: list[dict] | None = None,
) -> tuple[dict, dict]:
    block = block_of("b1", "2026-05-04", "2026-05-08", coverage)
    return (
        state_with(
            block,
            rotators,
            inpatientAssignments=inpatient_assignments or [],
            outpatientSessions=outpatient_sessions or [],
        ),
        block,
    )


def test_segment_split_plan_keeps_inpatient_weeks_contiguous():
    def phases(days: int) -> list[str]:
        plan = segment_split_plan({"start": "2026-05-04", "end": add_days_to_iso("2026-05-04", days - 1)})
        return [chunk["phase"][0] for chunk in plan]

    assert phases(7) == ["i"]
    assert phases(14) == ["i", "o"]
    assert phases(21) == ["i", "i", "o"]
    assert phases(28) == ["o", "i", "i", "o"]
    assert phases(35) == ["o", "i", "i", "i", "o"]

    for days in range(7, 71, 7):
        shape = "".join(phases(days))
        assert shape.strip("o").startswith("i")
        assert "ioi" not in shape


def test_length_split_seeds_four_week_ut_peds_and_is_idempotent():
    block = block_of("b4", "2026-06-01", "2026-06-28")
    rotator = make_rotator("r1", "A", "UT Pediatrics", "PGY-2", [{"start": "2026-06-01", "end": "2026-06-28"}])
    state = state_with(block, [rotator])

    once = generate_draft(state, block)
    twice = generate_draft(deepcopy(once["state"]), block)

    def ip_on(date: str) -> bool:
        return any(a["rotatorId"] == "r1" and a["date"] == date for a in once["state"]["inpatientAssignments"])

    def op_on(date: str) -> bool:
        return any(s["rotatorId"] == "r1" and s["date"] == date for s in once["state"]["outpatientSessions"])

    assert op_on("2026-06-02")
    assert not ip_on("2026-06-02")
    assert ip_on("2026-06-10")
    assert ip_on("2026-06-17")
    assert op_on("2026-06-23")
    assert not ip_on("2026-06-23")
    assert all(a["source"] == "Auto-Split" for a in once["state"]["inpatientAssignments"] if a["rotatorId"] == "r1")
    assert twice["state"] == once["state"]


def test_methodist_start_side_is_computed_and_user_override_wins():
    june = block_of("june", "2026-06-01", "2026-06-30")
    rotator = methodist_rotator(
        id="m1",
        rotationStartDate="2026-06-20",
        segments=[{"start": "2026-06-20", "end": "2026-07-17"}],
    )
    assert choose_methodist_start_side(rotator, june) == "inpatient"

    generated = generate_draft(state_with(june, [rotator]), june)["state"]
    assert next(r for r in generated["rotators"] if r["id"] == "m1")["methodistStartSide"] == "inpatient"
    assert any(a["rotatorId"] == "m1" and a["date"] == "2026-06-22" and a["source"] == "Auto-Methodist" for a in generated["inpatientAssignments"])

    overridden = methodist_rotator(
        id="m1",
        rotationStartDate="2026-06-20",
        segments=[{"start": "2026-06-20", "end": "2026-07-17"}],
        methodistStartSide="outpatient",
    )
    explicit = generate_draft(state_with(june, [overridden]), june)["state"]
    assert next(r for r in explicit["rotators"] if r["id"] == "m1")["methodistStartSide"] == "outpatient"
    assert any(s["rotatorId"] == "m1" and s["date"] == "2026-06-22" for s in explicit["outpatientSessions"])
    assert not any(a["rotatorId"] == "m1" and a["date"] == "2026-06-22" for a in explicit["inpatientAssignments"])


def test_d1b_methodist_outpatient_fortnight_is_not_inpatient_backup():
    block = block_of("d1b", "2026-05-25", "2026-05-29", {"weekday": {"ip": {"count": 1}}})
    rotator = methodist_rotator(
        id="m1",
        rotationStartDate="2026-05-20",
        segments=[{"start": "2026-05-20", "end": "2026-06-16"}],
        methodistStartSide="outpatient",
    )
    proposed = propose_schedule(state_with(block, [rotator]), block)

    assert not any(a["rotatorId"] == "m1" and a.get("role") != "Off" for a in proposed["proposedState"]["inpatientAssignments"])
    assert [item["date"] for item in proposed["unmet"]] == ["2026-05-25", "2026-05-26", "2026-05-27", "2026-05-28", "2026-05-29"]


def test_multi_slot_continuity_clinic_is_honored_across_backend_paths():
    block = block_of("b1", "2026-05-04", "2026-05-08")
    rotator = make_rotator("r1", "A", "Other", "PGY-2", FULL_WEEK_SEG)
    rotator["continuityClinic"] = "Tuesday PM, Thursday AM"
    state = state_with(block, [rotator])

    assert parse_continuity_clinic_slots(rotator["continuityClinic"]) == [
        {"weekday": "Tuesday", "period": "PM"},
        {"weekday": "Thursday", "period": "AM"},
    ]
    blocked = validate_drop(state, "r1", "2026-05-07", {"avoidContinuity": True})
    assert blocked["valid"] is False
    assert "Thursday" in blocked["reason"]

    inpatient_state = schedule_inpatient_assignment(
        state,
        {"date": "2026-05-07", "rotatorId": "r1", "role": "Resident", "source": "Manual"},
    )
    assert any(
        conflict["type"] == "continuity-clinic-conflict" and conflict["date"] == "2026-05-07"
        for conflict in detect_conflicts(inpatient_state)
    )

    outpatient_conflict_state = state_with(
        block,
        [rotator],
        outpatientSessions=[
            {
                "id": "op-thu-am",
                "date": "2026-05-07",
                "period": "AM",
                "clinic": "General Neuro",
                "provider": "",
                "rotatorId": "r1",
                "status": "Scheduled",
                "source": "Manual",
            }
        ],
    )
    assert any(
        conflict["type"] == "continuity-clinic-conflict"
        and conflict["date"] == "2026-05-07"
        and conflict.get("period") == "AM"
        for conflict in detect_conflicts(outpatient_conflict_state)
    )

    ranged = apply_range_assignment(
        state,
        block,
        {"rotatorId": "r1", "startDate": "2026-05-07", "endDate": "2026-05-07", "phase": "outpatient"},
    )
    assert [session["period"] for session in ranged["outpatientSessions"] if session["date"] == "2026-05-07"] == ["PM"]


def test_inpatient_continuity_uses_matching_half_day_facts():
    block = block_of("b1", "2026-05-04", "2026-05-08")
    rotator = make_rotator("r1", "A", "Other", "PGY-2", FULL_WEEK_SEG)
    rotator["continuityClinic"] = "Tuesday PM, Thursday AM"
    state = state_with(
        block,
        [rotator],
        halfDayFacts=[
            {
                "id": "half-2026-05-07-am-r1-clinic",
                "date": "2026-05-07",
                "period": "AM",
                "rotatorId": "r1",
                "kind": "inpatient-annotation",
                "status": "IP",
                "label": "AM Clinic",
                "source": "Coordinator DOCX inpatient roster",
            }
        ],
    )

    assert validate_drop(state, "r1", "2026-05-07", {"avoidContinuity": True})["valid"] is True
    blocked = validate_drop(state, "r1", "2026-05-05", {"avoidContinuity": True})
    assert blocked["valid"] is False
    assert "Tuesday" in blocked["reason"]

    inpatient_state = schedule_inpatient_assignment(
        state,
        {"date": "2026-05-07", "rotatorId": "r1", "role": "Resident", "source": "Manual"},
    )
    assert not any(
        conflict["type"] == "continuity-clinic-conflict" and conflict["date"] == "2026-05-07"
        for conflict in detect_conflicts(inpatient_state)
    )

    wrong_period = state_with(
        block,
        [rotator],
        halfDayFacts=[
            {
                "id": "half-2026-05-07-pm-r1-clinic",
                "date": "2026-05-07",
                "period": "PM",
                "rotatorId": "r1",
                "kind": "inpatient-annotation",
                "status": "IP",
                "label": "PM Clinic",
                "source": "Coordinator DOCX inpatient roster",
            }
        ],
    )
    wrong_period_state = schedule_inpatient_assignment(
        wrong_period,
        {"date": "2026-05-07", "rotatorId": "r1", "role": "Resident", "source": "Manual"},
    )
    assert any(
        conflict["type"] == "continuity-clinic-conflict" and conflict["date"] == "2026-05-07"
        for conflict in detect_conflicts(wrong_period_state)
    )


def test_full_day_continuity_still_blocks_with_half_day_facts():
    block = block_of("b1", "2026-05-04", "2026-05-08")
    rotator = make_rotator("r1", "A", "Other", "PGY-2", FULL_WEEK_SEG)
    rotator["continuityClinic"] = "Thursday AM, Thursday PM"
    state = state_with(
        block,
        [rotator],
        halfDayFacts=[
            {
                "id": "half-2026-05-07-am-r1-clinic",
                "date": "2026-05-07",
                "period": "AM",
                "rotatorId": "r1",
                "kind": "inpatient-annotation",
                "status": "IP",
                "label": "AM Clinic",
                "source": "Coordinator DOCX inpatient roster",
            },
            {
                "id": "half-2026-05-07-pm-r1-clinic",
                "date": "2026-05-07",
                "period": "PM",
                "rotatorId": "r1",
                "kind": "inpatient-annotation",
                "status": "IP",
                "label": "PM Clinic",
                "source": "Coordinator DOCX inpatient roster",
            },
        ],
    )

    blocked = validate_drop(state, "r1", "2026-05-07", {"avoidContinuity": True})
    assert blocked["valid"] is False
    assert "Thursday" in blocked["reason"]


def test_methodist_auto_assign_skips_second_continuity_slot():
    block = block_of("methodist", "2026-05-20", "2026-05-22")
    rotator = methodist_rotator(
        id="m1",
        rotationStartDate="2026-05-20",
        methodistStartSide="outpatient",
        segments=[{"start": "2026-05-20", "end": "2026-06-16"}],
    )
    rotator["continuityClinic"] = "Tuesday PM, Thursday AM"

    state = apply_methodist_auto_assign(state_with(block, [rotator]), block)
    thursday_periods = sorted(
        session["period"]
        for session in state["outpatientSessions"]
        if session["rotatorId"] == "m1" and session["date"] == "2026-05-21"
    )
    wednesday_periods = sorted(
        session["period"]
        for session in state["outpatientSessions"]
        if session["rotatorId"] == "m1" and session["date"] == "2026-05-20"
    )

    assert thursday_periods == ["PM"]
    assert wednesday_periods == ["AM", "PM"]


def test_fellow_rule_seeds_single_blank_and_reports_named_ambiguity():
    fellow_one = make_rotator("f1", "Coordinator", "Other", "Fellow", FULL_WEEK_SEG)
    resident = make_rotator("r1", "A", "Other", "PGY-2", FULL_WEEK_SEG)
    state, block = week_state(coverage={"weekday": {"ip": {"count": 2}}}, rotators=[fellow_one, resident])

    generated = generate_draft(state, block)
    assert any(a["rotatorId"] == "f1" and a["source"] == "Auto-Draft" for a in generated["state"]["inpatientAssignments"])
    assert not any(c["id"] == "fellow-blank-candidates" for c in generated["report"]["checks"])

    fellow_two = make_rotator("f2", "Eden", "Other", "Fellow", FULL_WEEK_SEG)
    ambiguous_state, ambiguous_block = week_state(
        coverage={"weekday": {"ip": {"count": 1}}},
        rotators=[fellow_one, fellow_two],
    )
    ambiguous = generate_draft(ambiguous_state, ambiguous_block)
    check = next(c for c in ambiguous["report"]["checks"] if c["id"] == "fellow-blank-candidates")
    assert check["candidates"] == ["Coordinator", "Eden"]
    assert "Coordinator / Eden" in check["message"]
    assert not any(
        a["rotatorId"] in {"f1", "f2"} and a["source"] == "Auto-Draft"
        for a in ambiguous["state"]["inpatientAssignments"]
    )
    assert not any(s["rotatorId"] in {"f1", "f2"} for s in ambiguous["state"]["outpatientSessions"])


def test_psychiatry_pgy5_with_legacy_fellow_role_is_not_a_peds_fellow():
    kai = make_rotator("psych-1", "Kai Doe", "UT Psychiatry", "PGY-5", FULL_WEEK_SEG)
    kai["role"] = "Fellow"
    assert is_fellow_rotator(kai) is False

    state, block = week_state(
        coverage={"weekday": {"ip": {"count": 1}}},
        rotators=[kai],
    )
    generated = generate_draft(state, block)
    assert not any(
        assignment["rotatorId"] == "psych-1" and assignment["role"] == "Fellow"
        for assignment in generated["state"]["inpatientAssignments"]
    )
    assert not any(
        check["id"].startswith("fellow-")
        for check in generated["report"]["checks"]
    )


def test_outpatient_fill_respects_inpatient_same_day_and_reports_short_target():
    state, block = week_state(
        coverage={"weekday": {"ip": {"count": 1}}},
        rotators=[
            make_rotator("r1", "A", "Other", "PGY-2", FULL_WEEK_SEG),
            make_rotator("r2", "B", "Other", "PGY-3", FULL_WEEK_SEG),
        ],
    )

    generated = generate_draft(state, block)
    op_days = {s["date"] for s in generated["state"]["outpatientSessions"] if s["source"] == "Auto-Draft"}
    assert len(op_days) == 5
    for session in generated["state"]["outpatientSessions"]:
        assert not any(
            a["date"] == session["date"] and a["rotatorId"] == session["rotatorId"]
            for a in generated["state"]["inpatientAssignments"]
        )
    check = next(c for c in generated["report"]["checks"] if c["id"] == "op-below-target")
    assert len(check["dates"]) == 5
    assert OUTPATIENT_TARGET_ROTATORS == 2


def test_propose_schedule_swap_repair_moves_only_auto_draft_records():
    block = block_of("b1", "2026-05-04", "2026-05-06", {"weekday": {"ip": {"count": 1}}})
    state = state_with(
        block,
        [
            make_rotator("ra", "A", "Other", "PGY-2", [{"start": "2026-05-04", "end": "2026-05-06"}]),
            make_rotator("rb", "B", "Other", "PGY-3", [{"start": "2026-05-04", "end": "2026-05-05"}]),
        ],
        rules={"maxConsecutiveInpatientDays": 1},
    )

    result = propose_schedule(state, block)
    assert result["unmet"] == []
    for date in ["2026-05-04", "2026-05-05", "2026-05-06"]:
        assert len([a for a in result["proposedState"]["inpatientAssignments"] if a["date"] == date and a["role"] != "Off"]) == 1
    assert propose_schedule(state, block)["proposedState"] == result["proposedState"]

    impossible = block_of("b2", "2026-05-04", "2026-05-05", {"weekday": {"ip": {"count": 2}}})
    one_rotator = state_with(
        impossible,
        [make_rotator("ra", "A", "Other", "PGY-2", [{"start": "2026-05-04", "end": "2026-05-05"}])],
    )
    one_rotator = schedule_inpatient_assignment(
        one_rotator,
        {"date": "2026-05-04", "rotatorId": "ra", "role": "Resident", "source": "Manual"},
    )
    short = propose_schedule(one_rotator, impossible)
    manual = next(a for a in short["proposedState"]["inpatientAssignments"] if a["source"] == "Manual")
    assert manual["date"] == "2026-05-04"
    assert len(short["unmet"]) == 2


def test_report_flags_sandwich_and_year_balance():
    sandwich_block = block_of("sandwich", "2026-05-04", "2026-05-24")
    rotator = make_rotator("r1", "A", "Other", "PGY-2", [{"start": "2026-05-04", "end": "2026-05-24"}])

    def op(date: str) -> dict:
        return {"id": f"o-{date}", "date": date, "period": "AM", "clinic": "QRS", "provider": "", "rotatorId": "r1", "status": "Scheduled", "source": "Manual"}

    def ip(date: str) -> dict:
        return {"id": f"i-{date}", "date": date, "rotatorId": "r1", "role": "Resident", "source": "Manual"}

    sandwich_state = state_with(
        sandwich_block,
        [rotator],
        outpatientSessions=[op("2026-05-05"), op("2026-05-06"), op("2026-05-19"), op("2026-05-20")],
        inpatientAssignments=[ip(date) for date in ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14", "2026-05-15"]],
    )
    sandwich = generate_draft(sandwich_state, sandwich_block)
    assert next(c for c in sandwich["report"]["checks"] if c["id"] == "five-week-sandwich")["rotatorId"] == "r1"

    balance_block = block_of("balance", "2026-05-04", "2026-05-08")
    peds = make_rotator("r1", "A", "UT Pediatrics", "PGY-2", [{"start": "2026-01-05", "end": "2026-01-25"}])
    balance_state = state_with(
        balance_block,
        [peds],
        inpatientAssignments=[
            {"id": f"i-2026-01-{day:02d}", "date": f"2026-01-{day:02d}", "rotatorId": "r1", "role": "Resident", "source": "Manual"}
            for day in range(5, 21)
        ],
    )
    balance = generate_draft(balance_state, balance_block)
    check = next(c for c in balance["report"]["checks"] if c["id"] == "year-balance")
    assert "16 inpatient vs 0 outpatient" in check["message"]


def test_methodist_derived_start_and_short_rotation_split():
    """Coordinator 2026-07-10: no rotationStartDate -> first scheduled day is day 1;
    rotations shorter than 28 days split in half (26 days -> 13/13)."""
    from backend_py.domain.draft import get_rotator_phase, methodist_rotation_window

    rotator = methodist_rotator(
        id="m1",
        rotationStartDate=None,
        segments=[{"start": "2026-07-01", "end": "2026-07-26"}],  # 26 days
    )
    window = methodist_rotation_window(rotator)
    assert window == {"start": "2026-07-01", "cycle": 26, "half": 13, "derived": True}
    assert get_rotator_phase(rotator, "2026-07-01") == "outpatient"  # day 0
    assert get_rotator_phase(rotator, "2026-07-13") == "outpatient"  # day 12 (last OP)
    assert get_rotator_phase(rotator, "2026-07-14") == "inpatient"  # day 13 (boundary)
    assert get_rotator_phase(rotator, "2026-07-26") == "inpatient"  # day 25 (last day)
    assert get_rotator_phase(rotator, "2026-07-27") is None  # past the rotation

    # Odd length puts the extra day on the first side (27 -> 14/13).
    odd = methodist_rotator(
        id="m2",
        rotationStartDate=None,
        segments=[{"start": "2026-07-01", "end": "2026-07-27"}],
    )
    assert get_rotator_phase(odd, "2026-07-14") == "outpatient"
    assert get_rotator_phase(odd, "2026-07-15") == "inpatient"

    # Explicit rotationStartDate still wins as the anchor.
    explicit = methodist_rotator(
        id="m3",
        rotationStartDate="2026-06-01",
        segments=[{"start": "2026-06-01", "end": "2026-06-28"}],
    )
    assert methodist_rotation_window(explicit) == {
        "start": "2026-06-01", "cycle": 28, "half": 14, "derived": False,
    }

    # No start and no segments -> no window, phase stays manual.
    bare = methodist_rotator(id="m4", rotationStartDate=None, segments=[])
    bare["segments"] = []
    assert methodist_rotation_window(bare) is None
    assert get_rotator_phase(bare, "2026-07-01") is None


def test_methodist_derived_start_flows_through_draft_and_report():
    june = block_of("june", "2026-06-01", "2026-06-30")
    rotator = methodist_rotator(
        id="m1",
        rotationStartDate=None,
        segments=[{"start": "2026-06-01", "end": "2026-06-28"}],
    )
    result = generate_draft(state_with(june, [rotator]), june)
    state = result["state"]
    checks = result["report"]["checks"]
    # Auto-assign ran off the derived window.
    assert any(a["rotatorId"] == "m1" and a["source"] == "Auto-Methodist" for a in state["inpatientAssignments"])
    # Report surfaces the assumption instead of the can't-generate warning.
    assert any(c["id"] == "methodist-derived-start" and c["rotatorId"] == "m1" for c in checks)
    assert not any(c["id"] == "methodist-no-start" for c in checks)


def test_range_assign_repaints_existing_assignment_on_unavailable_day():
    # Coordinator 2026-07-29 #5: Kai's profile marks the day unavailable, but
    # the day already carries an IP record — painting OP must clear the IP
    # side and set OP, not silently no-op while the toast claims success.
    block = block_of("b1", "2026-05-04", "2026-05-08")
    rotator = make_rotator("r1", "Kai Doe", "Other", "PGY-2", FULL_WEEK_SEG)
    rotator["dayOff"] = ["Monday"]
    state = state_with(
        block,
        [rotator],
        inpatientAssignments=[
            {"id": "stale-ip", "date": "2026-05-04", "rotatorId": "r1", "role": "Resident", "source": "Manual"}
        ],
    )

    next_state = apply_range_assignment(
        state,
        block,
        {"rotatorId": "r1", "startDate": "2026-05-04", "endDate": "2026-05-04", "phase": "outpatient"},
    )
    assert next_state is not state
    assert not [a for a in next_state["inpatientAssignments"] if a["rotatorId"] == "r1" and a["date"] == "2026-05-04"]
    assert [s for s in next_state["outpatientSessions"] if s["rotatorId"] == "r1" and s["date"] == "2026-05-04"]


def test_range_assign_still_skips_unassigned_unavailable_day():
    # The other side of the rule: a brand-new assignment on a day the profile
    # marks unavailable stays blocked — identity return signals the no-op.
    block = block_of("b1", "2026-05-04", "2026-05-08")
    rotator = make_rotator("r1", "A", "Other", "PGY-2", FULL_WEEK_SEG)
    rotator["dayOff"] = ["Monday"]
    state = state_with(block, [rotator])

    next_state = apply_range_assignment(
        state,
        block,
        {"rotatorId": "r1", "startDate": "2026-05-04", "endDate": "2026-05-04", "phase": "outpatient"},
    )
    assert next_state is state


def test_validate_drop_blocks_second_weekend_day():
    # Coordinator 2026-07-29 #6b: one day off per weekend.
    block = block_of("b1", "2026-05-04", "2026-05-10")
    rotator = make_rotator("r1", "R", "Other", "PGY-2", [{"start": "2026-05-04", "end": "2026-05-10"}])
    state = state_with(
        block,
        [rotator],
        inpatientAssignments=[
            {"id": "sat", "date": "2026-05-09", "rotatorId": "r1", "role": "Resident", "source": "Manual"}
        ],
    )
    result = validate_drop(state, "r1", "2026-05-10")
    assert result["valid"] is False
    assert "weekend" in result["reason"]
    # An Off record on Saturday does not block Sunday.
    state["inpatientAssignments"][0]["role"] = "Off"
    assert validate_drop(state, "r1", "2026-05-10")["valid"] is True


def test_generate_draft_never_puts_outpatient_segment_on_inpatient():
    # Coordinator 2026-07-29 #6a: Chandler case — explicit segment-level
    # outpatient designation must exclude the rotator from IP fair-fill.
    block = block_of(
        "b1",
        "2026-05-04",
        "2026-05-10",
        coverage={"weekday": {"ip": {"count": 1}}, "saturday": {"ip": {"count": 1}}, "sunday": {"ip": {"count": 1}}},
    )
    seg = [{"start": "2026-05-04", "end": "2026-05-10", "defaultPhase": "outpatient"}]
    outpatient_rotator = make_rotator("r1", "Chandler", "Other", "PGY-2", seg)
    backup = make_rotator("r2", "B", "Other", "PGY-3", [{"start": "2026-05-04", "end": "2026-05-10"}])
    state = state_with(block, [outpatient_rotator, backup])

    result = generate_draft(state, block)
    drafted = [
        a for a in result["state"]["inpatientAssignments"]
        if a["rotatorId"] == "r1" and a.get("role") != "Off"
    ]
    assert drafted == []


def test_generate_draft_sets_side_for_derived_start_methodist():
    # Coordinator 2026-07-29 #6c: derived-start rotators (no rotationStartDate)
    # must still get the staffing-driven start side (commit 061b2d5 gap).
    block = block_of("b1", "2026-06-01", "2026-06-14", coverage={"weekday": {"ip": {"count": 0}}})
    rotator = methodist_rotator(id="m1", rotationStartDate=None, segments=[{"start": "2026-06-01", "end": "2026-06-28"}])
    state = state_with(block, [rotator])

    expected = choose_methodist_start_side(rotator, block)
    result = generate_draft(state, block)
    drafted_rotator = result["state"]["rotators"][0]
    assert expected is not None
    assert drafted_rotator.get("methodistStartSide") == expected


def test_make_rotator_fellow_program_sets_role_and_school_type():
    from backend_py.domain.rotators import make_rotator as real_make_rotator

    rotator = real_make_rotator("f1", "Eden", "UT Pediatric Neurology Fellow", "PGY-6")
    assert rotator["role"] == "Fellow"
    assert rotator["schoolType"] == "ut-peds"


def test_normalize_pediatric_fellow_roles_relabels_and_is_idempotent():
    from backend_py.domain.rotators import normalize_pediatric_fellow_roles

    legacy = {
        "rotators": [
            {"id": "f1", "fullName": "N", "program": "UT Pediatrics", "role": "Fellow", "schoolType": "ut-peds"},
            {"id": "r1", "fullName": "R", "program": "UT Pediatrics", "role": "Resident", "schoolType": "ut-peds"},
        ],
        "inpatientAssignments": [],
    }
    once = normalize_pediatric_fellow_roles(legacy)
    assert once["rotators"][0]["program"] == "UT Pediatric Neurology Fellow"
    assert once["rotators"][1]["program"] == "UT Pediatrics"
    twice = normalize_pediatric_fellow_roles(once)
    assert twice is once
