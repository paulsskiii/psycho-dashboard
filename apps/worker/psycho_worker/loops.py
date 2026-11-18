"""The three worker loops (spec §6.1): sync (30 min), nightly, backfill.

Every loop writes one ``sync_runs`` row, never partially writes an activity, is idempotent, and
exits non-zero only on a real failure (DB unreachable, official API dead after retries, code
error). A degraded unofficial source is not a failure.
"""

from __future__ import annotations

import json
import time
import traceback
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from . import logs
from .config import OFFICIAL_BEARER_CACHE_FILE, TIMEZONE, Settings
from .db import SECRET_OFFICIAL_BEARER, SECRET_UNOFFICIAL_TOKENS, Store
from .fitparse import parse_fit
from .garmin.official import OfficialGarmin
from .garmin.ratelimit import SourceDegraded
from .garmin.unofficial import NeedsLogin, ReadOnlyGarmin
from .mappers.activity import build_activity_row
from .mappers.wellness import build_wellness_rows

log = logs.get("loops")
TZ = ZoneInfo(TIMEZONE)


class RealFailure(Exception):
    """Something the job must report as failed (GitHub emails Paul)."""


# ---------------------------------------------------------------------------------------------
# Shared context
# ---------------------------------------------------------------------------------------------


class Ctx:
    def __init__(
        self, settings: Settings, store: Store, *, trigger: str, use_unofficial: bool
    ) -> None:
        self.settings = settings
        self.store = store
        self.trigger = trigger
        self.source_status: dict[str, str] = {"official": "ok", "unofficial": "skipped"}
        self.counts: dict[str, Any] = {}
        self.official = self._open_official()
        self.unofficial: ReadOnlyGarmin | None = None
        self._unofficial_tokens_in: str | None = None
        if use_unofficial:
            self.unofficial = self._open_unofficial()

    def _open_official(self) -> OfficialGarmin:
        key = self.settings.garmin_personal_api_key
        if not key:
            raise RealFailure("GARMIN_PERSONAL_API_KEY is not set")
        # Cloud: seed the local bearer cache from Vault so we don't re-exchange the key each run.
        cached = self.store.get_secret(SECRET_OFFICIAL_BEARER)
        self._bearer_in_vault = bool(cached)
        if cached and not OFFICIAL_BEARER_CACHE_FILE.exists():
            OFFICIAL_BEARER_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            OFFICIAL_BEARER_CACHE_FILE.write_text(cached)
            OFFICIAL_BEARER_CACHE_FILE.chmod(0o600)
        self._bearer_before = (
            OFFICIAL_BEARER_CACHE_FILE.read_text() if OFFICIAL_BEARER_CACHE_FILE.exists() else None
        )
        try:
            return OfficialGarmin(key)
        except Exception as exc:
            raise RealFailure(f"official API auth failed: {type(exc).__name__}") from exc

    def _open_unofficial(self) -> ReadOnlyGarmin | None:
        tokens = self.store.get_secret(SECRET_UNOFFICIAL_TOKENS)
        if not tokens:
            self.source_status["unofficial"] = "needs_login"
            log.warning(
                "no unofficial tokens in Vault; run `python -m psycho_worker login --upload`"
            )
            return None
        self._unofficial_tokens_in = tokens
        try:
            api = ReadOnlyGarmin(tokens)
        except NeedsLogin:
            self.source_status["unofficial"] = "needs_login"
            return None
        except Exception as exc:  # network / 429 at login time
            log.warning("unofficial login degraded", err=type(exc).__name__)
            self.source_status["unofficial"] = "degraded"
            return None
        self.source_status["unofficial"] = "ok"
        return api

    def unofficial_call(self, label: str, fn, default=None):
        """Call an unofficial method; never raises. Marks the source degraded / needs_login."""
        if self.unofficial is None:
            return default
        try:
            return fn(self.unofficial)
        except NeedsLogin:
            self.source_status["unofficial"] = "needs_login"
            self.unofficial = None
        except SourceDegraded:
            self.source_status["unofficial"] = "degraded"
        except Exception as exc:  # noqa: BLE001 — unofficial never fails the run
            log.warning("unofficial call failed", label=label, err=type(exc).__name__)
            self.source_status["unofficial"] = "degraded"
        return default

    def official_call(self, label: str, fn, default=None):
        """Official call: 429/5xx exhaustion marks degraded; auth failure is a real failure."""
        try:
            return fn(self.official)
        except SourceDegraded:
            self.source_status["official"] = "degraded"
            log.warning("official degraded", label=label)
            return default
        except Exception as exc:
            code = getattr(exc, "status_code", None)
            if code in (401, 403):
                raise RealFailure(f"official API {code} on {label}") from exc
            if code == 404:
                return default
            log.warning("official call failed", label=label, err=type(exc).__name__, http=code)
            return default

    def close(self) -> None:
        # Persist refreshed tokens so the next run doesn't refresh again.
        if self.unofficial is not None:
            try:
                now = self.unofficial.dump_tokens()
                if now and now != self._unofficial_tokens_in:
                    self.store.set_secret(SECRET_UNOFFICIAL_TOKENS, now)
                    log.info("unofficial tokens rotated in Vault")
            except Exception as exc:  # noqa: BLE001
                log.warning("could not persist unofficial tokens", err=type(exc).__name__)
        if OFFICIAL_BEARER_CACHE_FILE.exists():
            after = OFFICIAL_BEARER_CACHE_FILE.read_text()
            if after != self._bearer_before or not self._bearer_in_vault:
                self.store.set_secret(SECRET_OFFICIAL_BEARER, after)
        self.official.close()


