"""Structured JSON logging and secret masking.

Rules (spec 3.5): the worker never prints tokens, keys, raw API responses, GPS coordinates or
health values. Log counts, durations and status codes only. Every secret loaded at runtime is
registered with ``mask`` so GitHub Actions redacts it if it ever leaks into output.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from typing import Any

_MASKED: set[str] = set()


def mask(secret: str | None) -> None:
    """Hide ``secret`` from GitHub Actions logs (``::add-mask::``) and from our own output."""
    if not secret or len(secret) < 8:
        return
    _MASKED.add(secret)
    if os.environ.get("GITHUB_ACTIONS") == "true":
        # The add-mask command must reach stdout unformatted.
        sys.stdout.write(f"::add-mask::{secret}\n")
        sys.stdout.flush()


def _scrub(text: str) -> str:
    for s in _MASKED:
        text = text.replace(s, "***")
    return text


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(record.created)),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        extra = getattr(record, "data", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return _scrub(json.dumps(payload, default=str))


class _HumanFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = f"{record.levelname[0]} {record.name}: {record.getMessage()}"
        extra = getattr(record, "data", None)
        if isinstance(extra, dict) and extra:
            base += "  " + " ".join(f"{k}={v}" for k, v in extra.items())
        if record.exc_info:
            base += "\n" + self.formatException(record.exc_info)
        return _scrub(base)


def setup(json_output: bool | None = None, level: int = logging.INFO) -> None:
    if json_output is None:
        json_output = os.environ.get("GITHUB_ACTIONS") == "true"
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(_JsonFormatter() if json_output else _HumanFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # Third-party clients log request paths at INFO; keep them quiet unless debugging.
    for noisy in ("garmin_personal_api", "garminconnect", "urllib3", "httpx", "hpack"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get(name: str) -> logging.LoggerAdapter:
    return _Adapter(logging.getLogger(name), {})


class _Adapter(logging.LoggerAdapter):
    """``log.info("fetched", n=3)`` → structured ``data`` field."""

    def process(self, msg: str, kwargs: Any) -> tuple[str, Any]:
        data = {
            k: v for k, v in kwargs.items() if k not in ("exc_info", "stack_info", "stacklevel")
        }
        clean = {k: v for k, v in kwargs.items() if k in ("exc_info", "stack_info", "stacklevel")}
        clean["extra"] = {"data": data}
        return msg, clean
