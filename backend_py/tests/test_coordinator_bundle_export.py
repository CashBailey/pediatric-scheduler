"""Round-trip regression for the Coordinator three-document export bundle.

The strongest possible guard: generate the docx trio from an in-memory
state, then feed it straight back through coordinator_docx_import's parsers
(the battle-tested inbound side of the same format) and assert the
schedule survives intact.
"""

from __future__ import annotations

import base64

import pytest

from backend_py.coordinator_docx_import import parse_coordinator_docx_bundle
from backend_py.domain.coordinator_exports import build_coordinator_bundle
from backend_py.domain.rotators import make_rotator
from backend_py.initial_state import create_initial_state


@pytest.fixture()
def july_state() -> dict:
    state = create_initial_state()
    block = {
        "id": "b1",
        "name": "July 2026",
        "startDate": "2026-07-01",
        "endDate": "2026-07-28",
        "status": "Final",
        "generate": {},
        "holidays": [{"date": "2026-07-03", "name": "Independence Day (observed)", "noClinic": True}],
    }
    fellow = make_rotator(
        "f1", "Eden Walsh", "UT Pediatric Neurology Fellow", "PGY-6",
        [{"start": "2026-07-01", "end": "2026-07-28"}],
    )
    resident = make_rotator(
        "r1", "Chandler Dykstra", "UT Pediatrics", "PGY-2",
        [{"start": "2026-07-01", "end": "2026-07-28"}],
    )
    resident["continuityClinic"] = "Tuesday PM"
    outpatient_only = make_rotator(
        "r2", "Kai Doe", "UT Psychiatry", "PGY-3",
        [{"start": "2026-07-01", "end": "2026-07-14"}],
    )
    state.update(
        {
            "activeBlockId": "b1",
            "serviceBlocks": [block],
            "rotators": [fellow, resident, outpatient_only],
            "inpatientAssignments": [
                {"id": "i1", "date": "2026-07-06", "rotatorId": "f1", "role": "Fellow", "source": "Manual"},
                {"id": "i2", "date": "2026-07-06", "rotatorId": "r1", "role": "Resident", "source": "Manual"},
                {"id": "i3", "date": "2026-07-07", "rotatorId": "r1", "role": "Resident", "source": "Manual"},
                {"id": "i4", "date": "2026-07-08", "rotatorId": "r1", "role": "Off", "source": "Manual"},
            ],
            "outpatientSessions": [
                {"id": "o1", "date": "2026-07-08", "period": "AM", "clinic": "General Neuro",
                 "provider": "Elm", "rotatorId": "r2", "status": "Scheduled", "source": "Manual"},
                {"id": "o2", "date": "2026-07-08", "period": "PM", "clinic": "General Neuro",
                 "provider": "Elm", "rotatorId": "r2", "status": "Scheduled", "source": "Manual"},
            ],
        }
    )
    return state


def _write_bundle(state: dict, tmp_path) -> dict[str, str]:
    files = build_coordinator_bundle(state)
    paths: dict[str, str] = {}
    for entry in files:
        target = tmp_path / entry["name"]
        target.write_bytes(base64.b64decode(entry["base64"]))
        for kind in ("master", "inpatient", "outpatient"):
            if kind in entry["name"] and entry["name"].endswith(".docx"):
                paths[kind] = str(target)
    return paths


def test_bundle_produces_six_files_with_valid_headers(july_state):
    files = build_coordinator_bundle(july_state)
    assert len(files) == 6
    for entry in files:
        raw = base64.b64decode(entry["base64"])
        if entry["name"].endswith(".pdf"):
            assert raw.startswith(b"%PDF-1.4")
            assert raw.rstrip().endswith(b"%%EOF")
        else:
            assert raw.startswith(b"PK")


def test_master_pdf_is_landscape(july_state):
    files = build_coordinator_bundle(july_state)
    master_pdf = next(f for f in files if f["name"].endswith("master-schedule.pdf"))
    raw = base64.b64decode(master_pdf["base64"])
    assert b"/MediaBox [0 0 792 612]" in raw  # width > height


def test_bundle_round_trips_through_coordinator_importer(july_state, tmp_path):
    paths = _write_bundle(july_state, tmp_path)
    parsed = parse_coordinator_docx_bundle(paths["master"], paths["inpatient"], paths["outpatient"])

    master = parsed["master"]
    names = {r["fullName"] for r in master["rotators"]}
    assert "Eden Walsh" in names
    assert "Eden Walsh" in master["fellows"]

    by_key = {
        (r["fullName"], d["date"]): d for r in master["rotators"] for d in r["daily"]
    }
    assert by_key[("Eden Walsh", "2026-07-06")]["status"] == "IP"
    assert by_key[("Chandler Dykstra", "2026-07-06")]["status"] == "IP"
    assert by_key[("Chandler Dykstra", "2026-07-08")]["status"] == "OFF"
    assert by_key[("Kai Doe", "2026-07-08")]["status"] == "OP"
    # Continuity superscript survives: Tuesday PM clinic on 7/7 (a Tuesday).
    assert by_key[("Chandler Dykstra", "2026-07-07")]["period"] == "PM"

    coverage = master["coverageRows"]
    assert coverage["Inpatient coverage"]["2026-07-06"] == 2
    assert coverage["Outpatient coverage"]["2026-07-08"] == 1

    assert parsed["acceptance"]["unresolvedNames"] == 0

    inpatient_by_date: dict[str, list[str]] = {}
    for record in parsed["inpatient"]["records"]:
        inpatient_by_date.setdefault(record["date"], []).append(record.get("name") or record.get("fullName") or "")
    assert sorted(inpatient_by_date.get("2026-07-06", [])) == ["Chandler Dykstra", "Eden Walsh"]

    outpatient_dates = {s["date"] for s in parsed["outpatient"]["sessions"]}
    assert "2026-07-08" in outpatient_dates