def _run(settings: Settings, trigger: str, *, use_unofficial: bool, body) -> int:
    if not settings.has_supabase:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set", flush=True)
        return 2
    store = Store(settings.supabase_url or "", settings.supabase_service_role_key or "")
    t0 = time.monotonic()
    run_id = store.start_run(trigger)
    ctx: Ctx | None = None
    try:
        ctx = Ctx(settings, store, trigger=trigger, use_unofficial=use_unofficial)
        ctx.run_id = run_id
        body(ctx)
        status = "ok" if ctx.source_status["official"] == "ok" else "degraded"
        if ctx.source_status["unofficial"] in ("degraded", "needs_login"):
            status = "degraded" if status == "ok" else status
        ctx.counts["duration_s"] = round(time.monotonic() - t0, 1)
        store.finish_run(run_id, status=status, source_status=ctx.source_status, counts=ctx.counts)
        log.info("run finished", trigger=trigger, status=status, **ctx.counts)
        return 0
    except RealFailure as exc:
        store.finish_run(
            run_id,
            status="failed",
            source_status=ctx.source_status if ctx else {},
            counts=(ctx.counts if ctx else {}) | {"duration_s": round(time.monotonic() - t0, 1)},
            error=str(exc),
        )
        log.error("run failed", trigger=trigger, error=str(exc))
        return 1
    except Exception as exc:
        store.finish_run(
            run_id,
            status="failed",
            source_status=ctx.source_status if ctx else {},
            counts=(ctx.counts if ctx else {}) | {"duration_s": round(time.monotonic() - t0, 1)},
            error=f"{type(exc).__name__}: {exc}"[:500],
        )
        log.error("run crashed", trigger=trigger, error=type(exc).__name__)
        traceback.print_exc()
        return 1
    except KeyboardInterrupt:
        store.finish_run(
            run_id,
            status="aborted",
            source_status=ctx.source_status if ctx else {},
            counts=(ctx.counts if ctx else {}) | {"duration_s": round(time.monotonic() - t0, 1)},
            error="interrupted",
        )
        log.warning("run aborted", trigger=trigger)
        return 130
    finally:
        if ctx is not None:
            ctx.close()


# ---------------------------------------------------------------------------------------------
# Building blocks
# ---------------------------------------------------------------------------------------------


def _today() -> date:
    return datetime.now(TZ).date()


# Garmin's official range endpoints reject long windows with HTTP 400. Measured 17 Nov 2026:
# steps fails at 29 days and works at 28; sleep/body battery/HRV/summaries accept 31.
WELLNESS_MAX_RANGE_DAYS = 28


