"""Static file serving + the loopback-guarded entrypoint.

Static: create_app(static_dir=...) serves the built React bundle while
/api/* routes keep precedence (mounted after them). Entrypoint:
resolve_bind_config() reads host/port/trust from the environment exactly
like Node's startServer(), and assert_config_safe() runs the loopback
guard BEFORE any socket is bound.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend_py.main import create_app
from backend_py.run import assert_config_safe, resolve_bind_config


def _write_dist(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>Pedi</title>", encoding="utf-8")
    (dist / "app.js").write_text("console.log('hi')", encoding="utf-8")
    return dist


def test_static_serves_index_and_assets(tmp_path):
    dist = _write_dist(tmp_path)
    with TestClient(create_app(data_dir=tmp_path, static_dir=dist)) as client:
        root = client.get("/")
        assert root.status_code == 200
        assert "<title>Pedi</title>" in root.text

        asset = client.get("/app.js")
        assert asset.status_code == 200
        assert "console.log" in asset.text


def test_api_routes_take_precedence_over_static(tmp_path):
    dist = _write_dist(tmp_path)
    with TestClient(create_app(data_dir=tmp_path, static_dir=dist)) as client:
        # /api/health must still be the JSON route, not shadowed by static.
        body = client.get("/api/health").json()
        assert body["ok"] is True


def test_no_static_dir_leaves_api_working(tmp_path):
    with TestClient(create_app(data_dir=tmp_path)) as client:
        assert client.get("/api/health").status_code == 200


def test_resolve_bind_config_defaults(monkeypatch):
    for var in ("PEDI_SCHEDULER_BIND_HOST", "PORT", "PEDI_SCHEDULER_TRUST_BIND"):
        monkeypatch.delenv(var, raising=False)
    config = resolve_bind_config()
    assert config.host == "127.0.0.1"
    assert config.port == 6174
    assert config.trusted is False


def test_resolve_bind_config_reads_env(monkeypatch):
    monkeypatch.setenv("PEDI_SCHEDULER_BIND_HOST", "0.0.0.0")
    monkeypatch.setenv("PORT", "6175")
    monkeypatch.setenv("PEDI_SCHEDULER_TRUST_BIND", "1")
    config = resolve_bind_config()
    assert config.host == "0.0.0.0"
    assert config.port == 6175
    assert config.trusted is True


def test_assert_config_safe_rejects_wildcard_when_untrusted(monkeypatch):
    monkeypatch.setenv("PEDI_SCHEDULER_BIND_HOST", "0.0.0.0")
    monkeypatch.delenv("PEDI_SCHEDULER_TRUST_BIND", raising=False)
    with pytest.raises(ValueError, match="loopback"):
        assert_config_safe(resolve_bind_config())


def test_assert_config_safe_allows_wildcard_when_trusted(monkeypatch):
    monkeypatch.setenv("PEDI_SCHEDULER_BIND_HOST", "0.0.0.0")
    monkeypatch.setenv("PEDI_SCHEDULER_TRUST_BIND", "1")
    assert_config_safe(resolve_bind_config())  # must not raise


def test_assert_config_safe_allows_default_loopback(monkeypatch):
    for var in ("PEDI_SCHEDULER_BIND_HOST", "PEDI_SCHEDULER_TRUST_BIND"):
        monkeypatch.delenv(var, raising=False)
    assert_config_safe(resolve_bind_config())  # 127.0.0.1, must not raise
