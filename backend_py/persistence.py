"""Local-only persistence for scheduler state.

Behavioral port of backend/src/persistence.js. Writes a single JSON file
(scheduler-state.json) to a machine-local data directory:
  1. PEDI_SCHEDULER_DATA_DIR env var (tests, Docker compose, custom), or
  2. ~/.local/share/pedi_scheduler (matches the Docker volume mount point).

Atomic writes via the classic temp-file + os.replace pattern (replace is
atomic on the same filesystem, POSIX and Windows). save_state_to_disk
never raises — it returns a {ok}/{ok, reason, message} result so a route
handler never has to wrap it in try/except. This module makes no network
calls and resolves no off-machine hostnames; persistence is local-disk only.
"""

from __future__ import annotations

import errno as errno_mod
import json
import os
import tempfile
from pathlib import Path
from typing import Any

STATE_FILENAME = "scheduler-state.json"
# Prefix shared by every temp file mkstemp() creates below. Kept as a
# module constant so the orphan-sweep matches exactly the files this module
# writes — and nothing else.
TEMP_PREFIX = f"{STATE_FILENAME}.tmp."


def get_default_data_dir() -> str:
    env = os.environ.get("PEDI_SCHEDULER_DATA_DIR")
    if env:
        return env
    return str(Path.home() / ".local" / "share" / "pedi_scheduler")


def get_state_file_path(data_dir: str | os.PathLike[str]) -> Path:
    return Path(data_dir) / STATE_FILENAME


def load_state_from_disk(
    data_dir: str | os.PathLike[str] | None = None,
) -> dict[str, Any] | None:
    """Read persisted state. Returns None when no file exists (first launch)
    or when the file is unreadable / invalid JSON — the caller decides what
    to do (the route returns 404; the frontend keeps its localStorage copy).
    """
    if data_dir is None:
        data_dir = get_default_data_dir()
    file_path = get_state_file_path(data_dir)
    if not file_path.exists():
        return None
    try:
        return json.loads(file_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _sweep_orphan_temp_files(target_dir: Path) -> None:
    """Best-effort removal of stale temp files left by a hard kill mid-write.

    Deletes ONLY files whose name matches the exact prefix mkstemp() uses
    below (TEMP_PREFIX) — never the real state file, never directories,
    never anything else in the data dir. Swallows every OSError (missing
    dir, permission, race) so it can't turn a save into a failure.
    """
    try:
        entries = list(target_dir.iterdir())
    except OSError:
        return
    for entry in entries:
        name = entry.name
        if name == STATE_FILENAME or not name.startswith(TEMP_PREFIX):
            continue
        try:
            if entry.is_file():
                entry.unlink()
        except OSError:
            pass


def save_state_to_disk(
    state: Any, data_dir: str | os.PathLike[str] | None = None
) -> dict[str, Any]:
    """Write state to disk atomically (temp file in the same dir + replace).

    Returns {"ok": True} on success, {"ok": False, "reason", "message"} on
    failure. Never raises.
    """
    if data_dir is None:
        data_dir = get_default_data_dir()
    target_dir = Path(data_dir)
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        # Clear any temp file orphaned by an earlier hard kill. Runs after
        # mkdir but BEFORE mkstemp so it never deletes the temp we're about
        # to create. Best-effort: never fails the save.
        _sweep_orphan_temp_files(target_dir)
        file_path = get_state_file_path(target_dir)
        fd, tmp_name = tempfile.mkstemp(
            dir=target_dir, prefix=TEMP_PREFIX, suffix=""
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(state, handle, separators=(",", ":"), ensure_ascii=False)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, file_path)
            # fsync the containing directory so the rename itself is durable
            # across power loss (the file's own fsync above doesn't persist
            # the directory entry). Best-effort: some platforms/filesystems
            # can't fsync a directory fd — never let that fail the save.
            try:
                dir_fd = os.open(str(target_dir), os.O_RDONLY)
                try:
                    os.fsync(dir_fd)
                finally:
                    os.close(dir_fd)
            except OSError:
                pass
        except (OSError, TypeError, ValueError):
            # Best-effort cleanup of the temp file, then re-raise to the
            # outer handler which builds the error result.
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise
        return {"ok": True}
    except (OSError, TypeError, ValueError) as exc:
        # Catches IO failures plus non-serializable state (json.dump raises
        # TypeError/ValueError), matching Node's bare catch. Never raises.
        # reason mirrors Node's err.code (symbolic errno like "ENOTDIR")
        # when available, else the exception class name.
        reason = errno_mod.errorcode.get(
            getattr(exc, "errno", None), exc.__class__.__name__
        )
        return {"ok": False, "reason": reason, "message": str(exc)}