def pull_wellness(ctx: Ctx, start: date, end: date, *, with_spo2: bool) -> int:
    """Official daily endpoints for [start, end] → daily_wellness upsert, in ≤ 31-day chunks."""
    total = 0
    chunk_start = start
    while chunk_start <= end:
        chunk_end = min(end, chunk_start + timedelta(days=WELLNESS_MAX_RANGE_DAYS - 1))
        total += _pull_wellness_chunk(ctx, chunk_start, chunk_end, with_spo2=with_spo2)
        chunk_start = chunk_end + timedelta(days=1)
    return total


def _pull_wellness_chunk(ctx: Ctx, start: date, end: date, *, with_spo2: bool) -> int:
    s, e = start.isoformat(), end.isoformat()
    o = ctx.official_call
    summaries = o("daily_summaries", lambda a: a.get_daily_summaries(s, e))
    sleep = o("sleep_summaries", lambda a: a.get_daily_sleep_summaries(s, e))
    hrv = o("hrv_summaries", lambda a: a.get_daily_hrv_summaries(s, e))
    bb = o("body_battery", lambda a: a.get_daily_body_battery(s, e))
    steps = o("steps", lambda a: a.get_daily_steps(s, e))
    dates = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    spo2: dict[str, Any] = {}
    if with_spo2:
        for d in dates:
            v = o("spo2", lambda a, d=d: a.get_daily_spo2(d.isoformat()))
            if isinstance(v, dict):
                spo2[d.isoformat()] = v
    rows = build_wellness_rows(
        dates=dates,
        daily_summaries=summaries,
        sleep_summaries=sleep,
        hrv_summaries=hrv,
        body_battery=bb,
        steps=steps,
        spo2_by_date=spo2,
    )
    return ctx.store.upsert_wellness(rows)


def list_activities(ctx: Ctx, start: date, end: date) -> list[dict[str, Any]]:
    """All official activity summaries in [start, end], paginated."""
    out: list[dict[str, Any]] = []
    page = 0
    limit = 100
    while True:
        res = ctx.official_call(
            "search_activities",
            lambda a, page=page: a.search_activities(
                start=page * limit,
                limit=limit,
                start_date=start.isoformat(),
                end_date=end.isoformat(),
            ),
            default=[],
        )
        items = res if isinstance(res, list) else (res or {}).get("activities") or []
        out.extend(items)
        if len(items) < limit:
            break
        page += 1
    return out


def ingest_activity(
    ctx: Ctx, summary: dict[str, Any], by_date: dict[int, dict] | None = None
) -> bool:
    """Full pipeline for one activity. Returns True if written. Never leaves a partial row."""
    aid = int(summary["activityId"])
    o = ctx.official_call
    detail = o("get_activity", lambda a: a.get_activity(aid))
    workouts = o("get_activity_workouts", lambda a: a.get_activity_workouts(aid), default=[])
    fit_bytes = o("download_activity", lambda a: a.download_activity_fit(aid))
    if ctx.source_status["official"] == "degraded" and fit_bytes is None:
        log.warning("skipping activity; official degraded", activity_id=aid)
        return False

    parsed = None
    fit_path = None
    if fit_bytes:
        try:
            parsed = parse_fit(fit_bytes)
        except Exception as exc:  # noqa: BLE001 — a bad FIT must not block the summary row
            log.warning("fit parse failed", activity_id=aid, err=type(exc).__name__)
        fit_path = ctx.store.upload_fit(aid, fit_bytes)

    uo: dict[str, Any] = {}
    if by_date and aid in by_date:
        uo["by_date"] = by_date[aid]
    u = ctx.unofficial_call
    uo["typed_splits"] = u("typed_splits", lambda a: a.get_activity_typed_splits(str(aid)))
    uo["hr_zones"] = u("hr_zones", lambda a: a.get_activity_hr_in_timezones(str(aid)))
    uo["weather"] = u("weather", lambda a: a.get_activity_weather(str(aid)))
    type_key = str((summary.get("activityType") or {}).get("typeKey") or "")
    if "strength" in type_key:
        uo["exercise_sets"] = u("exercise_sets", lambda a: a.get_activity_exercise_sets(aid))

    row = build_activity_row(
        summary=summary,
        detail=detail,
        workouts=workouts,
        fit=parsed,
        fit_path=fit_path,
        unofficial=uo,
    )
    streams = parsed["streams"] if parsed else None
    laps = parsed["laps"] if parsed else None
    if parsed and parsed.get("sets"):
        row["raw_unofficial"] = (row.get("raw_unofficial") or {}) | {"fit_sets": parsed["sets"]}
    try:
        ctx.store.upsert_activity(row, streams, laps)
    except Exception as exc:  # noqa: BLE001 — one bad write must not kill a multi-hour backfill
        ctx.counts["activities_failed"] = ctx.counts.get("activities_failed", 0) + 1
        ctx.counts.setdefault("failed_ids", []).append(aid)
        log.error("activity write failed", activity_id=aid, err=type(exc).__name__)
        if ctx.counts["activities_failed"] >= 5:
            raise RealFailure("5 activity writes failed; database unreachable?") from exc
        return False
    log.info("activity written", activity_id=aid, sport=row["sport"], has_fit=bool(parsed))
    return True


