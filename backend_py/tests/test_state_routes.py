"""GET/POST /api/scheduler/state — persistence routes.

Mirrors backend/tests/server.test.mjs: GET returns persisted state if
present, else a fresh initial state (200) — on first launch AND on a
corrupt/unreadable file. (Supersedes the earlier 404-on-first-launch
behavior from commit e5c976b; returning 200 keeps a new install's browser
console clean.) POST validates against scheduler-state.v1 (400 invalid,
500 IO failure, 413 oversized).
"""

import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from backend_py.contracts import validate
from backend_py.domain.rotators import make_rotator
from backend_py.main import create_app

FIXTURES = Path(__file__).resolve().parent / "fixtures"
REPO_ROOT = Path(__file__).resolve().parents[2]


def _initial_state():
    return json.loads((FIXTURES / "initial-state.json").read_text(encoding="utf-8"))


def _populated_state():
    return json.loads((REPO_ROOT / "contracts" / "golden" / "populated-state.json").read_text(encoding="utf-8"))


def _write_xlsx(path: Path, rows: list[list[str]]) -> Path:
    def cell_ref(row_index: int, col_index: int) -> str:
        letters = ""
        n = col_index + 1
        while n:
            n, rem = divmod(n - 1, 26)
            letters = chr(ord("A") + rem) + letters
        return f"{letters}{row_index + 1}"

    sheet_rows = []
    for row_index, row in enumerate(rows):
        cells = []
        for col_index, value in enumerate(row):
            ref = cell_ref(row_index, col_index)
            cells.append(
                f'<c r="{ref}" t="inlineStr"><is><t>{value}</t></is></c>'
            )
        sheet_rows.append(f'<row r="{row_index + 1}">{"".join(cells)}</row>')

    with zipfile.ZipFile(path, "w") as book:
        book.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<workbook><sheets><sheet name="Roster" sheetId="1" id="rId1"/></sheets></workbook>',
        )
        book.writestr(
            "xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
            "</Relationships>",
        )
        book.writestr(
            "xl/worksheets/sheet1.xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            f'<worksheet><sheetData>{"".join(sheet_rows)}</sheetData></worksheet>',
        )
    return path


def test_get_state_returns_initial_state_on_first_launch(tmp_path):
    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.get("/api/scheduler/state")
        assert response.status_code == 200
        body = response.json()
        assert validate("scheduler-state.v1", body) == []
        # Non-authoritative so the frontend won't adopt it over localStorage.
        assert body["rotators"] == []
        assert len(body["serviceBlocks"]) == 1


def test_post_then_get_round_trips(tmp_path):
    state = _initial_state()
    state["serviceBlocks"][0]["name"] = "Round-trip Test Block"
    with TestClient(create_app(data_dir=tmp_path)) as client:
        post = client.post("/api/scheduler/state", json=state)
        assert post.status_code == 200
        assert post.json() == {"ok": True}

        get = client.get("/api/scheduler/state")
        assert get.status_code == 200
        assert get.json() == state


def test_state_boundary_repairs_legacy_psychiatry_fellow_role(tmp_path):
    state = _initial_state()
    block = state["serviceBlocks"][0]
    kai = make_rotator(
        "rot-kai",
        "Kai Doe",
        "UT Psychiatry",
        "PGY-5",
        [{"start": block["startDate"], "end": block["endDate"]}],
    )
    kai["role"] = "Fellow"
    state["rotators"] = [kai]
    state["inpatientAssignments"] = [{
        "id": "keep-this-id",
        "date": block["startDate"],
        "rotatorId": "rot-kai",
        "role": "Fellow",
        "source": "Auto-Draft",
    }]

    with TestClient(create_app(data_dir=tmp_path)) as client:
        assert client.post("/api/scheduler/state", json=state).status_code == 200
        loaded = client.get("/api/scheduler/state").json()

    assert loaded["rotators"][0]["role"] == "Resident"
    assert loaded["rotators"][0]["level"] == "PGY-5"
    assert loaded["inpatientAssignments"][0]["id"] == "keep-this-id"
    assert loaded["inpatientAssignments"][0]["role"] == "Resident"


def test_post_then_get_populated_state_round_trips(tmp_path):
    state = _populated_state()
    with TestClient(create_app(data_dir=tmp_path)) as client:
        post = client.post("/api/scheduler/state", json=state)
        assert post.status_code == 200
        assert post.json() == {"ok": True}

        get = client.get("/api/scheduler/state")
        assert get.status_code == 200
        assert get.json() == state

    assert state["sources"][0]["importWarningCount"] == 1
    assert state["clinicAssignments"][0]["session"] == "PM"
    assert state["posterSettings"]["locations"] == [
        {"name": "Main Campus", "address": "123 Example Way"}
    ]


