"""Local-only bind guards for the Python scheduler backend.

Behavioral port of the guards in backend/src/server.js. The product's
privacy guarantee (HighLevelDesignSpecification: no off-machine
communication) rests on the backend binding ONLY to loopback by default.

We intentionally match Node's exact host set {127.0.0.1, localhost, ::1}
instead of ipaddress.is_loopback. is_loopback would accept the whole
127.0.0.0/8 range (e.g. 127.0.0.2); the Node guard does not, and parity
with the shipping behavior is the goal of this migration. The research
report's draft used is_loopback — this is a deliberate, documented
divergence from it.
"""

from __future__ import annotations

# Hosts that are always safe: the backend reachable only from this machine.
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

# Bind-all addresses. Only safe inside an isolated network namespace
# (a Docker container) where the host-side port mapping enforces
# loopback (`-p 127.0.0.1:HOST:CONTAINER`). Opt in via trusted=True,
# which the entrypoint wires to PEDI_SCHEDULER_TRUST_BIND=1.
TRUSTED_BIND_HOSTS = frozenset({"0.0.0.0", "::"})


def assert_loopback(host: str) -> None:
    """Raise unless host is one of the loopback hosts."""
    if host not in LOOPBACK_HOSTS:
        raise ValueError(
            f"Backend must bind to a loopback host "
            f"(127.0.0.1, localhost, ::1). Got: {host!r}"
        )


def assert_safe_bind(host: str, *, trusted: bool = False) -> None:
    """Permit bind-all hosts in addition to loopback, but only when trusted.

    Without trusted=True this is exactly assert_loopback. With it, the two
    documented bind-all addresses also pass; everything else (arbitrary
    LAN/public hosts) is still rejected.
    """
    if trusted and (host in LOOPBACK_HOSTS or host in TRUSTED_BIND_HOSTS):
        return
    assert_loopback(host)