def by_date_map(ctx: Ctx, start: date, end: date) -> dict[int, dict]:
    """Unofficial activity list rows keyed by id (carries per-activity VO2 max)."""
    items = ctx.unofficial_call(
        "activities_by_date",
        lambda a: a.get_activities_by_date(start.isoformat(), end.isoformat()),
        default=[],
    )
    return {int(i["activityId"]): i for i in items or [] if i.get("activityId")}


def pull_device_status(ctx: Ctx) -> None:
    d = ctx.unofficial_call("device_last_used", lambda a: a.get_device_last_used())
    if isinstance(d, dict):
        ts = d.get("lastUsedDeviceUploadTime")
        when = datetime.fromtimestamp(ts / 1000, tz=TZ) if isinstance(ts, (int, float)) else None
        ctx.store.set_device_status(d.get("lastUsedDeviceName"), when)


def recompute_load(ctx: Ctx, from_date: date, *, force: bool = False) -> None:
    """Metrics engine (spec §8): activity_metrics for activities ≥ from_date, full daily_load.
    ``force`` recomputes every activity from ``from_date`` even if unchanged (new HR constants)."""
    from .metrics.engine import recompute

    ctx.counts["load_recompute_from"] = from_date.isoformat()
    try:
        ctx.counts["metrics"] = recompute(ctx.store, from_date, force=force)
    except ValueError as exc:  # e.g. HRmax not yet known on a brand-new database
        log.warning("metrics skipped", reason=str(exc))
        ctx.counts["metrics"] = {"skipped": str(exc)}


# ---------------------------------------------------------------------------------------------
# Loops
# ---------------------------------------------------------------------------------------------


def sync(settings: Settings) -> int:
    def body(ctx: Ctx) -> None:
        today = _today()
        ctx.counts["wellness_days"] = pull_wellness(
            ctx, today - timedelta(days=1), today, with_spo2=False
        )

        newest = ctx.store.newest_activity_start()
        start = (
            (newest.astimezone(TZ).date() - timedelta(days=2))
            if newest
            else today - timedelta(days=7)
        )
        summaries = list_activities(ctx, start, today)
        known = ctx.store.known_activity_ids(
            datetime.combine(start, datetime.min.time(), TZ).isoformat(),
            datetime.combine(today + timedelta(days=1), datetime.min.time(), TZ).isoformat(),
        )
        todo = [
            s
            for s in summaries
            if int(s["activityId"]) not in known or not known[int(s["activityId"])].get("fit_path")
        ]
        ctx.counts["activities_seen"] = len(summaries)
        ctx.counts["activities_new"] = len(todo)
        bd = by_date_map(ctx, start, today) if todo else {}
        written = 0
        earliest: date | None = None
        for s in todo:
            if ingest_activity(ctx, s, bd):
                written += 1
                d = datetime.strptime(s["startTimeLocal"][:10], "%Y-%m-%d").date()
                earliest = d if earliest is None or d < earliest else earliest
        ctx.counts["activities_written"] = written
        # Always recompute: morning readiness depends on overnight wellness, which arrives
        # without any new activity. Activity metrics only run for days ≥ from_date, so this
        # is a few hundred daily_load rows when nothing changed.
        recompute_load(ctx, earliest or today)
        pull_device_status(ctx)
        ctx.counts["requests_handled"] = ctx.store.mark_requests_handled()

    return _run(settings, "sync", use_unofficial=True, body=body)


