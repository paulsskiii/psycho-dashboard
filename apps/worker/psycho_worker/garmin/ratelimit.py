"""Politeness: ≤ 1 request/s per source, with retry/backoff on 429 and 5xx (spec 6.2)."""

from __future__ import annotations

import random
import threading
import time
from collections.abc import Callable

from .. import logs

log = logs.get("garmin.ratelimit")

BACKOFF_SCHEDULE_S = (2, 4, 8, 16, 32)  # jittered; capped at 300 s
MAX_TRIES = 5


class RateLimiter:
    """Simple per-source spacing: at most one call every ``min_interval_s`` seconds."""

    def __init__(self, min_interval_s: float = 1.0) -> None:
        self.min_interval_s = min_interval_s
        self._lock = threading.Lock()
        self._next_allowed = 0.0

    def wait(self, extra_s: float = 0.0) -> None:
        with self._lock:
            now = time.monotonic()
            delay = max(0.0, self._next_allowed - now) + extra_s
            if delay > 0:
                time.sleep(delay)
            self._next_allowed = time.monotonic() + self.min_interval_s


class SourceDegraded(Exception):
    """Raised after the retry budget is exhausted; callers mark the source degraded and move on."""


def with_backoff[T](
    fn: Callable[[], T],
    *,
    is_retryable: Callable[[BaseException], bool],
    on_auth_error: Callable[[BaseException], bool] | None = None,
    label: str = "request",
) -> T:
    """Call ``fn``; retry on retryable errors with exponential backoff + jitter (max 5 tries).

    ``on_auth_error(exc)`` may refresh credentials and return True to allow exactly one retry.
    """
    auth_retried = False
    for attempt in range(1, MAX_TRIES + 1):
        try:
            return fn()
        except BaseException as exc:  # classified below; non-retryable errors re-raise
            if on_auth_error is not None and not auth_retried and on_auth_error(exc):
                auth_retried = True
                log.info("auth refreshed, retrying once", label=label)
                continue
            if not is_retryable(exc) or attempt == MAX_TRIES:
                if is_retryable(exc):
                    log.warning("retry budget exhausted", label=label, tries=attempt)
                    raise SourceDegraded(label) from exc
                raise
            base = BACKOFF_SCHEDULE_S[min(attempt - 1, len(BACKOFF_SCHEDULE_S) - 1)]
            delay = min(300.0, base + random.uniform(0, base))
            log.info("retrying", label=label, attempt=attempt, delay_s=round(delay, 1))
            time.sleep(delay)
    raise AssertionError("unreachable")
