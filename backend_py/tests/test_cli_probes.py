"""Regression coverage for scripts/run_cli_probes.py artifact behavior."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "run_cli_probes.py"


def _load_cli_probe_module():
    spec = importlib.util.spec_from_file_location("run_cli_probes", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_persistence_probe_creates_missing_results_dir(tmp_path):
    module = _load_cli_probe_module()
    results_dir = tmp_path / "verification" / "results"

    result = module._probe_persistence_round_trip(results_dir, "probe-test")

    assert result.status == "PASS"
    assert (results_dir / "cli-probe-state-probe-test.json").exists()
