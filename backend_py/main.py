"""Local-only Python backend for the Pediatric Neurology Scheduler.

This FastAPI app is THE backend: the Node/Fastify backend it was ported
from has been removed, so the Python service serves the app on its own.
Routes:
  - GET  /api/health          — name/version handshake
  - GET  /api/scheduler/state — persisted state, else a fresh initial state
  - POST /api/scheduler/state — validate against scheduler-state.v1, persist
and, when a built React bundle (dist/) is mounted (in Docker), the static
frontend at "/".

Non-negotiable: any code path that actually binds a socket must go through
bind.assert_safe_bind. create_app() itself never binds — it's import- and
TestClient-safe.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend_py.contracts import validate
from backend_py.coordinator_docx_import import (
    parse_coordinator_docx_bundle,
    default_coordinator_docx_paths,
)
from backend_py.domain.commands import execute_scheduler_command
from backend_py.domain.rotators import normalize_pediatric_fellow_roles
from backend_py.initial_state import create_initial_state
from backend_py.persistence import (
    get_default_data_dir,
    load_state_from_disk,
    save_state_to_disk,
)
from backend_py.roster_import import RosterImportError, SUPPORTED_EXTENSIONS, import_roster_file

REPO_ROOT = Path(__file__).resolve().parent.parent

logger = logging.getLogger(__name__)

# Matches Node's Fastify bodyLimit (30 MB) — generous for a scheduler-state
# JSON, but caps a runaway POST so it can't OOM the process.
MAX_BODY_BYTES = 30 * 1024 * 1024

# Local source files are read by path from NSOpenPanel, not uploaded to a
# remote service. Keep a separate cap anyway so an accidental huge workbook or
# DOCX fails before parser libraries try to load it into memory.
MAX_SOURCE_FILE_BYTES = 25 * 1024 * 1024


def _oversized_source_response(path: Path, size_bytes: int) -> JSONResponse:
    return JSONResponse(
        status_code=413,
        content={
            "error": "source file is too large",
            "fileName": path.name,
            "bytes": size_bytes,
            "maxBytes": MAX_SOURCE_FILE_BYTES,
        },
    )


def _oversized_source_file(path: Path) -> JSONResponse | None:
    try:
        size_bytes = path.stat().st_size
    except OSError:
        return JSONResponse(
            status_code=400,
            content={"error": "could not inspect source file", "fileName": path.name},
        )
    if size_bytes > MAX_SOURCE_FILE_BYTES:
        return _oversized_source_response(path, size_bytes)
    return None


async def _read_capped_json_request(request: Request) -> tuple[Any | None, JSONResponse | None]:
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return None, JSONResponse(status_code=413, content={"error": "payload too large"})

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_BODY_BYTES:
            return None, JSONResponse(status_code=413, content={"error": "payload too large"})

    try:
        return json.loads(bytes(body)), None
    except ValueError:
        return None, JSONResponse(status_code=400, content={"error": "request body must be JSON"})


def _absolute_local_path(value: str) -> Path | None:
    if "://" in value or value.lower().startswith("file:"):
        return None
    path = Path(value)
    return path if path.is_absolute() else None


@lru_cache(maxsize=1)
def _package_meta() -> dict[str, Any]:
    """Read name/version from the repo package.json.

    package.json is the single source of truth for the app's name/version:
    the /api/health response reports exactly what's there, so the frontend
    handshake and the handoff contract checks stay pinned to the package
    manifest rather than a hard-coded constant that could drift.

    Cached for the process lifetime: under `uvicorn --reload` a
    package.json version bump won't show until the process restarts. Fine
    for a version string; revisit if anything dynamic is ever read here.
    """
    pkg = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
    return {"name": pkg["name"], "version": pkg["version"]}


def create_app(
    *,
    data_dir: str | Path | None = None,
    static_dir: str | Path | None = None,
) -> FastAPI:
    """Build the FastAPI app. Does not bind any socket.

    data_dir   — where scheduler-state.json lives (defaults to the
                 PEDI_SCHEDULER_DATA_DIR / XDG path). Resolved here so
                 request handlers don't re-read the environment.
    static_dir — optional built React bundle (dist/) to serve. Mounted
                 AFTER the /api routes so they always take precedence.
    """
    app = FastAPI(title="pedi-scheduler-backend-py", docs_url=None, redoc_url=None)
    state_dir = str(data_dir) if data_dir is not None else get_default_data_dir()

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        meta = _package_meta()
        return {"ok": True, "name": meta["name"], "version": meta["version"]}

    @app.get("/api/runtime")
    async def runtime() -> dict[str, Any]:
        return {
            "ok": True,
            "engineRoot": str(REPO_ROOT),
            "cwd": os.getcwd(),
            "dataDir": state_dir,
            "pid": os.getpid(),
            "python": sys.executable,
        }

    @app.get("/api/scheduler/state")
    async def get_state() -> Any:
        # Match Node exactly: persisted state if present, otherwise a fresh
        # initial state (first launch OR unreadable/corrupt file -> None).
        # Returning 200 here — rather than 404 — keeps a brand-new install's
        # console clean; the browser logs every 404 as a resource error even
        # though the frontend handles it. create_initial_state() is
        # non-authoritative, so the frontend still won't clobber real
        # localStorage data with it.
        persisted = normalize_pediatric_fellow_roles(load_state_from_disk(state_dir))
        if persisted is None:
            return create_initial_state()
        return persisted

    @app.post("/api/scheduler/state")
    async def write_state(request: Request) -> Any:
        state, error_response = await _read_capped_json_request(request)
        if error_response is not None:
            return error_response
        state = normalize_pediatric_fellow_roles(state)
        errors = validate("scheduler-state.v1", state)
        if errors:
            return JSONResponse(
                status_code=400,
                content={"error": "invalid state", "details": errors},
            )
        result = save_state_to_disk(state, state_dir)
        if not result["ok"]:
            # Log the detailed reason/message server-side; the failure
            # message can contain an absolute filesystem path, so the HTTP
            # body stays generic (never leak paths to the client).
            logger.error(
                "failed to persist scheduler state: reason=%s message=%s",
                result.get("reason"),
                result.get("message"),
            )
            return JSONResponse(
                status_code=500,
                content={"error": "could not persist state"},
            )
        return {"ok": True}

    @app.post("/api/scheduler/command")
    async def run_command(request: Request) -> Any:
        """Run one scheduler command against the persisted state and return
        the full updated state.

        This is the single mutation endpoint the native macOS client drives
        (mirroring the React client's command dispatcher). The engine lives
        here in Python: load current state, apply the command via
        execute_scheduler_command, validate + persist any change, and return
        the command envelope with the authoritative resulting state.

        Status codes: 400 for un-parseable JSON, 413 for oversized bodies,
        500 for a validation/persistence failure. A command that fails its
        own field checks (missing arg, unknown type) is NOT an HTTP error —
        it returns 200 with {ok: false, error} so the client handles success
        and command-level failure through one decode path, exactly as the
        in-process JS dispatcher returns a value rather than throwing.
        """
        command, error_response = await _read_capped_json_request(request)
        if error_response is not None:
            return error_response
        if not isinstance(command, dict):
            return JSONResponse(
                status_code=400, content={"error": "command must be a JSON object"}
            )

        # Load the authoritative current state (same rule as GET /state).
        state = normalize_pediatric_fellow_roles(load_state_from_disk(state_dir))
        if state is None:
            state = create_initial_state()

        result = execute_scheduler_command(state, command)

        # No mutation (read-only command, no-op, or command-level failure):
        # return the envelope as-is; nothing to persist.
        if not result.get("ok") or not result.get("changed"):
            return result

        next_state = result["state"]
        errors = validate("scheduler-state.v1", next_state)
        if errors:
            # A ported mutator produced an invalid state — a server bug, not a
            # client one. Refuse to persist and surface it as a 500 (details
            # are schema paths, safe to return; they carry no filesystem path).
            logger.error(
                "command %s produced invalid state: %s", command.get("type"), errors
            )
            return JSONResponse(
                status_code=500,
                content={"error": "command produced invalid state", "details": errors},
            )

        persisted = save_state_to_disk(next_state, state_dir)
        if not persisted["ok"]:
            logger.error(
                "failed to persist state after command %s: reason=%s message=%s",
                command.get("type"),
                persisted.get("reason"),
                persisted.get("message"),
            )
            return JSONResponse(
                status_code=500, content={"error": "could not persist state"}
            )
        return result

    def _coordinator_docx_response(
        *,
        master_path: str | Path,
        inpatient_path: str | Path,
        outpatient_path: str | Path,
    ) -> Any:
        paths = [Path(master_path), Path(inpatient_path), Path(outpatient_path)]
        missing = [str(path) for path in paths if not path.is_file()]
        if missing:
            return JSONResponse(
                status_code=404,
                content={"error": "missing Coordinator DOCX source files", "missing": missing},
            )
        not_docx = [str(path) for path in paths if path.suffix.lower() != ".docx"]
        if not_docx:
            return JSONResponse(
                status_code=400,
                content={"error": "Coordinator sources must be .docx files", "invalid": not_docx},
            )
        for path in paths:
            oversized = _oversized_source_file(path)
            if oversized is not None:
                return oversized

        try:
            preview = parse_coordinator_docx_bundle(
                master_path=paths[0],
                inpatient_path=paths[1],
                outpatient_path=paths[2],
            )
        except Exception:
            logger.exception("failed to parse Coordinator DOCX bundle")
            return JSONResponse(
                status_code=400,
                content={"error": "could not parse Coordinator DOCX bundle"},
            )

        errors = validate("scheduler-state.v1", preview["schedulerStatePreview"])
        if errors:
            logger.error("Coordinator DOCX preview failed contract validation: %s", errors)
            return JSONResponse(
                status_code=500,
                content={"error": "generated Coordinator DOCX state was invalid", "details": errors},
            )

        return {
            "ok": True,
            "sourceFiles": preview["sourceFiles"],
            "acceptance": preview["acceptance"],
            "warnings": preview["warnings"],
            "reconciliation": preview["reconciliation"]["counts"],
            "schedulerStatePreview": preview["schedulerStatePreview"],
        }

    @app.post("/api/import/coordinator-docx")
    async def import_coordinator_docx_bundle(request: Request) -> Any:
        """Parse an explicitly selected local Coordinator DOCX bundle.

        Native macOS import sends local file paths from an NSOpenPanel. This
        route remains loopback-only with the rest of the backend; it does not
        upload files anywhere or expose a remote filesystem API.
        """
        body, error_response = await _read_capped_json_request(request)
        if error_response is not None:
            return error_response
        if not isinstance(body, dict):
            return JSONResponse(
                status_code=400, content={"error": "request body must be a JSON object"}
            )
        required = ["masterPath", "inpatientPath", "outpatientPath"]
        missing_fields = [field for field in required if not body.get(field)]
        if missing_fields:
            return JSONResponse(
                status_code=400,
                content={"error": "missing Coordinator DOCX path fields", "missing": missing_fields},
            )
        invalid_fields = [field for field in required if not isinstance(body.get(field), str)]
        if invalid_fields:
            return JSONResponse(
                status_code=400,
                content={"error": "Coordinator DOCX path fields must be strings", "invalid": invalid_fields},
            )
        local_paths = {field: _absolute_local_path(body[field]) for field in required}
        invalid_paths = [field for field, path in local_paths.items() if path is None]
        if invalid_paths:
            return JSONResponse(
                status_code=400,
                content={
                    "error": "Coordinator DOCX path fields must be absolute local filesystem paths",
                    "invalid": invalid_paths,
                },
            )
        return _coordinator_docx_response(
            master_path=local_paths["masterPath"],
            inpatient_path=local_paths["inpatientPath"],
            outpatient_path=local_paths["outpatientPath"],
        )

    @app.post("/api/import/coordinator-docx/default")
    async def import_default_coordinator_docx_bundle() -> Any:
        """Parse the newest complete Coordinator DOCX bundle from Downloads.

        This keeps the schedule-bundle rule local-only and explicit: the
        backend discovers a master/inpatient/outpatient DOCX trio in the
        current user's Downloads folder, treats the master as service truth,
        reconciles inpatient/outpatient detail files, and only returns a
        scheduler-state preview if it validates against the frozen contract.
        """
        default_paths = default_coordinator_docx_paths()
        return _coordinator_docx_response(
            master_path=default_paths["master"],
            inpatient_path=default_paths["inpatient"],
            outpatient_path=default_paths["outpatient"],
        )

    @app.post("/api/import/roster")
    async def import_roster(request: Request) -> Any:
        """Parse a selected local roster file into a validated state preview.

        The native app sends a local path selected through NSOpenPanel. This is
        still local-only: the backend runs on loopback and reads the file from
        disk on the same machine.
        """
        body, error_response = await _read_capped_json_request(request)
        if error_response is not None:
            return error_response
        if not isinstance(body, dict):
            return JSONResponse(
                status_code=400, content={"error": "request body must be a JSON object"}
            )
        file_path = body.get("filePath") or body.get("path")
        if not file_path:
            return JSONResponse(
                status_code=400,
                content={"error": "filePath is required", "missing": ["filePath"]},
            )
        if not isinstance(file_path, str):
            return JSONResponse(
                status_code=400,
                content={"error": "filePath must be a string", "invalid": ["filePath"]},
            )
        source_path = _absolute_local_path(file_path)
        if source_path is None:
            return JSONResponse(
                status_code=400,
                content={"error": "filePath must be an absolute local filesystem path", "invalid": ["filePath"]},
            )
        mode = body.get("mode") or "merge"
        if not isinstance(mode, str):
            return JSONResponse(
                status_code=400,
                content={"error": "mode must be a string", "invalid": ["mode"]},
            )
        replace_source_id = body.get("replaceSourceId")
        if replace_source_id is not None and not isinstance(replace_source_id, str):
            return JSONResponse(
                status_code=400,
                content={"error": "replaceSourceId must be a string", "invalid": ["replaceSourceId"]},
            )
        column_mapping = body.get("columnMapping")
        if column_mapping is not None and not isinstance(column_mapping, dict):
            return JSONResponse(
                status_code=400,
                content={"error": "columnMapping must be an object", "invalid": ["columnMapping"]},
            )
        matrix_bang_behavior = body.get("matrixBangBehavior") or "present"
        if not isinstance(matrix_bang_behavior, str):
            return JSONResponse(
                status_code=400,
                content={"error": "matrixBangBehavior must be a string", "invalid": ["matrixBangBehavior"]},
            )
        if matrix_bang_behavior not in {"present", "exclude"}:
            return JSONResponse(
                status_code=400,
                content={"error": "matrixBangBehavior must be present or exclude", "invalid": ["matrixBangBehavior"]},
            )
        if source_path.is_file() and source_path.suffix.lower() in SUPPORTED_EXTENSIONS:
            oversized = _oversized_source_file(source_path)
            if oversized is not None:
                return oversized

        state = normalize_pediatric_fellow_roles(load_state_from_disk(state_dir))
        if state is None:
            state = create_initial_state()
        try:
            preview = import_roster_file(
                state,
                source_path,
                mode=mode,
                replace_source_id=replace_source_id,
                column_mapping=column_mapping,
                matrix_bang_behavior=matrix_bang_behavior,
            )
        except RosterImportError as exc:
            return JSONResponse(status_code=400, content={"error": str(exc)})

        errors = validate("scheduler-state.v1", preview["state"])
        if errors:
            logger.error("roster import preview failed contract validation: %s", errors)
            return JSONResponse(
                status_code=500,
                content={"error": "generated roster import state was invalid", "details": errors},
            )

        return {
            "ok": True,
            "sourceFile": preview["sourceFile"],
            "acceptance": preview["acceptance"],
            "warnings": preview["warnings"],
            "columnsFound": preview["columnsFound"],
            "importMeta": preview["importMeta"],
            "replaceSourceId": replace_source_id,
            "schedulerStatePreview": preview["state"],
        }

    # Serve the built React bundle, if provided. Mounted LAST so the /api
    # routes above always win on path match. html=True serves index.html
    # for "/" — sufficient for this app, which uses in-page state for
    # navigation rather than URL routing (no deep-link client routes).
    if static_dir is not None and Path(static_dir).is_dir():
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

    return app
