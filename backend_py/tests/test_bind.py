"""Bind-guard truth table.

Ported 1:1 from backend/tests/server.test.mjs so the Python loopback
guarantee is provably identical to the Node one. Deliberately mirrors
Node's EXACT host set {127.0.0.1, localhost, ::1} rather than using
ipaddress.is_loopback (which would also accept 127.0.0.2 etc.) — the
migration principle is preserve behavior, not "improve" it.
"""

import pytest

from backend_py.bind import assert_loopback, assert_safe_bind

LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"]


def test_assert_loopback_accepts_loopback_hosts():
    for host in LOOPBACK_HOSTS:
        assert_loopback(host)  # must not raise


@pytest.mark.parametrize(
    "host", ["0.0.0.0", "::", "192.168.1.1", "10.0.0.1", "example.com", ""]
)
def test_assert_loopback_rejects_non_loopback_hosts(host):
    with pytest.raises(ValueError, match="loopback"):
        assert_loopback(host)


def test_assert_loopback_rejects_127_0_0_2():
    # Guards the deliberate deviation from the research doc: only the exact
    # literal 127.0.0.1 is allowed, not the whole 127.0.0.0/8 block.
    with pytest.raises(ValueError, match="loopback"):
        assert_loopback("127.0.0.2")


@pytest.mark.parametrize("host", ["0.0.0.0", "::"])
def test_assert_safe_bind_allows_wildcard_when_trusted(host):
    assert_safe_bind(host, trusted=True)  # must not raise


def test_assert_safe_bind_still_allows_loopback_when_trusted():
    for host in LOOPBACK_HOSTS:
        assert_safe_bind(host, trusted=True)


def test_assert_safe_bind_rejects_wildcard_by_default():
    with pytest.raises(ValueError, match="loopback"):
        assert_safe_bind("0.0.0.0")
    with pytest.raises(ValueError, match="loopback"):
        assert_safe_bind("0.0.0.0", trusted=False)


@pytest.mark.parametrize("host", ["192.168.1.1", "example.com", "8.8.8.8", ""])
def test_assert_safe_bind_rejects_arbitrary_hosts_even_when_trusted(host):
    # Even with trust opt-in, only the documented bind-all addresses pass.
    with pytest.raises(ValueError, match="loopback"):
        assert_safe_bind(host, trusted=True)
