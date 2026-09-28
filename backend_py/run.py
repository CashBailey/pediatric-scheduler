"""Socket-binding entrypoint for the Python scheduler backend.

Behavioral port of startServer()/bin.js. The loopback guard
(assert_config_safe) runs BEFORE uvicorn binds anything — the product's
local-only privacy guarantee must hold at the bind layer, not just in
config. Run:

    backend_py/.venv/bin/python -m backend_py.run

Env (matches the Node backend):
  PEDI_SCHEDULER_BIND_HOST   bind host (default 127.0.0.1)
  PORT                       bind port (default 6174)
  PEDI_SCHEDULER_TRUST_BIND  "1" permits 0.0.0.0/:: (container-only)
  PEDI_SCHEDULER_STATIC_DIR  built React bundle to serve (dist/)
  PEDI_SCHEDULER_DATA_DIR    scheduler-state.json location
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass

from backend_py.bind import assert_safe_bind

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 6174


@dataclass(frozen=True)
class BindConfig:
    host: str
    port: int
    trusted: bool
    static_dir: str | None
    data_dir: str | None


def resolve_bind_config() -> BindConfig:
    return BindConfig(
        host=os.environ.get("PEDI_SCHEDULER_BIND_HOST", DEFAULT_HOST),
        port=int(os.environ.get("PORT", DEFAULT_PORT)),
        trusted=os.environ.get("PEDI_SCHEDULER_TRUST_BIND") == "1",
        static_dir=os.environ.get("PEDI_SCHEDULER_STATIC_DIR"),
        data_dir=os.environ.get("PEDI_SCHEDULER_DATA_DIR"),
    )


def assert_config_safe(config: BindConfig) -> None:
    """Raise unless config.host is a permitted bind target. Pure check —
    runs before any socket is opened so it's unit-testable without uvicorn.
    """
    assert_safe_bind(config.host, trusted=config.trusted)


def main() -> None:  # pragma: no cover - exercised via the module entrypoint
    import uvicorn

    from backend_py.main import create_app

    config = resolve_bind_config()
    try:
        assert_config_safe(config)
    except ValueError as err:
        # Match bin.js: a clean one-line message + exit 1, not a traceback.
        print(f"[backend_py] failed to start: {err}", file=sys.stderr)
        sys.exit(1)
    app = create_app(data_dir=config.data_dir, static_dir=config.static_dir)
    uvicorn.run(app, host=config.host, port=config.port, log_level="info")


if __name__ == "__main__":  # pragma: no cover
    main()
