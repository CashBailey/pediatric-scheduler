"""GET /api/health parity with the Node backend.

backend/src/server.js returns {ok, name, version} where name/version come
from the repo package.json. The Python shell must return the same shape
with the same name/version, so the frontend (and the offline/handoff
contract checks) can't tell which backend answered.
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend_py.main import create_app

PKG = json.loads(
    (Path(__file__).resolve().parents[2] / "package.json").read_text(encoding="utf-8")
)


def test_health_returns_ok_name_version():
    with TestClient(create_app()) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        body = response.json()
        assert body["ok"] is True
        assert body["name"] == PKG["name"]
        assert body["version"] == PKG["version"]


def test_health_version_is_nonempty_string():
    with TestClient(create_app()) as client:
        body = client.get("/api/health").json()
        assert isinstance(body["version"], str)
        assert len(body["version"]) > 0


def test_runtime_returns_engine_and_data_paths(tmp_path):
    with TestClient(create_app(data_dir=tmp_path)) as client:
        response = client.get("/api/runtime")
        assert response.status_code == 200
        body = response.json()
        assert body["ok"] is True
        assert body["engineRoot"] == str(Path(__file__).resolve().parents[2])
        assert body["dataDir"] == str(tmp_path)
        assert isinstance(body["pid"], int)
        assert body["python"]