def nightly(settings: Settings) -> int:
    def body(ctx: Ctx) -> None:
        today = _today()
        ctx.counts["wellness_days"] = pull_wellness(
            ctx, today - timedelta(days=2), today, with_spo2=True
        )
        ctx.counts["enrich"] = enrich_window(ctx, today - timedelta(days=120), today)
        pull_hr_zones(ctx)
        pull_device_status(ctx)
        ctx.counts["streams_trimmed"] = ctx.store.trim_old_streams()
        ctx.store.export_config()
        # "Recompute history" in Settings (new HRmax / LTHR / Z2 band) runs here, not in sync:
        # every activity's streams are re-read, ~4 min, too long for sync's 5-min budget.
        if ctx.store.has_pending_request("recompute"):
            recompute_load(ctx, date(2000, 1, 1), force=True)
            ctx.counts["recompute_requests"] = ctx.store.mark_requests_handled("recompute")
        else:
            recompute_load(ctx, today - timedelta(days=120))

    return _run(settings, "nightly", use_unofficial=True, body=body)


def enrich_window(ctx: Ctx, start: date, end: date) -> dict[str, int]:
    """Unofficial-only data for [start, end]: VO2 max, race predictions, PRs, weigh-ins, fitness age."""
    s, e = start.isoformat(), end.isoformat()
    u = ctx.unofficial_call
    counts: dict[str, int] = {}

    vo2 = u("max_metrics_range", lambda a: a.get_max_metrics_range(s, e), default=[]) or []
    patches = []
    for item in vo2:
        g = item.get("generic") or {}
        if g.get("calendarDate") and g.get("vo2MaxPreciseValue") is not None:
            patches.append({"date": g["calendarDate"], "vo2max": g["vo2MaxPreciseValue"]})
    counts["vo2max_days"] = ctx.store.patch_wellness(patches)

    preds = (
        u("race_predictions", lambda a: a.get_race_predictions(s, e, _type="daily"), default=[])
        or []
    )
    rows = [
        {
            "date": p["calendarDate"],
            "k5_s": p.get("time5K"),
            "k10_s": p.get("time10K"),
            "hm_s": p.get("timeHalfMarathon"),
            "m_s": p.get("timeMarathon"),
        }
        for p in preds
        if p.get("calendarDate")
    ]
    counts["race_prediction_days"] = ctx.store.upsert_race_predictions(rows)

    prs = u("personal_record", lambda a: a.get_personal_record(), default=[]) or []
    pr_rows = []
    for p in prs:
        t = PR_TYPES.get(p.get("typeId"))
        if t and p.get("value") is not None:
            # Garmin gives epoch-ms ints plus "*Formatted" ISO strings; use the strings.
            when = (
                p.get("prStartTimeLocalFormatted")
                or p.get("activityStartDateTimeLocalFormatted")
                or ""
            )[:10] or None
            pr_rows.append(
                {
                    "type": t,
                    "value": p["value"],
                    "activity_id": p.get("activityId"),
                    "achieved_on": when,
                }
            )
    counts["personal_records"] = ctx.store.upsert_personal_records(pr_rows)

    # Weigh-ins: official range endpoint (source of truth), unofficial body comp adds the rest.
    w = ctx.official_call("weight_measurements", lambda a: a.get_weight_measurements(s, e)) or {}
    w_rows = []
    for day in w.get("dailyWeightSummaries") or []:
        for m in day.get("allWeightMetrics") or []:
            ts = m.get("timestampGMT") or m.get("date")
            if ts is None or m.get("weight") is None:
                continue
            when = (
                datetime.fromtimestamp(ts / 1000, tz=UTC_TZ)
                if isinstance(ts, (int, float))
                else None
            )
            if when is None:
                continue
            w_rows.append(
                {
                    "ts": when.isoformat(),
                    "weight_kg": round(m["weight"] / 1000, 2),
                    "body_fat_pct": m.get("bodyFat"),
                    "muscle_kg": round(m["muscleMass"] / 1000, 2) if m.get("muscleMass") else None,
                    "bone_kg": round(m["boneMass"] / 1000, 2) if m.get("boneMass") else None,
                    "water_pct": m.get("bodyWater"),
                }
            )
    counts["weigh_ins"] = ctx.store.upsert_weigh_ins(w_rows)

    fa = u("fitness_age", lambda a: a.get_fitnessage_data(e))
    if isinstance(fa, dict) and fa.get("fitnessAge") is not None:
        ctx.store.patch_wellness([{"date": e, "fitness_age": fa["fitnessAge"]}])

    # Forward-compat (expected empty on the FR165): store only when Garmin returns values.
    tr = u("training_readiness", lambda a: a.get_training_readiness(e), default=[]) or []
    ts_ = u("training_status", lambda a: a.get_training_status(e)) or {}
    native: dict[str, Any] = {"date": e}
    if tr and isinstance(tr, list) and isinstance(tr[0], dict) and tr[0].get("score") is not None:
        native["native_readiness"] = tr[0]["score"]
    mrts = ts_.get("mostRecentTrainingStatus") if isinstance(ts_, dict) else None
    if isinstance(mrts, dict):
        status_key = next(
            (
                v.get("trainingStatusFeedbackPhrase")
                for v in (mrts.get("latestTrainingStatusData") or {}).values()
                if isinstance(v, dict)
            ),
            None,
        )
        if status_key:
            native["native_training_status"] = status_key
    if len(native) > 1:
        ctx.store.patch_wellness([native])
    return counts


