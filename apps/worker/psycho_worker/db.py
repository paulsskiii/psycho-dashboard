"""Supabase access for the worker (service role only; never used by the web app).

Uses PostgREST via supabase-py. Multi-table activity writes go through the ``upsert_activity``
SQL function so they're atomic (spec §6.2). Vault secrets go through ``get_secret``/``set_secret``.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from typing import Any

import httpx
from supabase import Client, ClientOptions, create_client

from . import logs

log = logs.get("db")

SECRET_UNOFFICIAL_TOKENS = "garmin_unofficial_tokens"
SECRET_OFFICIAL_BEARER = "garmin_personal_access_token"


def _retryable(exc: BaseException) -> bool:
    """Transient DB trouble: transport timeouts, or an APIError without a JSON code (edge HTML)
    or with a 5xx code. Real 4xx errors (bad payload, constraint) are not retried."""
    if isinstance(exc, (httpx.TimeoutException, httpx.TransportError)):
        return True
    code = str(getattr(exc, "code", "") or "")
    return type(exc).__name__ == "APIError" and (code == "" or code.startswith("5"))


def _retry(fn, label: str):
    from .garmin.ratelimit import with_backoff

    return with_backoff(fn, is_retryable=_retryable, label=label)


class Store:
    def __init__(self, url: str, service_role_key: str) -> None:
        logs.mask(service_role_key)
        self.c: Client = create_client(
            url,
            service_role_key,
            options=ClientOptions(postgrest_client_timeout=120, storage_client_timeout=90),
        )

    # -- vault --------------------------------------------------------------------------------

    def get_secret(self, name: str) -> str | None:
        res = self.c.rpc("get_secret", {"p_name": name}).execute()
        value = res.data
        if isinstance(value, str) and value:
            logs.mask(value)
            return value
        return None

    def set_secret(self, name: str, value: str) -> None:
        logs.mask(value)
        self.c.rpc("set_secret", {"p_name": name, "p_value": value}).execute()

    # -- config ---------------------------------------------------------------------------------

    def athlete_config(self) -> dict[str, Any]:
        res = self.c.table("athlete_config").select("*").eq("id", 1).single().execute()
        return res.data or {}

    def update_config(self, **fields: Any) -> None:
        fields["updated_at"] = _now()
        self.c.table("athlete_config").update(fields).eq("id", 1).execute()

    def set_device_status(self, name: str | None, last_sync_at: datetime | None) -> None:
        self.c.table("device_status").upsert(
            {
                "id": 1,
                "device_name": name,
                "last_sync_at": last_sync_at.isoformat() if last_sync_at else None,
                "updated_at": _now(),
            }
        ).execute()

    # -- sync bookkeeping --------------------------------------------------------------------

    def start_run(self, trigger: str) -> int:
        res = self.c.table("sync_runs").insert({"trigger": trigger, "status": "running"}).execute()
        return int(res.data[0]["id"])

    def finish_run(
        self,
        run_id: int,
        *,
        status: str,
        source_status: dict[str, str],
        counts: dict[str, Any],
        error: str | None = None,
    ) -> None:
        self.c.table("sync_runs").update(
            {
                "finished_at": _now(),
                "status": status,
                "source_status": source_status,
                "counts": counts,
                "error": error,
            }
        ).eq("id", run_id).execute()

    def last_checkpoint(self, trigger: str) -> dict[str, Any] | None:
        res = (
            self.c.table("sync_runs")
            .select("counts")
            .eq("trigger", trigger)
            .order("started_at", desc=True)
            .limit(1)
            .execute()
        )
        return (res.data[0]["counts"] if res.data else None) or None

    def mark_requests_handled(self, kind: str = "sync") -> int:
        """Close open requests of one kind ('sync' from Sync now, 'recompute' from Settings)."""
        res = (
            self.c.table("sync_requests")
            .update({"handled_at": _now()})
            .is_("handled_at", "null")
            .eq("kind", kind)
            .execute()
        )
        return len(res.data or [])

    def has_pending_request(self, kind: str) -> bool:
        res = (
            self.c.table("sync_requests")
            .select("id")
            .is_("handled_at", "null")
            .eq("kind", kind)
            .limit(1)
            .execute()
        )
        return bool(res.data)

    # -- activities -------------------------------------------------------------------------------

    def newest_activity_start(self) -> datetime | None:
        res = (
            self.c.table("activities")
            .select("start_utc")
            .order("start_utc", desc=True)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None
        return datetime.fromisoformat(res.data[0]["start_utc"])

    def known_activity_ids(self, start_iso: str, end_iso: str) -> dict[int, dict[str, Any]]:
        res = _retry(
            lambda: (
                self.c.table("activities")
                .select("id, fit_path, synced_at")
                .gte("start_utc", start_iso)
                .lte("start_utc", end_iso)
                .execute()
            ),
            "known_activity_ids",
        )
        return {int(r["id"]): r for r in res.data or []}

    def upsert_activity(
        self,
        row: dict[str, Any],
        streams: dict[str, Any] | None,
        laps: list[dict[str, Any]] | None,
    ) -> None:
        # jsonb_populate_record bypasses column defaults, so every not-null column must be set.
        row = {**row, "synced_at": _now()}
        laps_rows = (
            [{"activity_id": row["id"], **lap} for lap in laps] if laps is not None else None
        )
        _retry(
            lambda: self.c.rpc(
                "upsert_activity",
                {"p_activity": row, "p_streams": streams, "p_laps": laps_rows},
            ).execute(),
            f"upsert_activity {row['id']}",
        )

    def upload_fit(self, activity_id: int, data: bytes) -> str:
        path = f"{activity_id}.fit"
        _retry(
            lambda: self.c.storage.from_("fit").upload(
                path, data, {"content-type": "application/octet-stream", "upsert": "true"}
            ),
            f"upload_fit {activity_id}",
        )
        return f"fit/{path}"

    # -- daily tables -----------------------------------------------------------------------------

    def upsert_wellness(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        for r in rows:
            r["synced_at"] = _now()
        _retry(
            lambda: self.c.table("daily_wellness").upsert(rows, on_conflict="date").execute(),
            "upsert_wellness",
        )
        return len(rows)

    def patch_wellness(self, rows: list[dict[str, Any]]) -> int:
        """Merge nightly-only columns (vo2max, fitness_age, native_*) without clobbering the rest."""
        n = 0
        for r in rows:
            d = r.pop("date")
            if not r:
                continue
            existing = self.c.table("daily_wellness").select("date").eq("date", d).execute()
            if existing.data:
                self.c.table("daily_wellness").update(r).eq("date", d).execute()
            else:
                self.c.table("daily_wellness").insert({"date": d, **r}).execute()
            n += 1
        return n

    def upsert_race_predictions(self, rows: list[dict[str, Any]]) -> int:
        if rows:
            self.c.table("race_predictions").upsert(rows, on_conflict="date").execute()
        return len(rows)

    def upsert_personal_records(self, rows: list[dict[str, Any]]) -> int:
        if rows:
            self.c.table("personal_records").upsert(rows, on_conflict="type").execute()
            # Garmin's PR list is authoritative: drop types it no longer reports (or we unmapped).
            types = [r["type"] for r in rows]
            self.c.table("personal_records").delete().not_.in_("type", types).execute()
        return len(rows)

    def upsert_weigh_ins(self, rows: list[dict[str, Any]]) -> int:
        if rows:
            self.c.table("weigh_ins").upsert(rows, on_conflict="ts").execute()
        return len(rows)

    def trim_old_streams(self) -> int:
        res = self.c.rpc("trim_old_streams", {}).execute()
        return int(res.data or 0)

    # -- metrics engine inputs/outputs ----------------------------------------------------------

    def recent_rhr(self, start: date, end: date) -> list[int | None]:
        res = (
            self.c.table("daily_wellness")
            .select("rhr")
            .gte("date", start.isoformat())
            .lte("date", end.isoformat())
            .execute()
        )
        return [r.get("rhr") for r in res.data or []]

    def activities_since(self, start: date) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        page, size = 0, 1000
        while True:
            res = (
                self.c.table("activities")
                .select(
                    "id, start_local, sport, garmin_type, duration_s, moving_s, distance_m, "
                    "elev_gain_m, indoor, has_workout, synced_at"
                )
                .gte("start_local", start.isoformat())
                .order("start_local")
                .range(page * size, (page + 1) * size - 1)
                .execute()
            )
            out.extend(res.data or [])
            if len(res.data or []) < size:
                return out
            page += 1

    def activity_metrics_all(self) -> dict[int, dict[str, Any]]:
        out: dict[int, dict[str, Any]] = {}
        page, size = 0, 1000
        while True:
            res = (
                self.c.table("activity_metrics")
                .select("*")
                .order("activity_id")
                .range(page * size, (page + 1) * size - 1)
                .execute()
            )
            for r in res.data or []:
                out[int(r["activity_id"])] = r
            if len(res.data or []) < size:
                return out
            page += 1

    def streams(self, activity_id: int) -> dict[str, Any] | None:
        res = (
            self.c.table("activity_streams")
            .select("t, hr, speed, dist, alt")
            .eq("activity_id", activity_id)
            .execute()
        )
        return res.data[0] if res.data else None

    def upsert_activity_metrics(self, row: dict[str, Any]) -> None:
        self.c.table("activity_metrics").upsert(row, on_conflict="activity_id").execute()

    def wellness_since(self, start: date) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        page, size = 0, 1000
        while True:
            res = (
                self.c.table("daily_wellness")
                .select("date, rhr, hrv_night_avg, sleep_score, sleep_s, bb_wake, vo2max")
                .gte("date", start.isoformat())
                .order("date")
                .range(page * size, (page + 1) * size - 1)
                .execute()
            )
            out.extend(res.data or [])
            if len(res.data or []) < size:
                return out
            page += 1

    def upsert_daily_load(self, rows: list[dict[str, Any]]) -> int:
        for i in range(0, len(rows), 500):
            self.c.table("daily_load").upsert(rows[i : i + 500], on_conflict="date").execute()
        return len(rows)

    def export_config(self) -> None:
        cfg = self.athlete_config()
        safe = {k: v for k, v in cfg.items() if k not in ("owner_id", "owner_email")}
        self.c.storage.from_("config").upload(
            "athlete_config.json",
            json.dumps(safe, indent=1, default=str).encode(),
            {"content-type": "application/json", "upsert": "true"},
        )


def _now() -> str:
    return datetime.now(UTC).isoformat()
