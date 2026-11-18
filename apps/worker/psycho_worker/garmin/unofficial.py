"""Unofficial ``garminconnect`` client behind a read-only allowlist (spec 3.3).

The library exposes ~60 write methods (upload_*, delete_*, set_*, update_*, add_*, create_*).
Psycho must never call them, so the real client is private and only the methods listed in
``READ_METHODS`` are reachable. Attribute access to anything else raises.

Auth policy: the password is used exactly once, on Paul's Mac, by ``login_interactive``. The
cloud only ever loads the saved token JSON (DI OAuth + refresh token) and lets the library
refresh it. Tokens are stored as the JSON string that ``Garmin.client.dumps()`` produces.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import garminconnect
from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

from .. import logs
from .ratelimit import RateLimiter, with_backoff

log = logs.get("garmin.unofficial")

# Every unofficial method Psycho is allowed to call. Add here deliberately; never widen with "*".
READ_METHODS: frozenset[str] = frozenset(
    {
        # activities
        "get_activities_by_date",
        "get_activity",
        "get_activity_details",
        "get_activity_splits",
        "get_activity_typed_splits",
        "get_activity_hr_in_timezones",
        "get_activity_weather",
        "get_activity_exercise_sets",
        # fitness / performance
        "get_max_metrics",
        "get_max_metrics_range",
        "get_race_predictions",
        "get_personal_record",
        "get_training_readiness",
        "get_training_status",
        "get_endurance_score",
        "get_hill_score",
        "get_fitnessage_data",
        # wellness
        "get_respiration_data",
        "get_sleep_data",
        "get_hrv_data",
        "get_stats",
        "get_user_summary",
        "get_rhr_day",
        "get_body_battery",
        "get_stress_data",
        "get_heart_rates",
        "get_spo2_data",
        "get_steps_data",
        # body
        "get_body_composition",
        "get_weigh_ins",
        "get_daily_weigh_ins",
        # devices / profile
        "get_device_last_used",
        "get_devices",
        "get_user_profile",
    }
)

UNOFFICIAL_VERSION = "0.3.20"


class WriteMethodBlocked(AttributeError):
    pass


class NeedsLogin(Exception):
    """Refresh token is dead; Paul must re-run ``python -m psycho_worker login``."""


def _retryable(exc: BaseException) -> bool:
    if isinstance(exc, GarminConnectTooManyRequestsError):
        return True
    if isinstance(exc, GarminConnectConnectionError):
        text = str(exc)
        return any(code in text for code in ("429", "500", "502", "503", "504"))
    return False


class ReadOnlyGarmin:
    """Allowlisted, rate-limited proxy over ``garminconnect.Garmin``."""

    def __init__(self, tokens_json: str) -> None:
        logs.mask(tokens_json)
        self._limiter = RateLimiter(1.0)
        self._api = Garmin()
        # Passing the JSON string (not a path) keeps the cloud from writing token files.
        status, _ = self._api.login(tokens_json)
        if status is not None:
            raise NeedsLogin("saved tokens could not be used without MFA")

    def __getattr__(self, name: str) -> Callable[..., Any]:
        if name.startswith("_"):
            raise AttributeError(name)
        if name not in READ_METHODS:
            raise WriteMethodBlocked(f"garminconnect.{name} is not on Psycho's read-only allowlist")
        target = getattr(self._api, name)

        def call(*args: Any, **kwargs: Any) -> Any:
            def attempt() -> Any:
                self._limiter.wait()
                return target(*args, **kwargs)

            try:
                return with_backoff(attempt, is_retryable=_retryable, label=name)
            except GarminConnectAuthenticationError as exc:
                raise NeedsLogin(str(exc)) from exc

        return call

    def dump_tokens(self) -> str:
        """Current token JSON (the library refreshes tokens in place; persist after a run)."""
        return self._api.client.dumps()


# -- interactive login (Mac only) ------------------------------------------------------------


def login_interactive(
    email: str,
    password: str,
    *,
    prompt_mfa: Callable[[], str],
) -> str:
    """Log in with email + password (+ MFA) and return the token JSON to store.

    Never called in the cloud. The returned JSON contains the DI refresh token, which is as
    sensitive as the password.
    """
    api = Garmin(email=email, password=password, return_on_mfa=True)
    status, state = api.login()
    if status == "needs_mfa":
        code = prompt_mfa().strip()
        api.resume_login(state, code)
    elif status is not None:
        raise RuntimeError(f"unexpected login status: {status}")
    tokens = api.client.dumps()
    logs.mask(tokens)
    return tokens


def write_tokens_file(path: Path, tokens_json: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.parent.chmod(0o700)
    # Validate it is JSON before writing, so a bad dump never overwrites good tokens.
    json.loads(tokens_json)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(tokens_json, encoding="utf-8")
    tmp.chmod(0o600)
    tmp.replace(path)


def library_version() -> str:
    from importlib.metadata import PackageNotFoundError, version

    try:
        return version("garminconnect")
    except PackageNotFoundError:  # pragma: no cover
        return getattr(garminconnect, "__version__", "unknown")
