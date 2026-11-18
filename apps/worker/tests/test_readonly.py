"""The unofficial client must never expose a write method."""

from __future__ import annotations

import pytest
from garminconnect import Garmin

from psycho_worker.garmin.unofficial import READ_METHODS, ReadOnlyGarmin, WriteMethodBlocked

WRITE_PREFIXES = (
    "upload",
    "delete",
    "add_",
    "set_",
    "create",
    "edit",
    "update",
    "remove",
    "logout",
)


def test_allowlist_contains_only_real_read_methods():
    for name in READ_METHODS:
        assert hasattr(Garmin, name), f"garminconnect has no method {name}"
        assert name.startswith("get_"), name


def test_every_write_method_is_blocked():
    proxy = ReadOnlyGarmin.__new__(ReadOnlyGarmin)  # no login
    proxy._api = Garmin()
    blocked = [n for n in dir(Garmin) if n.startswith(WRITE_PREFIXES)]
    assert len(blocked) > 40, "expected the library to have many write methods"
    for name in blocked:
        with pytest.raises(WriteMethodBlocked):
            getattr(proxy, name)