def test_post_invalid_state_returns_400(tmp_path):
    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post(
            "/api/scheduler/state",
            json={"version": "not-a-number", "serviceBlocks": "not-an-array"},
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "invalid state"
        assert isinstance(body["details"], list)


@pytest.mark.parametrize(
    ("mutate", "expected_detail"),
    [
        (
            lambda state: state["sources"][0].__setitem__("importWarningCount", None),
            "sources/0/importWarningCount",
        ),
        (
            lambda state: state["sources"][0].__setitem__("importWarnings", [123]),
            "sources/0/importWarnings/0",
        ),
        (
            lambda state: state["clinicAssignments"][0].__setitem__("session", "MIDDAY"),
            "clinicAssignments/0/session",
        ),
        (
            lambda state: state["clinicAssignments"][0].pop("clinicOccurrenceId"),
            "clinicAssignments/0",
        ),
        (
            lambda state: state["clinicAssignments"][0].__setitem__("date", "not-a-date"),
            "clinicAssignments/0/date",
        ),
        (
            lambda state: state["posterSettings"].__setitem__("notes", "Bring badge"),
            "posterSettings/notes",
        ),
        (
            lambda state: state["posterSettings"]["locations"][0].__setitem__("address", 42),
            "posterSettings/locations/0/address",
        ),
    ],
)
def test_post_rejects_malformed_declared_state_fields(tmp_path, mutate, expected_detail):
    state = _populated_state()
    mutate(state)
    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post("/api/scheduler/state", json=state)

    assert response.status_code == 400
    body = response.json()
    assert body["error"] == "invalid state"
    assert any(expected_detail in detail for detail in body["details"])


def test_post_bare_string_attendings_rejected(tmp_path):
    state = _initial_state()
    state["attendings"] = ["Alder", "Birch"]  # pre-migration shape
    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post("/api/scheduler/state", json=state)
        assert response.status_code == 400


def test_get_returns_initial_state_on_corrupt_file(tmp_path):
    # Node returns initial state when the file won't parse; match that.
    (tmp_path / "scheduler-state.json").write_text("{ broken", encoding="utf-8")
    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.get("/api/scheduler/state")
        assert response.status_code == 200
        assert validate("scheduler-state.v1", response.json()) == []


def test_post_rejects_oversized_body_with_413(tmp_path, monkeypatch):
    # Shrink the cap so a tiny body trips it without allocating 30 MB.
    import backend_py.main as main_module

    monkeypatch.setattr(main_module, "MAX_BODY_BYTES", 5)
    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post("/api/scheduler/state", json={"version": 2})
        assert response.status_code == 413


def test_post_rejects_oversized_chunked_body_without_content_length(tmp_path, monkeypatch):
    # BE-001: a body delivered WITHOUT a usable Content-Length (chunked /
    # streamed) must still be rejected with 413 — the cap can't be bypassed
    # by omitting the header, and the body is never buffered past the cap.
    import backend_py.main as main_module

    monkeypatch.setattr(main_module, "MAX_BODY_BYTES", 100)

    def chunked_body():
        # Two chunks, 60 bytes each = 120 > cap. Passing a generator as the
        # request content makes httpx use Transfer-Encoding: chunked and omit
        # Content-Length, so only the stream-accumulation path can catch this.
        yield b"x" * 60
        yield b"x" * 60

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post(
            "/api/scheduler/state",
            content=chunked_body(),
            headers={"content-type": "application/json"},
        )
        # No Content-Length header means the fast-path can't fire; the 413
        # proves the stream loop aborted once accumulated bytes exceeded the cap.
        assert "content-length" not in response.request.headers
        assert response.status_code == 413
        assert response.json() == {"error": "payload too large"}


def test_import_routes_reject_oversized_chunked_json_without_content_length(tmp_path, monkeypatch):
    import backend_py.main as main_module

    monkeypatch.setattr(main_module, "MAX_BODY_BYTES", 100)

    def chunked_body():
        yield b"x" * 60
        yield b"x" * 60

    with TestClient(create_app(data_dir=tmp_path)) as client:
        roster_response = client.post(
            "/api/import/roster",
            content=chunked_body(),
            headers={"content-type": "application/json"},
        )
        coordinator_response = client.post(
            "/api/import/coordinator-docx",
            content=chunked_body(),
            headers={"content-type": "application/json"},
        )

    assert "content-length" not in roster_response.request.headers
    assert roster_response.status_code == 413
    assert roster_response.json() == {"error": "payload too large"}
    assert coordinator_response.status_code == 413
    assert coordinator_response.json() == {"error": "payload too large"}


def test_post_persist_failure_returns_500_without_leaking_path(tmp_path, monkeypatch):
    # BE-004: when save fails, the 500 body must be a generic message and
    # must NOT contain the absolute filesystem path from the failure reason.
    import backend_py.main as main_module

    leaked_path = "/var/secret/abs/path/scheduler-state.json"

    def fake_save(_state, _data_dir):
        return {
            "ok": False,
            "reason": "ENOENT",
            "message": f"[Errno 2] No such file or directory: '{leaked_path}'",
        }

    # Patch at the import site (main.py did `from ... import save_state_to_disk`).
    monkeypatch.setattr(main_module, "save_state_to_disk", fake_save)

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post("/api/scheduler/state", json=_initial_state())
        assert response.status_code == 500
        # Generic body only — substring scan catches a leak in ANY field.
        assert leaked_path not in response.text
        assert "/var/secret" not in response.text
        assert response.json() == {"error": "could not persist state"}


def test_default_coordinator_docx_import_returns_404_when_sources_missing(tmp_path, monkeypatch):
    import backend_py.main as main_module

    monkeypatch.setattr(
        main_module,
        "default_coordinator_docx_paths",
        lambda: {
            "master": tmp_path / "missing-master.docx",
            "inpatient": tmp_path / "missing-inpatient.docx",
            "outpatient": tmp_path / "missing-outpatient.docx",
        },
    )

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post("/api/import/coordinator-docx/default")

    assert response.status_code == 404
    assert response.json()["error"] == "missing Coordinator DOCX source files"


def test_default_coordinator_docx_import_returns_valid_scheduler_preview(tmp_path, monkeypatch):
    import backend_py.main as main_module

    master = tmp_path / "master.docx"
    inpatient = tmp_path / "inpatient.docx"
    outpatient = tmp_path / "outpatient.docx"
    for path in (master, inpatient, outpatient):
        path.write_bytes(b"placeholder")

    state = _initial_state()
    state["sources"] = [
        {
            "id": "source-coordinator-docx-july-2026",
            "importedAt": "2026-07-05",
            "status": "Reviewed",
            "program": "Other",
            "fileType": "docx-bundle",
            "fileName": "Coordinator July 2026 DOCX schedule bundle",
            "importedRotatorCount": 0,
        }
    ]

    fake_preview = {
        "sourceFiles": {
            "master": str(master),
            "inpatient": str(inpatient),
            "outpatient": str(outpatient),
        },
        "acceptance": {
            "unresolvedNames": 0,
            "rotators": 0,
            "inpatientAssignments": 0,
            "outpatientSessions": 0,
            "halfDayAnnotations": 0,
            "halfDayFacts": 0,
        },
        "warnings": [],
        "reconciliation": {"counts": {"mismatches": 0, "coverageMismatches": 0}},
        "schedulerStatePreview": state,
    }

    monkeypatch.setattr(
        main_module,
        "default_coordinator_docx_paths",
        lambda: {"master": master, "inpatient": inpatient, "outpatient": outpatient},
    )
    monkeypatch.setattr(main_module, "parse_coordinator_docx_bundle", lambda **_paths: fake_preview)

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post("/api/import/coordinator-docx/default")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["acceptance"]["unresolvedNames"] == 0
    assert validate("scheduler-state.v1", body["schedulerStatePreview"]) == []


def test_default_coordinator_docx_paths_are_user_relative(monkeypatch, tmp_path):
    import backend_py.coordinator_docx_import as coordinator_module

    monkeypatch.setattr(coordinator_module.Path, "home", lambda: tmp_path)

    paths = coordinator_module.default_coordinator_docx_paths()

    assert paths == {
        "master": tmp_path / "Downloads" / "July_2026_Master_Schedule.docx",
        "inpatient": tmp_path / "Downloads" / "July_2026_Inpatient_Roster.docx",
        "outpatient": tmp_path / "Downloads" / "July_2026_Outpatient_Assignments.docx",
    }


def test_explicit_coordinator_docx_import_uses_selected_paths(tmp_path, monkeypatch):
    import backend_py.main as main_module

    master = tmp_path / "July_2026_Master_Schedule.docx"
    inpatient = tmp_path / "July_2026_Inpatient_Roster.docx"
    outpatient = tmp_path / "July_2026_Outpatient_Assignments.docx"
    for path in (master, inpatient, outpatient):
        path.write_bytes(b"placeholder")

    state = _initial_state()
    calls = []

    fake_preview = {
        "sourceFiles": {
            "master": str(master),
            "inpatient": str(inpatient),
            "outpatient": str(outpatient),
        },
        "acceptance": {
            "unresolvedNames": 0,
            "rotators": 0,
            "inpatientAssignments": 0,
            "outpatientSessions": 0,
            "halfDayAnnotations": 0,
            "halfDayFacts": 0,
        },
        "warnings": [],
        "reconciliation": {"counts": {"mismatches": 0, "coverageMismatches": 0}},
        "schedulerStatePreview": state,
    }

    def fake_parse_coordinator_docx_bundle(**paths):
        calls.append(paths)
        return fake_preview

    monkeypatch.setattr(main_module, "parse_coordinator_docx_bundle", fake_parse_coordinator_docx_bundle)

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post(
            "/api/import/coordinator-docx",
            json={
                "masterPath": str(master),
                "inpatientPath": str(inpatient),
                "outpatientPath": str(outpatient),
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["sourceFiles"]["master"] == str(master)
    assert calls == [
        {
            "master_path": master,
            "inpatient_path": inpatient,
            "outpatient_path": outpatient,
        }
    ]


def test_explicit_coordinator_docx_import_rejects_non_string_paths(tmp_path):
    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post(
            "/api/import/coordinator-docx",
            json={
                "masterPath": ["not", "a", "path"],
                "inpatientPath": "inpatient.docx",
                "outpatientPath": "outpatient.docx",
            },
        )

    assert response.status_code == 400
    assert response.json() == {
        "error": "Coordinator DOCX path fields must be strings",
        "invalid": ["masterPath"],
    }


def test_explicit_coordinator_docx_import_rejects_relative_or_url_paths(tmp_path):
    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post(
            "/api/import/coordinator-docx",
            json={
                "masterPath": "relative-master.docx",
                "inpatientPath": "file:///tmp/inpatient.docx",
                "outpatientPath": str(tmp_path / "outpatient.docx"),
            },
        )

    assert response.status_code == 400
    assert response.json() == {
        "error": "Coordinator DOCX path fields must be absolute local filesystem paths",
        "invalid": ["masterPath", "inpatientPath"],
    }


def test_explicit_coordinator_docx_import_rejects_non_docx_before_parse(tmp_path, monkeypatch):
    import backend_py.main as main_module

    master = tmp_path / "master.txt"
    inpatient = tmp_path / "inpatient.docx"
    outpatient = tmp_path / "outpatient.docx"
    for path in (master, inpatient, outpatient):
        path.write_bytes(b"ok")

    def fail_parse(**_paths):
        raise AssertionError("non-DOCX source should be rejected before DOCX parsing")

    monkeypatch.setattr(main_module, "parse_coordinator_docx_bundle", fail_parse)

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post(
            "/api/import/coordinator-docx",
            json={
                "masterPath": str(master),
                "inpatientPath": str(inpatient),
                "outpatientPath": str(outpatient),
            },
        )

    assert response.status_code == 400
    assert response.json()["error"] == "Coordinator sources must be .docx files"
    assert response.json()["invalid"] == [str(master)]


def test_explicit_coordinator_docx_import_rejects_oversized_source_before_parse(tmp_path, monkeypatch):
    import backend_py.main as main_module

    master = tmp_path / "July_2026_Master_Schedule.docx"
    inpatient = tmp_path / "July_2026_Inpatient_Roster.docx"
    outpatient = tmp_path / "July_2026_Outpatient_Assignments.docx"
    master.write_bytes(b"x" * 11)
    inpatient.write_bytes(b"ok")
    outpatient.write_bytes(b"ok")
    monkeypatch.setattr(main_module, "MAX_SOURCE_FILE_BYTES", 10)

    def fail_parse(**_paths):
        raise AssertionError("oversized source should be rejected before DOCX parsing")

    monkeypatch.setattr(main_module, "parse_coordinator_docx_bundle", fail_parse)

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post(
            "/api/import/coordinator-docx",
            json={
                "masterPath": str(master),
                "inpatientPath": str(inpatient),
                "outpatientPath": str(outpatient),
            },
        )

    assert response.status_code == 413
    assert response.json() == {
        "error": "source file is too large",
        "fileName": "July_2026_Master_Schedule.docx",
        "bytes": 11,
        "maxBytes": 10,
    }
    assert str(master) not in response.text


def test_roster_import_csv_merges_by_name_and_records_source(tmp_path):
    state = _initial_state()
    state["rotators"] = [
        make_rotator(
            "rot-ari-stable",
            "Drew Quinn",
            "UT Pediatrics",
            "PGY-2",
            [{"start": "2026-07-01", "end": "2026-07-07"}],
        )
    ]
    roster = tmp_path / "July roster.csv"
    roster.write_text(
        "\n".join(
            [
                "Name,Program,Level,Start,End,Continuity Clinic,Day Off,Unavailable",
                "Drew Quinn,UT Pediatrics,PGY-3,2026-07-08,2026-07-14,Tuesday PM,Mon-Wed,2026-07-12 to 2026-07-13",
                "Noah Patel,Methodist,Fellow,7/15/26,7/28/26,,Friday,",
            ]
        ),
        encoding="utf-8",
    )

    with TestClient(create_app(data_dir=tmp_path)) as client:
        assert client.post("/api/scheduler/state", json=state).status_code == 200
        response = client.post("/api/import/roster", json={"filePath": str(roster)})

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["acceptance"]["added"] == 1
    assert body["acceptance"]["updated"] == 1
    preview = body["schedulerStatePreview"]
    assert validate("scheduler-state.v1", preview) == []
    assert len(preview["rotators"]) == 2
    ari = next(rotator for rotator in preview["rotators"] if rotator["fullName"] == "Drew Quinn")
    assert ari["id"] == "rot-ari-stable"
    assert ari["level"] == "PGY-3"
    assert ari["segments"] == [
        {"start": "2026-07-01", "end": "2026-07-07"},
        {"start": "2026-07-08", "end": "2026-07-14"},
    ]
    assert ari["dayOff"] == ["Monday", "Tuesday", "Wednesday"]
    assert ari["unavailableRanges"] == [{"start": "2026-07-12", "end": "2026-07-13"}]
    assert preview["sources"][-1]["fileName"] == "July roster.csv"
    assert preview["sources"][-1]["importedRotatorCount"] == 2


def test_roster_import_csv_rotation_start_applies_to_methodist_only(tmp_path):
    state = _initial_state()
    roster = tmp_path / "rotation-start.csv"
    roster.write_text(
        "\n".join(
            [
                "Name,Program,Level,Start,End,Methodist Start",
                "Noah Patel,Methodist,Fellow,2026-07-15,2026-07-28,2026-07-01",
                "Drew Quinn,UT Pediatrics,PGY-3,2026-07-08,2026-07-14,2026-07-01",
            ]
        ),
        encoding="utf-8",
    )

    with TestClient(create_app(data_dir=tmp_path)) as client:
        assert client.post("/api/scheduler/state", json=state).status_code == 200
        response = client.post("/api/import/roster", json={"filePath": str(roster)})

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    preview = body["schedulerStatePreview"]
    assert validate("scheduler-state.v1", preview) == []
    noah = next(rotator for rotator in preview["rotators"] if rotator["fullName"] == "Noah Patel")
    ari = next(rotator for rotator in preview["rotators"] if rotator["fullName"] == "Drew Quinn")
    assert noah["schoolType"] == "methodist"
    assert noah["rotationStartDate"] == "2026-07-01"
    assert ari["schoolType"] != "methodist"
    assert "rotationStartDate" not in ari or not ari["rotationStartDate"]
    # Start date present — no missing-rotation-start import warning.
    assert not any("without a rotation start date" in warning for warning in body["warnings"])


def test_roster_import_csv_without_rotation_start_column_leaves_it_unset(tmp_path):
    state = _initial_state()
    roster = tmp_path / "no-rotation-start.csv"
    roster.write_text(
        "\n".join(
            [
                "Name,Program,Level,Start,End",
                "Noah Patel,Methodist,Fellow,2026-07-15,2026-07-28",
            ]
        ),
        encoding="utf-8",
    )

    with TestClient(create_app(data_dir=tmp_path)) as client:
        assert client.post("/api/scheduler/state", json=state).status_code == 200
        response = client.post("/api/import/roster", json={"filePath": str(roster)})

    assert response.status_code == 200
    body = response.json()
    preview = body["schedulerStatePreview"]
    assert validate("scheduler-state.v1", preview) == []
    noah = next(rotator for rotator in preview["rotators"] if rotator["fullName"] == "Noah Patel")
    assert noah["schoolType"] == "methodist"
    assert "rotationStartDate" not in noah or not noah["rotationStartDate"]
    # Missing 14/14 anchor surfaces at import time, naming the rotator.
    assert any(
        "without a rotation start date" in warning and "Noah Patel" in warning
        for warning in body["warnings"]
    )


def test_roster_import_csv_methodist_rotation_start_date_header(tmp_path):
    state = _initial_state()
    roster = tmp_path / "methodist-rotation-start-date.csv"
    roster.write_text(
        "\n".join(
            [
                "Name,Program,Level,Start,End,Methodist Rotation Start Date",
                "Noah Patel,Methodist,Fellow,2026-07-15,2026-07-28,2026-07-01",
            ]
        ),
        encoding="utf-8",
    )

    with TestClient(create_app(data_dir=tmp_path)) as client:
        assert client.post("/api/scheduler/state", json=state).status_code == 200
        response = client.post("/api/import/roster", json={"filePath": str(roster)})

    assert response.status_code == 200
    body = response.json()
    preview = body["schedulerStatePreview"]
    assert validate("scheduler-state.v1", preview) == []
    noah = next(rotator for rotator in preview["rotators"] if rotator["fullName"] == "Noah Patel")
    assert noah["rotationStartDate"] == "2026-07-01"
    assert not any("without a rotation start date" in warning for warning in body["warnings"])


def test_roster_import_modes_replace_or_append_rotators(tmp_path):
    state = _initial_state()
    state["rotators"] = [
        make_rotator(
            "rot-ari-stable",
            "Drew Quinn",
            "UT Pediatrics",
            "PGY-2",
            [{"start": "2026-07-01", "end": "2026-07-07"}],
        ),
        make_rotator(
            "rot-sam-stable",
            "Sam Carter",
            "Methodist",
            "PGY-3",
            [{"start": "2026-07-01", "end": "2026-07-31"}],
        ),
    ]
    roster = tmp_path / "replacement.csv"
    roster.write_text(
        "\n".join(
            [
                "Name,Program,Level,Start,End",
                "Drew Quinn,UT Pediatrics,PGY-4,2026-07-08,2026-07-14",
            ]
        ),
        encoding="utf-8",
    )

    with TestClient(create_app(data_dir=tmp_path)) as client:
        assert client.post("/api/scheduler/state", json=state).status_code == 200

        replace = client.post("/api/import/roster", json={"filePath": str(roster), "mode": "replace"}).json()
        assert replace["ok"] is True
        assert replace["acceptance"]["added"] == 1
        assert replace["acceptance"]["updated"] == 0
        assert replace["acceptance"]["removed"] == 2
        replace_preview = replace["schedulerStatePreview"]
        assert validate("scheduler-state.v1", replace_preview) == []
        assert [rotator["fullName"] for rotator in replace_preview["rotators"]] == ["Drew Quinn"]
        assert replace_preview["rotators"][0]["id"] != "rot-ari-stable"

        add = client.post("/api/import/roster", json={"filePath": str(roster), "mode": "add"}).json()
        assert add["ok"] is True
        assert add["acceptance"]["added"] == 1
        assert add["acceptance"]["updated"] == 0
        assert add["acceptance"]["removed"] == 0
        add_preview = add["schedulerStatePreview"]
        assert validate("scheduler-state.v1", add_preview) == []
        assert len(add_preview["rotators"]) == 3
        assert [rotator["fullName"] for rotator in add_preview["rotators"]].count("Drew Quinn") == 2


def test_roster_import_column_mapping_and_source_replacement(tmp_path):
    state = _initial_state()
    state["sources"] = [
        {
            "id": "source-old-roster",
            "importedAt": "2026-06-01",
            "status": "Reviewed",
            "program": "Other",
            "fileName": "old.csv",
            "fileType": "csv",
            "content": "",
            "parsedRows": [],
            "importedRotatorCount": 0,
        }
    ]
    roster = tmp_path / "remapped.csv"
    roster.write_text(
        "\n".join(
            [
                "Name,Start,Start,End,Program,Level",
                "Maya Lopez,2026-07-01,2026-07-08,2026-07-14,UT Pediatrics,Fellow",
            ]
        ),
        encoding="utf-8",
    )

    with TestClient(create_app(data_dir=tmp_path)) as client:
        assert client.post("/api/scheduler/state", json=state).status_code == 200
        response = client.post(
            "/api/import/roster",
            json={
                "filePath": str(roster),
                "replaceSourceId": "source-old-roster",
                "columnMapping": {
                    "fullName": 0,
                    "startDate": 2,
                    "endDate": 3,
                    "program": 4,
                    "level": 5,
                },
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["replaceSourceId"] == "source-old-roster"
    assert body["importMeta"]["detectedMapping"]["startDate"] == 1
    assert body["importMeta"]["columnMapping"]["startDate"] == 2
    assert body["columnsFound"] == ["endDate", "fullName", "level", "program", "startDate"]
    preview = body["schedulerStatePreview"]
    assert validate("scheduler-state.v1", preview) == []
    assert len(preview["sources"]) == 1
    assert preview["sources"][0]["id"] == "source-old-roster"
    assert preview["sources"][0]["fileName"] == "remapped.csv"
    assert preview["sources"][0]["importedRotatorCount"] == 1
    assert preview["sources"][0]["parsedRows"][0]["segments"] == [
        {"start": "2026-07-08", "end": "2026-07-14"}
    ]
    assert preview["rotators"][0]["fullName"] == "Maya Lopez"
    assert preview["rotators"][0]["segments"] == [{"start": "2026-07-08", "end": "2026-07-14"}]


def test_roster_import_xlsx_template_returns_valid_preview(tmp_path):
    roster = _write_xlsx(
        tmp_path / "template-roster.xlsx",
        [
            ["Name", "Program", "Level", "Start", "End", "Continuity Clinic"],
            ["Maya Lopez", "Pediatric Neurology", "PGY-5", "2026-07-01", "2026-07-28", "Thursday AM"],
        ],
    )

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post("/api/import/roster", json={"filePath": str(roster)})

    assert response.status_code == 200
    body = response.json()
    assert body["acceptance"]["added"] == 1
    assert "fullName" in body["columnsFound"]
    preview = body["schedulerStatePreview"]
    assert validate("scheduler-state.v1", preview) == []
    maya = preview["rotators"][0]
    # Coordinator 2026-07-29 #1: fellow signal now wins the label too.
    assert maya["program"] == "UT Pediatric Neurology Fellow"
    assert maya["role"] == "Fellow"
    assert maya["continuityClinic"] == "Thursday AM"
    assert preview["sources"][-1]["fileType"] == "xlsx"


def test_roster_import_xlsx_uses_download_filename_program_hint(tmp_path):
    roster = _write_xlsx(
        tmp_path / "Methodist_Adult_Neurology_Roster_Template.xlsx",
        [
            ["Name", "Level", "Start", "End"],
            ["Maya Lopez", "PGY-3", "2026-08-01", "2026-08-31"],
        ],
    )

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post("/api/import/roster", json={"filePath": str(roster)})

    assert response.status_code == 200
    preview = response.json()["schedulerStatePreview"]
    assert preview["rotators"][0]["program"] == "Methodist"
    assert preview["sources"][-1]["program"] == "Methodist"


def test_roster_import_distinguishes_pedi_neuro_fellows_from_psych_rotators(tmp_path):
    fellow_roster = _write_xlsx(
        tmp_path / "Pedi Neuro Fellows Template.xlsx",
        [
            ["Name", "Level", "Start", "End"],
            ["Morgan Chu", "PGY-3", "2026-08-28", "2026-09-24"],
        ],
    )
    psych_roster = _write_xlsx(
        tmp_path / "Psych_Residents_Pedi_Neuro_Template.xlsx",
        [
            ["Name", "Level", "Start", "End"],
            ["Kai Doe", "PGY-5", "2026-09-01", "2026-09-30"],
        ],
    )

    with TestClient(create_app(data_dir=tmp_path)) as client:
        fellow_response = client.post("/api/import/roster", json={"filePath": str(fellow_roster)})
        psych_response = client.post("/api/import/roster", json={"filePath": str(psych_roster)})

    assert fellow_response.status_code == 200
    samantha = fellow_response.json()["schedulerStatePreview"]["rotators"][0]
    assert samantha["program"] == "UT Pediatric Neurology Fellow"
    assert samantha["role"] == "Fellow"

    assert psych_response.status_code == 200
    psych_preview = psych_response.json()["schedulerStatePreview"]
    kai = psych_preview["rotators"][0]
    assert kai["program"] == "UT Psychiatry"
    assert kai["role"] == "Resident"
    assert psych_preview["sources"][-1]["program"] == "UT Psychiatry"


def test_roster_import_xlsx_matrix_returns_valid_preview(tmp_path):
    roster = _write_xlsx(
        tmp_path / "matrix-roster.xlsx",
        [
            ["", "", "6/24/2026", "7/1/2026", "7/6/2026", "7/13/2026", "7/20/2026", "7/27/2026", "8/3/2026", "8/10/2026"],
            ["", "Week #", "0", "1", "2", "3", "4", "5", "6", "7"],
            ["1st", "Number of Residents", "0", "1", "1", "2", "2", "1", "1", "0"],
            ["2", "Jordan Lee", "", "b", "B", "B", "", "", "", ""],
            ["4", "Casey Moore", "", "!b", "", "B", "b", "", "", ""],
        ],
    )

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post("/api/import/roster", json={"filePath": str(roster)})

    assert response.status_code == 200
    body = response.json()
    assert body["acceptance"]["added"] == 2
    assert body["columnsFound"] == ["matrix"]
    assert body["importMeta"]["isMatrix"] is True
    assert body["importMeta"]["matrixBangBehavior"] == "present"
    assert body["importMeta"]["bangMarkedRotators"] == ["Casey Moore"]
    assert any("Casey Moore" in warning for warning in body["warnings"])
    preview = body["schedulerStatePreview"]
    assert validate("scheduler-state.v1", preview) == []
    assert preview["sources"][-1]["fileName"] == "matrix-roster.xlsx"
    assert preview["sources"][-1]["fileType"] == "xlsx"
    assert preview["sources"][-1]["importedRotatorCount"] == 2
    assert preview["sources"][-1]["importWarningCount"] == len(body["warnings"])
    assert any("Casey Moore" in warning for warning in preview["sources"][-1]["importWarnings"])
    assert len(preview["sources"][-1]["parsedRows"]) == 2

    jordan = next(rotator for rotator in preview["rotators"] if rotator["fullName"] == "Jordan Lee")
    assert jordan["program"] == "UT Pediatrics"
    assert jordan["level"] == "PGY-2"
    assert jordan["segments"] == [{"start": "2026-07-01", "end": "2026-07-19"}]

    casey = next(rotator for rotator in preview["rotators"] if rotator["fullName"] == "Casey Moore")
    assert casey["segments"] == [
        {"start": "2026-07-01", "end": "2026-07-05"},
        {"start": "2026-07-13", "end": "2026-07-26"},
    ]


def test_roster_import_xlsx_matrix_can_exclude_bang_marks(tmp_path):
    roster = _write_xlsx(
        tmp_path / "matrix-roster.xlsx",
        [
            ["", "", "6/24/2026", "7/1/2026", "7/6/2026", "7/13/2026", "7/20/2026", "7/27/2026"],
            ["", "Week #", "0", "1", "2", "3", "4", "5"],
            ["1st", "Number of Residents", "0", "1", "1", "2", "2", "1"],
            ["2", "Jordan Lee", "", "B", "B", "B", "", ""],
            ["4", "Casey Moore", "", "!B", "", "B", "B", ""],
            ["5", "Only Bang", "", "!B", "", "", "", ""],
        ],
    )

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post(
            "/api/import/roster",
            json={"filePath": str(roster), "matrixBangBehavior": "exclude"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["acceptance"]["added"] == 2
    assert body["columnsFound"] == ["matrix"]
    assert body["importMeta"]["isMatrix"] is True
    assert body["importMeta"]["matrixBangBehavior"] == "exclude"
    assert body["importMeta"]["bangMarkedRotators"] == ["Casey Moore", "Only Bang"]
    assert any("those weeks were excluded" in warning for warning in body["warnings"])
    assert any("Only Bang: no weeks marked present" in warning for warning in body["warnings"])

    preview = body["schedulerStatePreview"]
    assert validate("scheduler-state.v1", preview) == []
    assert [rotator["fullName"] for rotator in preview["rotators"]] == ["Jordan Lee", "Casey Moore"]
    casey = next(rotator for rotator in preview["rotators"] if rotator["fullName"] == "Casey Moore")
    assert casey["segments"] == [{"start": "2026-07-13", "end": "2026-07-26"}]


def test_roster_import_xlsm_matrix_returns_valid_preview(tmp_path):
    roster = _write_xlsx(
        tmp_path / "matrix-roster.xlsm",
        [
            ["", "", "6/24/2026", "7/1/2026", "7/6/2026", "7/13/2026", "7/20/2026", "7/27/2026"],
            ["", "Week #", "0", "1", "2", "3", "4", "5"],
            ["1", "Lower Bang", "", "!b", "", "", "", ""],
        ],
    )

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post("/api/import/roster", json={"filePath": str(roster)})

    assert response.status_code == 200
    body = response.json()
    assert body["columnsFound"] == ["matrix"]
    assert body["schedulerStatePreview"]["sources"][-1]["fileType"] == "xlsm"
    assert any("Lower Bang" in warning for warning in body["warnings"])
    rotator = body["schedulerStatePreview"]["rotators"][0]
    assert rotator["fullName"] == "Lower Bang"
    assert rotator["segments"] == [{"start": "2026-07-01", "end": "2026-07-05"}]


def test_roster_import_rejects_invalid_matrix_bang_behavior(tmp_path):
    roster = _write_xlsx(
        tmp_path / "matrix-roster.xlsx",
        [
            ["", "", "6/24/2026", "7/1/2026", "7/6/2026", "7/13/2026", "7/20/2026", "7/27/2026"],
            ["", "Week #", "0", "1", "2", "3", "4", "5"],
            ["1", "Lower Bang", "", "!b", "", "", "", ""],
        ],
    )

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post(
            "/api/import/roster",
            json={"filePath": str(roster), "matrixBangBehavior": "maybe"},
        )

    assert response.status_code == 400
    assert response.json() == {
        "error": "matrixBangBehavior must be present or exclude",
        "invalid": ["matrixBangBehavior"],
    }


def test_roster_import_rejects_unsupported_files(tmp_path):
    # .txt was never supported; .xls is intentionally unsupported everywhere
    # (the browser picker no longer offers it either — see
    # contracts/v1/roster-import-aliases.json browserExcelExtensions).
    for name in ("roster.txt", "roster.xls"):
        roster = tmp_path / name
        roster.write_text("Name\nAri Kim\n", encoding="utf-8")

        with TestClient(create_app(data_dir=tmp_path)) as client:
            response = client.post("/api/import/roster", json={"filePath": str(roster)})

        assert response.status_code == 400
        assert response.json()["error"] == "roster import supports .csv, .json, .xlsx, and .xlsm files"


def test_roster_import_rejects_relative_or_url_paths(tmp_path):
    with TestClient(create_app(data_dir=tmp_path)) as client:
        relative = client.post("/api/import/roster", json={"filePath": "relative.csv"})
        url_like = client.post("/api/import/roster", json={"filePath": "file:///tmp/roster.csv"})

    assert relative.status_code == 400
    assert relative.json() == {
        "error": "filePath must be an absolute local filesystem path",
        "invalid": ["filePath"],
    }
    assert url_like.status_code == 400
    assert url_like.json()["error"] == "filePath must be an absolute local filesystem path"


def test_roster_import_rejects_oversized_source_before_parse(tmp_path, monkeypatch):
    import backend_py.main as main_module

    roster = tmp_path / "huge-roster.csv"
    roster.write_bytes(b"x" * 11)
    monkeypatch.setattr(main_module, "MAX_SOURCE_FILE_BYTES", 10)

    def fail_import(*_args, **_kwargs):
        raise AssertionError("oversized source should be rejected before roster parsing")

    monkeypatch.setattr(main_module, "import_roster_file", fail_import)

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post("/api/import/roster", json={"filePath": str(roster)})

    assert response.status_code == 413
    assert response.json() == {
        "error": "source file is too large",
        "fileName": "huge-roster.csv",
        "bytes": 11,
        "maxBytes": 10,
    }
    assert str(roster) not in response.text


def test_roster_import_fellowship_wording_resolves_fellow_program(tmp_path):
    # Coordinator 2026-07-29 #1: "Fellowship" wording (not literal "Fellow"/PGY-5)
    # must still land the rotator as a labeled pedi-neuro fellow.
    roster = _write_xlsx(
        tmp_path / "Pediatric Neurology Fellowship Roster.xlsx",
        [
            ["Name", "Level", "Start", "End"],
            ["Eden Walsh", "PGY-6", "2026-08-28", "2026-09-24"],
        ],
    )

    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.post("/api/import/roster", json={"filePath": str(roster)})

    assert response.status_code == 200
    eden = response.json()["schedulerStatePreview"]["rotators"][0]
    assert eden["program"] == "UT Pediatric Neurology Fellow"
    assert eden["role"] == "Fellow"
