"""Contract-correctness tests for the frozen v1 JSON Schemas.

The key test here is not "does jsonschema work" — it's "does the frozen
schema actually accept what the live Node engine produces". The fixture
backend_py/tests/fixtures/initial-state.json is generated from the real
createInitialState()/migrateLoadedState() pipeline (see the freeze step),
so validating it against scheduler-state.v1 proves the freeze captured
reality, not just a hand-written shape.
"""

import json
from pathlib import Path

import pytest

from backend_py.contracts import load_schemas, validate
from backend_py.persistence import load_state_from_disk, save_state_to_disk

FIXTURES = Path(__file__).resolve().parent / "fixtures"

EXPECTED_IDS = {
    "attending.v1",
    "service-block.v1",
    "rotator.v1",
    "inpatient-assignment.v1",
    "outpatient-session.v1",
    "scheduler-state.v1",
    "conflict.v1",
    "legend-entry.v1",
}


def test_all_eight_schemas_load():
    schemas = load_schemas()
    assert set(schemas.keys()) == EXPECTED_IDS


def test_node_initial_state_fixture_is_valid():
    state = json.loads((FIXTURES / "initial-state.json").read_text())
    errors = validate("scheduler-state.v1", state)
    assert errors == [], f"live Node initial-state failed frozen schema: {errors}"


def test_cross_schema_refs_resolve():
    # scheduler-state.v1 $refs service-block.v1, rotator.v1, attending.v1,
    # etc. A bad rotator (role outside the enum) must be REJECTED, which
    # only happens if the $ref into rotator.v1 actually resolves.
    state = json.loads((FIXTURES / "initial-state.json").read_text())
    state["rotators"] = [
        {
            "id": "r1",
            "fullName": "Bad Role",
            "displayName": "Bad Role",
            "program": "Methodist",
            "level": "PGY-2",
            "role": "Janitor",  # not in the Resident/Fellow/Student enum
            "segments": [],
            "schoolType": "methodist",
            "continuityClinic": "",
            "dayOff": [],
            "unavailableRanges": [],
        }
    ]
    errors = validate("scheduler-state.v1", state)
    assert errors, "expected the bad rotator role to fail via the rotator.v1 $ref"


def test_bare_string_attendings_rejected():
    # Mirrors backend/tests/server.test.mjs: pre-migration bare-string
    # attendings must not validate against the canonical object shape.
    state = json.loads((FIXTURES / "initial-state.json").read_text())
    state["attendings"] = ["Alder", "Birch"]
    errors = validate("scheduler-state.v1", state)
    assert errors, "bare-string attendings should fail scheduler-state.v1"


def test_clinic_allowed_roles_policy_metadata_validates():
    state = json.loads((FIXTURES / "initial-state.json").read_text())
    state["attendings"] = [
        {
            "name": "Alder",
            "recurringClinics": [
                {"weekday": "Monday", "session": "AM", "clinicName": "General Neuro", "allowedRoles": ["Resident", "Fellow"]}
            ],
            "oneOffDates": [
                {"date": "2026-05-06", "period": "PM", "clinicName": "TSC", "allowedRoles": []}
            ],
        }
    ]
    assert validate("scheduler-state.v1", state) == []


def test_clinic_allowed_roles_rejects_unknown_role():
    state = json.loads((FIXTURES / "initial-state.json").read_text())
    state["attendings"] = [
        {
            "name": "Alder",
            "recurringClinics": [
                {"weekday": "Monday", "session": "AM", "clinicName": "General Neuro", "allowedRoles": ["Intern"]}
            ],
            "oneOffDates": [],
        }
    ]
    errors = validate("scheduler-state.v1", state)
    assert errors, "unknown allowedRoles values should fail scheduler-state.v1"


def test_populated_state_fixture_round_trips(tmp_path):
    # contracts/golden/populated-state.json is the shared cross-language
    # fixture (JS: tests/contracts-freeze.test.mjs, Swift:
    # macos/PediatricSchedulerTests). It exercises the fields the empty
    # initial state can't — non-empty sources (including the Python-only
    # importWarnings metadata), clinicAssignments, halfDayFacts, and
    # posterSettings — so validating and persisting it proves Python
    # round-trips the full declared state surface byte-for-byte.
    fixture_path = (
        Path(__file__).resolve().parents[2] / "contracts" / "golden" / "populated-state.json"
    )
    state = json.loads(fixture_path.read_text())

    assert state["sources"], "fixture must contain a source record"
    assert state["clinicAssignments"], "fixture must contain a clinic assignment"
    assert state["posterSettings"]["locations"], "fixture must contain poster locations"
    assert isinstance(state["posterSettings"]["notes"], list)
    assert validate("scheduler-state.v1", state) == []

    assert save_state_to_disk(state, tmp_path) == {"ok": True}
    assert load_state_from_disk(tmp_path) == state


def test_declared_state_field_shapes_are_enforced():
    fixture_path = (
        Path(__file__).resolve().parents[2] / "contracts" / "golden" / "populated-state.json"
    )
    state = json.loads(fixture_path.read_text())

    invalid_source = json.loads(json.dumps(state))
    invalid_source["sources"][0]["importWarningCount"] = None
    assert any("sources/0/importWarningCount" in error for error in validate("scheduler-state.v1", invalid_source))

    invalid_clinic = json.loads(json.dumps(state))
    invalid_clinic["clinicAssignments"][0]["date"] = "not-a-date"
    assert any("clinicAssignments/0/date" in error for error in validate("scheduler-state.v1", invalid_clinic))

    invalid_poster = json.loads(json.dumps(state))
    invalid_poster["posterSettings"]["notes"] = [123]
    assert any("posterSettings/notes/0" in error for error in validate("scheduler-state.v1", invalid_poster))


@pytest.mark.parametrize("schema_id", sorted(EXPECTED_IDS))
def test_every_schema_is_individually_usable(schema_id):
    # Each schema must be loadable and runnable as a validator entry point
    # (empty object is fine — we only assert no resolver/compile crash).
    validate(schema_id, {})
