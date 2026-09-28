"""Persistence tests — ported 1:1 from backend/tests/persistence.test.mjs.

Same coverage: env-var data dir, missing-file -> None, round-trip, atomic
overwrite, no orphaned temp files, corrupt JSON -> None (no raise),
mkdir-on-save, and IO failure -> {ok: False} (never raises).
"""

import os

import pytest

from backend_py.persistence import (
    TEMP_PREFIX,
    get_default_data_dir,
    get_state_file_path,
    load_state_from_disk,
    save_state_to_disk,
)


def test_get_default_data_dir_honors_env(monkeypatch):
    monkeypatch.setenv("PEDI_SCHEDULER_DATA_DIR", "/tmp/custom-test-dir")
    assert get_default_data_dir() == "/tmp/custom-test-dir"


def test_get_default_data_dir_falls_back(monkeypatch):
    monkeypatch.delenv("PEDI_SCHEDULER_DATA_DIR", raising=False)
    assert get_default_data_dir().endswith("/.local/share/pedi_scheduler")


def test_load_returns_none_when_missing(tmp_path):
    assert load_state_from_disk(tmp_path) is None


def test_save_load_round_trip(tmp_path):
    state = {"version": 2, "activeBlockId": "block-1", "serviceBlocks": []}
    result = save_state_to_disk(state, tmp_path)
    assert result["ok"] is True
    assert load_state_from_disk(tmp_path) == state


def test_save_overwrites_prior_content(tmp_path):
    save_state_to_disk({"version": 1}, tmp_path)
    save_state_to_disk({"version": 2}, tmp_path)
    loaded = load_state_from_disk(tmp_path)
    assert loaded["version"] == 2


def test_save_leaves_no_orphaned_temp_files(tmp_path):
    save_state_to_disk({"version": 1}, tmp_path)
    leftovers = [p.name for p in tmp_path.iterdir() if ".tmp" in p.name]
    assert leftovers == [], f"unexpected leftover temp files: {leftovers}"


def test_load_returns_none_on_corrupt_json(tmp_path):
    get_state_file_path(tmp_path).write_text("{ this is not valid json", encoding="utf-8")
    assert load_state_from_disk(tmp_path) is None


def test_save_creates_data_dir_if_absent(tmp_path):
    nested = tmp_path / "nested" / "deeper"
    assert not nested.exists()
    result = save_state_to_disk({"version": 2}, nested)
    assert result["ok"] is True
    assert nested.exists()
    assert get_state_file_path(nested).exists()


def test_save_returns_error_dict_on_io_failure_no_raise():
    # /dev/null/... is ENOTDIR on Linux — mkdir/write can't succeed there.
    result = save_state_to_disk({"version": 1}, "/dev/null/cant-mkdir-here")
    assert result["ok"] is False
    assert isinstance(result["reason"], str)
    assert isinstance(result["message"], str)


def test_save_sweeps_orphan_temp_files_but_spares_others(tmp_path):
    # BE-003: a hard kill mid-write can orphan a temp file matching this
    # module's exact prefix. The next save must sweep ONLY those, and must
    # leave the real state file and unrelated files untouched.
    orphan = tmp_path / f"{TEMP_PREFIX}deadbeef"
    orphan.write_text("orphaned half-write", encoding="utf-8")
    unrelated = tmp_path / "notes.txt"
    unrelated.write_text("keep me", encoding="utf-8")
    # A pre-existing real state file must also survive the sweep.
    get_state_file_path(tmp_path).write_text('{"version": 1}', encoding="utf-8")

    result = save_state_to_disk({"version": 2}, tmp_path)
    assert result["ok"] is True

    assert not orphan.exists(), "stale temp file should have been swept"
    assert unrelated.exists(), "unrelated file must not be deleted"
    assert unrelated.read_text(encoding="utf-8") == "keep me"
    assert get_state_file_path(tmp_path).exists()
    assert load_state_from_disk(tmp_path) == {"version": 2}
    # And the new save left no temp files behind either.
    leftovers = [p.name for p in tmp_path.iterdir() if ".tmp" in p.name]
    assert leftovers == [], f"unexpected leftover temp files: {leftovers}"


def test_save_returns_error_dict_on_non_serializable_no_raise(tmp_path):
    # json.dump raises TypeError on a set; the function must catch it and
    # return an error result (matching Node's bare catch), not propagate.
    result = save_state_to_disk({"bad": {1, 2, 3}}, tmp_path)
    assert result["ok"] is False
    assert isinstance(result["reason"], str)
    # And it must not have left a half-written state file behind.
    assert not get_state_file_path(tmp_path).exists()
