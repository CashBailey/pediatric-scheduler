"""Week-grid export model: calendar_utils.week_buckets + clinics.build_week_grid.

Bucketing mirrors shared/scheduler/poster-weeks.js (Monday-anchored, partial
first/last weeks) — the Swift twin is PosterWeeksTests.swift.
"""

from backend_py.domain.calendar_utils import monday_of, week_buckets
from backend_py.domain.clinics import build_week_grid, clinic_assignment_rows, week_grid_card_text


def test_monday_of_walks_back_to_monday():
    assert monday_of("2026-01-01") == "2025-12-29"  # Thursday
    assert monday_of("2026-05-04") == "2026-05-04"  # already Monday
    assert monday_of("2026-05-08") == "2026-05-04"  # Friday


def test_week_buckets_thursday_start_yields_partial_first_week():
    dates = [
        "2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07",
        "2026-01-08", "2026-01-09", "2026-01-12", "2026-01-13", "2026-01-14",
    ]
    weeks = week_buckets(dates)
    assert weeks[0] == ["2026-01-01", "2026-01-02"]
    assert weeks[1] == ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]
    assert weeks[2] == ["2026-01-12", "2026-01-13", "2026-01-14"]


def test_week_buckets_empty():
    assert week_buckets([]) == []


def _state_and_block():
    block = {
        "id": "b1",
        "name": "Grid Week",
        "startDate": "2026-05-04",
        "endDate": "2026-05-08",
        "status": "Draft",
        "holidays": [{"date": "2026-05-08", "noClinic": True, "label": "Founders Day"}],
    }
    state = {
        "serviceBlocks": [block],
        "activeBlockId": "b1",
        "rotators": [
            {
                "id": "r1",
                "fullName": "Drew Quinn",
                "displayName": "Drew Quinn",
                "program": "UT Pediatrics",
                "level": "PGY-2",
                "role": "Resident",
                "segments": [{"start": "2026-05-04", "end": "2026-05-08"}],
                "schoolType": "ut-peds",
            }
        ],
        "attendings": [
            {
                "name": "Fir",
                "recurringClinics": [
                    {
                        "id": "tmpl-epilepsy",
                        "weekday": "Monday",
                        "session": "AM",
                        "clinicName": "Epilepsy Urgent",
                        "location": "International District",
                        "active": True,
                    }
                ],
            }
        ],
        "inpatientAssignments": [],
        "outpatientSessions": [],
        "clinicAssignments": [],
    }
    occurrence_id = None
    from backend_py.domain.clinics import expand_clinic_occurrences

    for occ in expand_clinic_occurrences(state, {"startDate": "2026-05-04", "endDate": "2026-05-08"}):
        occurrence_id = occ["id"]
    state["clinicAssignments"] = [
        {
            "id": "ca1",
            "clinicOccurrenceId": occurrence_id,
            "rotatorId": "r1",
            "date": "2026-05-04",
            "session": "AM",
            "source": "manual",
        }
    ]
    return state, block


def test_clinic_assignment_rows_carry_location():
    state, block = _state_and_block()
    rows = clinic_assignment_rows(state, block)
    assert rows[0]["location"] == "International District"
    assert rows[0]["stale"] is False


def test_build_week_grid_cards_and_holiday():
    state, block = _state_and_block()
    weeks = build_week_grid(state, block)
    assert len(weeks) == 1
    week = weeks[0]
    assert week["startDate"] == "2026-05-04"
    days = {day["date"]: day for day in week["days"]}
    monday = days["2026-05-04"]
    assert monday["holiday"] is None
    card = monday["AM"][0]
    assert card["clinicName"] == "Epilepsy Urgent"
    assert card["attendingName"] == "Fir"
    assert card["location"] == "International District"
    assert card["rotatorNames"] == ["Drew Quinn"]
    assert week_grid_card_text(card) == "Epilepsy Urgent (Fir) at International District: Drew Quinn"
    friday = days["2026-05-08"]
    assert friday["holiday"] == "Founders Day"
    assert friday["AM"] == [] and friday["PM"] == []


def test_build_week_grid_empty_block():
    assert build_week_grid({}, None) == []


def test_outpatient_csv_includes_location_column():
    from backend_py.domain.exports import build_outpatient_calendar, build_outpatient_calendar_csv

    state, block = _state_and_block()
    csv_text = build_outpatient_calendar_csv(build_outpatient_calendar(state, block))
    header = csv_text.splitlines()[0]
    assert "location" in header.split(",")
    assert "International District" in csv_text