UTC_TZ = ZoneInfo("UTC")

# Garmin PR typeIds (running + steps). Verified ids on Paul's account: 1,2,3,4,5,7,12..18,31.
PR_TYPES = {
    1: "run_1k",
    2: "run_1mi",
    3: "run_5k",
    4: "run_10k",
    5: "run_hm",
    6: "run_m",
    7: "run_longest",
    8: "ride_40k",
    9: "ride_longest",
    10: "ride_max_power",
    11: "swim_longest",
    12: "steps_day",
    13: "steps_week",
    14: "steps_month",
    15: "steps_goal_streak",
    16: "steps_week_total",
    17: "steps_month_total",
    18: "steps_goal_days",
    # 31 exists on Paul's account with a value of 124000; unit unknown → deliberately unmapped.
}


def pull_hr_zones(ctx: Ctx) -> None:
    z = ctx.official_call("heart_rate_zones", lambda a: a.get_heart_rate_zones())
    items = z if isinstance(z, list) else [z] if isinstance(z, dict) else []
    default = next(
        (i for i in items if i.get("sport") in ("DEFAULT", None)), items[0] if items else None
    )
    if not default:
        return
    cfg = ctx.store.athlete_config()
    zones = {
        "method": default.get("trainingMethod"),
        "max_hr": default.get("maxHeartRateUsed"),
        "rest_hr": default.get("restingHeartRateUsed"),
        "lthr": default.get("lactateThresholdHeartRateUsed"),
        "floors": [default.get(f"zone{i}Floor") for i in range(1, 6)],
        "fetched_at": datetime.now(TZ).isoformat(),
    }
    fields: dict[str, Any] = {"hr_zones": zones}
    if cfg.get("max_hr") is None and zones["max_hr"]:
        fields["max_hr"] = zones["max_hr"]
    if cfg.get("lthr") is None:
        fields["lthr"] = zones["lthr"] or zones["floors"][4]
    ctx.store.update_config(**fields)


MONTH_TRIES = 4
MONTH_RETRY_SLEEP_S = 60


def _transient(exc: BaseException) -> bool:
    """Network blips on the Mac (Garmin or Supabase timeouts) must not end a multi-hour backfill."""
    import httpx
    import requests

    return isinstance(
        exc,
        (
            httpx.TimeoutException,
            httpx.TransportError,
            requests.exceptions.ConnectionError,
            requests.exceptions.Timeout,
            SourceDegraded,
        ),
    )


