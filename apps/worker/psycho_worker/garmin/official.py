"""Official Garmin Connect Personal API (read-only, pull-only).

Wraps ``garmin-connect-personal-api-python`` 1.0.0:
  - ``PersonalApiAuthenticator.obtain_token(api_key)`` exchanges the key for a 24 h JWT and
    caches it (with ``exp``) in a 0600 file. In Phase 1 the cloud copy of that cache moves to
    Supabase Vault (``garmin_personal_access_token``) so the 30-min job doesn't re-exchange.
  - ``GarminPersonalApiClient`` exposes the endpoint methods listed in spec 3.2.
"""

from __future__ import annotations

import io
import zipfile
from collections.abc import Callable
from datetime import date
from typing import Any

from garmin_personal_api import (
    GarminPersonalApiClient,
    HttpError,
    PersonalApiAuthenticator,
)

from .. import logs
from ..config import OFFICIAL_BEARER_CACHE_FILE
from .ratelimit import RateLimiter, with_backoff

log = logs.get("garmin.official")

Json = dict[str, Any] | list[Any] | str | int | float | bool | None


def _retryable(exc: BaseException) -> bool:
    return isinstance(exc, HttpError) and (exc.status_code == 429 or exc.status_code >= 500)


class OfficialGarmin:
    """Thin, rate-limited, retrying wrapper over the official client."""

    def __init__(self, api_key: str, *, bearer_cache_file=OFFICIAL_BEARER_CACHE_FILE) -> None:
        logs.mask(api_key)
        self._api_key = api_key
        self._auth = PersonalApiAuthenticator(bearer_token_cache_file=bearer_cache_file)
        token = self._auth.obtain_token(api_key)
        logs.mask(token.access_token)
        self.token_expires_at = token.expires_at
        self._client = GarminPersonalApiClient(token.access_token)
        self._limiter = RateLimiter(1.0)

    def close(self) -> None:
        self._client.close()
        self._auth.close()

    # -- auth -------------------------------------------------------------------------------

    def _refresh_on_401(self, exc: BaseException) -> bool:
        if isinstance(exc, HttpError) and exc.status_code == 401:
            token = self._auth.obtain_token(self._api_key, force_refresh=True)
            logs.mask(token.access_token)
            self.token_expires_at = token.expires_at
            self._client.update_bearer_token(token.access_token)
            return True
        return False

    def _call(self, label: str, fn: Callable[[], Any], *, extra_wait_s: float = 0.0) -> Any:
        def attempt() -> Any:
            self._limiter.wait(extra_wait_s)
            return fn()

        return with_backoff(
            attempt, is_retryable=_retryable, on_auth_error=self._refresh_on_401, label=label
        )

    # -- endpoints (spec 3.2) ------------------------------------------------------------------

    def search_activities(
        self,
        *,
        start: int = 0,
        limit: int = 20,
        start_date: str | date | None = None,
        end_date: str | date | None = None,
        activity_type: str | None = None,
    ) -> Json:
        return self._call(
            "search_activities",
            lambda: self._client.search_activities(
                start=start,
                limit=limit,
                start_date=start_date,
                end_date=end_date,
                activity_type=activity_type,
            ),
        )

    def get_activity(self, activity_id: int) -> Json:
        return self._call("get_activity", lambda: self._client.get_activity(activity_id))

    def get_activity_workouts(self, activity_id: int) -> Json:
        return self._call(
            "get_activity_workouts", lambda: self._client.get_activity_workouts(activity_id)
        )

    def download_activity_zip(self, activity_id: int) -> bytes:
        # Spec 6.2: an extra 2 s pause between FIT downloads.
        return self._call(
            "download_activity",
            lambda: self._client.download_activity(activity_id),
            extra_wait_s=2.0,
        )

    def download_activity_fit(self, activity_id: int) -> bytes:
        """Return the original FIT bytes extracted from the download ZIP."""
        blob = self.download_activity_zip(activity_id)
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".fit")]
            if not names:
                raise ValueError(f"download for {activity_id} contained no .fit file")
            return zf.read(names[0])

    def get_daily_summaries(self, start: str | date, end: str | date) -> Json:
        return self._call(
            "get_daily_summaries", lambda: self._client.get_daily_summaries(start, end)
        )

    def get_daily_sleep(self, day: str | date) -> Json:
        return self._call("get_daily_sleep", lambda: self._client.get_daily_sleep(day))

    def get_daily_sleep_summaries(self, start: str | date, end: str | date) -> Json:
        return self._call(
            "get_daily_sleep_summaries", lambda: self._client.get_daily_sleep_summaries(start, end)
        )

    def get_daily_hrv(self, day: str | date) -> Json:
        return self._call("get_daily_hrv", lambda: self._client.get_daily_hrv(day))

    def get_daily_hrv_summaries(self, start: str | date, end: str | date) -> Json:
        return self._call(
            "get_daily_hrv_summaries", lambda: self._client.get_daily_hrv_summaries(start, end)
        )

    def get_daily_body_battery(self, start: str | date, end: str | date) -> Json:
        return self._call(
            "get_daily_body_battery", lambda: self._client.get_daily_body_battery(start, end)
        )

    def get_daily_stress(self, start: str | date, end: str | date) -> Json:
        return self._call("get_daily_stress", lambda: self._client.get_daily_stress(start, end))

    def get_daily_steps(self, start: str | date, end: str | date) -> Json:
        return self._call("get_daily_steps", lambda: self._client.get_daily_steps(start, end))

    def get_daily_heart_rate(self, day: str | date) -> Json:
        return self._call("get_daily_heart_rate", lambda: self._client.get_daily_heart_rate(day))

    def get_daily_spo2(self, day: str | date) -> Json:
        return self._call("get_daily_spo2", lambda: self._client.get_daily_spo2(day))

    def get_heart_rate_zones(self) -> Json:
        return self._call("get_heart_rate_zones", self._client.get_heart_rate_zones)

    def get_weight_measurements(self, start: str | date, end: str | date) -> Json:
        return self._call(
            "get_weight_measurements", lambda: self._client.get_weight_measurements(start, end)
        )

    def get_fitness_age(self, day: str | date) -> Json:
        return self._call("get_fitness_age", lambda: self._client.get_fitness_age(day))

    def get_user_profile_settings(self) -> Json:
        return self._call("get_user_profile_settings", self._client.get_user_profile_settings)

    def get_wellness_activity_summaries(self, start: str | date, end: str | date) -> Json:
        return self._call(
            "get_wellness_activity_summaries",
            lambda: self._client.get_wellness_activity_summaries(start, end),
        )

    def get(self, path: str, params: dict[str, Any] | None = None) -> Json:
        """Any other Swagger endpoint (GET only; the client has no write methods)."""
        return self._call(f"GET {path}", lambda: self._client.get(path, params=params))
