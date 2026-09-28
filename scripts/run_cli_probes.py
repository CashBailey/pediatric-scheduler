#!/usr/bin/env python3
"""Layer B verification probes for the local-only Scheduler backend.

These probes assert system effects that a browser screenshot cannot prove:
health metadata, JSON-file persistence, validation failures, static/API route
precedence, and loopback-only exposure. They write durable markdown + JSON
artifacts for the project verification runner.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend_py.bind import assert_safe_bind  # noqa: E402
from backend_py.initial_state import create_initial_state  # noqa: E402
from backend_py.main import create_app  # noqa: E402
from backend_py.persistence import STATE_FILENAME  # noqa: E402


@dataclass
class ProbeResult:
    id: str
    name: str
    status: str
    detail: str
    artifact: str = ""


def _load_package() -> dict[str, str]:
    return json.loads((ROOT / "package.json").read_text(encoding="utf-8"))


def _probe_health_matches_package() -> ProbeResult:
    package = _load_package()
    with tempfile.TemporaryDirectory() as tmp:
        with TestClient(create_app(data_dir=tmp)) as client:
            response = client.get("/api/health")
            assert response.status_code == 200
            body = response.json()
    assert body["ok"] is True
    assert body["name"] == package["name"]
    assert body["version"] == package["version"]
    return ProbeResult(
        "T-SCH-CLI-001",
        "Health metadata matches package.json",
        "PASS",
        f"/api/health returned {body['name']} {body['version']}.",
    )


def _probe_persistence_round_trip(results_dir: Path, stamp: str) -> ProbeResult:
    results_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        data_dir = Path(tmp)
        state = create_initial_state()
        state["serviceBlocks"][0]["name"] = "CLI Probe Round Trip"
        with TestClient(create_app(data_dir=data_dir)) as client:
            post = client.post("/api/scheduler/state", json=state)
            assert post.status_code == 200
            assert post.json() == {"ok": True}
            get = client.get("/api/scheduler/state")
            assert get.status_code == 200
            assert get.json() == state
        persisted = json.loads((data_dir / STATE_FILENAME).read_text(encoding="utf-8"))
        assert persisted == state

    artifact = results_dir / f"cli-probe-state-{stamp}.json"
    artifact.write_text(json.dumps(persisted, indent=2, sort_keys=True), encoding="utf-8")
    return ProbeResult(
        "T-SCH-CLI-002",
        "State POST persists exact JSON and GET round-trips it",
        "PASS",
        f"Persisted {STATE_FILENAME} matched the POSTed scheduler state.",
        str(artifact),
    )


def _probe_invalid_state_rejected() -> ProbeResult:
    with tempfile.TemporaryDirectory() as tmp:
        with TestClient(create_app(data_dir=tmp)) as client:
            response = client.post("/api/scheduler/state", json={"version": 2})
            assert response.status_code == 400
            body = response.json()
    assert body["error"] == "invalid state"
    assert isinstance(body["details"], list)
    return ProbeResult(
        "T-SCH-CLI-003",
        "Invalid scheduler state is rejected before persistence",
        "PASS",
        "Malformed state returned 400 with schema validation details.",
    )


def _probe_local_only_bind_contract() -> ProbeResult:
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    assert "127.0.0.1:6173:6173" in compose
    assert_safe_bind("127.0.0.1", trusted=False)
    try:
        assert_safe_bind("192.168.1.50", trusted=False)
    except ValueError:
        rejected = True
    else:
        rejected = False
    assert rejected is True
    return ProbeResult(
        "T-SCH-CLI-004",
        "Runtime exposure is loopback-only unless explicitly container-trusted",
        "PASS",
        "compose.yaml binds 127.0.0.1 and bind guards reject off-loopback hosts.",
    )


def _probe_static_and_api_precedence() -> ProbeResult:
    with tempfile.TemporaryDirectory() as tmp:
        static_dir = Path(tmp) / "dist"
        static_dir.mkdir()
        (static_dir / "index.html").write_text(
            "<!doctype html><title>Scheduler Probe</title>",
            encoding="utf-8",
        )
        with TestClient(create_app(data_dir=tmp, static_dir=static_dir)) as client:
            root = client.get("/")
            health = client.get("/api/health")
    assert root.status_code == 200
    assert "Scheduler Probe" in root.text
    assert health.status_code == 200
    assert health.json()["ok"] is True
    return ProbeResult(
        "T-SCH-CLI-005",
        "Static UI serving does not shadow API routes",
        "PASS",
        "Root served static HTML while /api/health remained JSON.",
    )


def _run_probe(fn: Callable[[], ProbeResult], probe_id: str, name: str) -> ProbeResult:
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001 - verification artifact should capture any failure.
        return ProbeResult(probe_id, name, "FAIL", f"{exc.__class__.__name__}: {exc}")


def _write_artifacts(results: list[ProbeResult], results_dir: Path, stamp: str) -> tuple[Path, Path]:
    results_dir.mkdir(parents=True, exist_ok=True)
    json_path = results_dir / f"cli-probes-{stamp}.json"
    md_path = results_dir / f"cli-probes-{stamp}.md"

    json_path.write_text(
        json.dumps([asdict(result) for result in results], indent=2, sort_keys=True),
        encoding="utf-8",
    )

    lines = [
        "# Scheduler CLI Probe Results",
        "",
        f"- Run at: {stamp}",
        "",
        "| ID | Status | Probe | Detail | Artifact |",
        "| --- | --- | --- | --- | --- |",
    ]
    for result in results:
        detail = result.detail.replace("|", "\\|").replace("\n", " ")
        artifact = result.artifact or "-"
        lines.append(f"| {result.id} | {result.status} | {result.name} | {detail} | `{artifact}` |")
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return md_path, json_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results-dir", default="verification/results")
    args = parser.parse_args()

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    results_dir = (ROOT / args.results_dir).resolve()

    probes = [
        (lambda: _probe_health_matches_package(), "T-SCH-CLI-001", "Health metadata matches package.json"),
        (lambda: _probe_persistence_round_trip(results_dir, stamp), "T-SCH-CLI-002", "State POST persists exact JSON and GET round-trips it"),
        (lambda: _probe_invalid_state_rejected(), "T-SCH-CLI-003", "Invalid scheduler state is rejected before persistence"),
        (lambda: _probe_local_only_bind_contract(), "T-SCH-CLI-004", "Runtime exposure is loopback-only"),
        (lambda: _probe_static_and_api_precedence(), "T-SCH-CLI-005", "Static UI serving does not shadow API routes"),
    ]
    results = [_run_probe(fn, probe_id, name) for fn, probe_id, name in probes]
    md_path, json_path = _write_artifacts(results, results_dir, stamp)

    print(f"Wrote {md_path}")
    print(f"Wrote {json_path}")
    return 0 if all(result.status == "PASS" for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