def _backfill_month(ctx: Ctx, start: date, end: date, totals: dict[str, Any]) -> dict[str, int]:
    """One calendar month, retried as a whole on transient network errors (idempotent)."""
    for attempt in range(1, MONTH_TRIES + 1):
        try:
            totals["wellness_days"] += pull_wellness(ctx, start, end, with_spo2=False)
            summaries = list_activities(ctx, start, end)
            known = ctx.store.known_activity_ids(
                datetime.combine(start, datetime.min.time(), TZ).isoformat(),
                datetime.combine(end + timedelta(days=1), datetime.min.time(), TZ).isoformat(),
            )
            todo = [
                s
                for s in summaries
                if int(s["activityId"]) not in known
                or not known[int(s["activityId"])].get("fit_path")
            ]
            bd = by_date_map(ctx, start, end) if todo else {}
            for s in todo:
                if ingest_activity(ctx, s, bd):
                    totals["activities_written"] += 1
            return enrich_window(ctx, start, end)
        except RealFailure:
            raise
        except Exception as exc:
            if not _transient(exc) or attempt == MONTH_TRIES:
                raise
            log.warning(
                "month hit a network error; retrying",
                start=start.isoformat(),
                attempt=attempt,
                err=type(exc).__name__,
            )
            time.sleep(MONTH_RETRY_SLEEP_S)
    raise AssertionError("unreachable")


def backfill(settings: Settings, *, months: int = 18, resume: bool = True) -> int:
    """Walk back month by month from today. Resumable: checkpoint = last completed month."""

    def body(ctx: Ctx) -> None:
        today = _today()
        # A backfill killed without SIGINT leaves a 'running' row; close it so Settings is honest.
        ctx.store.c.table("sync_runs").update(
            {
                "status": "aborted",
                "finished_at": datetime.now(TZ).isoformat(),
                "error": "superseded",
            }
        ).eq("trigger", "backfill").eq("status", "running").neq("id", ctx.run_id).execute()
        done_until: date | None = None
        if resume:
            cp = ctx.store.last_checkpoint("backfill") or {}
            if cp.get("completed_through"):
                done_until = date.fromisoformat(cp["completed_through"])
        totals = {"months": 0, "activities_written": 0, "wellness_days": 0}
        end = today
        for _ in range(months):
            start = end.replace(day=1)
            if done_until and end <= done_until:
                log.info("month already backfilled", start=start.isoformat(), end=end.isoformat())
                end = start - timedelta(days=1)
                continue
            log.info("backfill month", start=start.isoformat(), end=end.isoformat())
            enrich = _backfill_month(ctx, start, end, totals)
            totals["months"] += 1
            ctx.counts.update(totals)
            ctx.counts["completed_through"] = start.isoformat()
            ctx.counts["last_enrich"] = enrich
            # Checkpoint after every month so a crash resumes here.
            ctx.store.c.table("sync_runs").update({"counts": ctx.counts}).eq(
                "trigger", "backfill"
            ).order("started_at", desc=True).limit(1).execute()
            end = start - timedelta(days=1)
        pull_hr_zones(ctx)
        pull_device_status(ctx)
        recompute_load(ctx, end)

    return _run(settings, "backfill", use_unofficial=True, body=body)


def push_tokens(settings: Settings, tokens_json: str) -> int:
    """Upload the locally saved unofficial tokens to Vault (``login --upload``)."""
    if not settings.has_supabase:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set", flush=True)
        return 2
    json.loads(tokens_json)
    store = Store(settings.supabase_url or "", settings.supabase_service_role_key or "")
    store.set_secret(SECRET_UNOFFICIAL_TOKENS, tokens_json)
    print("Uploaded Garmin tokens to Supabase Vault.")
    return 0


def set_owner(settings: Settings, email: str) -> int:
    if not settings.has_supabase:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set", flush=True)
        return 2
    store = Store(settings.supabase_url or "", settings.supabase_service_role_key or "")
    store.update_config(owner_email=email.strip().lower())
    print(f"Owner email set to {email.strip().lower()}. Only this address can sign in.")
    return 0
