"""Orchestration: activity_metrics for activities, then the daily_load series (spec §8).

``recompute(store, from_date)``:
  1. compute ``activity_metrics`` for every activity on/after ``from_date`` that has no metrics
     yet or whose streams were re-synced after the last computation (or all, when ``force``);
  2. rebuild the full ``daily_load`` series from the first activity to today (cheap: one row/day)
     and upsert it, with status, readiness, readiness parts and the verdict sentence.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .. import logs
from ..config import TIMEZONE
from .constants import Constants, derive_constants
from .efficiency import decoupling_pct, efficiency_factor, is_hilly, is_steady, pace_at_hr
from .fitness import build_series, classify_status, trend
from .load import estimated_hrtss, three_zone_pct, time_in_zones, trimp_and_hrtss
from .readiness import compute_readiness, verdict_sentence

log = logs.get("metrics")
TZ = ZoneInfo(TIMEZONE)
DRIFTED_HARD_MOD_PLUS_PCT = 30.0
LOAD_SPORTS = ("run", "ride", "strength")


def activity_metrics_row(
    activity: dict[str, Any], streams: dict[str, Any] | None, c: Constants
) -> dict[str, Any]:
    t = (streams or {}).get("t") or []
    hr = (streams or {}).get("hr") or []
    speed = (streams or {}).get("speed") or []
    has_hr = any(v is not None for v in hr)
    row: dict[str, Any] = {"activity_id": activity["id"]}

    if has_hr and len(t) == len(hr):
        trimp, hrtss = trimp_and_hrtss(t, hr, c)
        row["trimp"] = round(trimp, 1)
        row["hrtss"] = round(hrtss, 1)
        row["hrtss_estimated"] = False
        zone_s = time_in_zones(t, hr, c)
        row["zone_s"] = zone_s
        row["low_pct"], row["mod_pct"], row["high_pct"] = three_zone_pct(zone_s)
    else:
        row["trimp"] = None
        row["hrtss"] = estimated_hrtss(activity.get("duration_s"))
        row["hrtss_estimated"] = True
        row["zone_s"] = None
        row["low_pct"] = row["mod_pct"] = row["high_pct"] = None

    duration = activity.get("duration_s") or 0
    is_run = activity.get("sport") == "run"
    row["hilly"] = (
        is_hilly(activity.get("elev_gain_m"), activity.get("distance_m")) if is_run else False
    )
    row["ef"] = row["decoupling_pct"] = row["pace_at_hr_s_per_km"] = None
    row["steady"] = None
    if is_run and has_hr and speed and len(speed) == len(t):
        if duration >= 30 * 60:
            row["ef"] = efficiency_factor(t, hr, speed)
            row["steady"] = is_steady(t, speed)
            if duration >= 45 * 60 and row["steady"]:
                row["decoupling_pct"] = decoupling_pct(t, hr, speed)
        row["pace_at_hr_s_per_km"] = pace_at_hr(t, hr, speed, c.z2_band)
    structured = bool(activity.get("has_workout")) or "interval" in str(
        activity.get("garmin_type") or ""
    )
    row["drifted_hard"] = bool(
        is_run
        and not structured
        and row["mod_pct"] is not None
        and (row["mod_pct"] + row["high_pct"]) >= DRIFTED_HARD_MOD_PLUS_PCT
    )
    row["computed_at"] = datetime.now(TZ).isoformat()
    return row


def build_daily_load(
    *,
    activities: list[dict[str, Any]],
    metrics_by_id: dict[int, dict[str, Any]],
    wellness: list[dict[str, Any]],
    config: dict[str, Any],
    today: date,
) -> list[dict[str, Any]]:
    """Pure: full daily_load rows from the first activity day through today."""
    if not activities:
        return []
    tss_by_day: dict[date, dict[str, float]] = {}
    first = today
    for a in activities:
        d = date.fromisoformat(str(a["start_local"])[:10])
        first = min(first, d)
        m = metrics_by_id.get(int(a["id"]))
        if not m or m.get("hrtss") is None:
            continue
        sport = a.get("sport")
        key = sport if sport in LOAD_SPORTS else None
        if key is None:
            continue  # walks/other don't count towards training load
        tss_by_day.setdefault(d, {})
        tss_by_day[d][key] = tss_by_day[d].get(key, 0.0) + float(m["hrtss"])

    series = build_series(first, today, tss_by_day)
    ctl_by_day = {s.date: s.ctl for s in series}

    # Trend inputs: VO2 max per day; EF per outdoor, non-hilly run day.
    vo2_by_day = {
        date.fromisoformat(w["date"]): float(w["vo2max"]) for w in wellness if w.get("vo2max")
    }
    ef_by_day: dict[date, float] = {}
    for a in activities:
        m = metrics_by_id.get(int(a["id"]))
        if (
            a.get("sport") == "run"
            and not a.get("indoor")
            and m
            and m.get("ef")
            and not m.get("hilly")
        ):
            ef_by_day[date.fromisoformat(str(a["start_local"])[:10])] = float(m["ef"])

    wellness_by_day = {date.fromisoformat(w["date"]): w for w in wellness}
    goals = config.get("goals") or {}
    a_race_dates = [
        date.fromisoformat(r["date"])
        for r in goals.get("races", [])
        if r.get("date") and r.get("priority") == "A"
    ]
    template = config.get("weekly_template") or {}

    rows = []
    for s in series:
        status = classify_status(
            s,
            ctl_by_day.get(s.date - timedelta(days=28)),
            trend(vo2_by_day, s.date, tol=0.005),
            trend(ef_by_day, s.date, tol=0.02),
        )
        r = compute_readiness(s.date, wellness_by_day, s.tsb if not s.warming_up else None)
        parts = dict(r.parts)
        if r.band:
            upcoming = [d for d in a_race_dates if d >= s.date]
            days_to = (min(upcoming) - s.date).days if upcoming else None
            parts["verdict"] = verdict_sentence(
                r.band,
                parts,
                sessions_today=template.get(s.date.strftime("%a").lower(), []),
                days_to_a_race=days_to,
            )
            parts["band"] = r.band
        rows.append(
            {
                "date": s.date.isoformat(),
                "tss_total": s.tss_total,
                "tss_run": s.tss_run,
                "tss_ride": s.tss_ride,
                "tss_strength": s.tss_strength,
                "ctl": s.ctl,
                "atl": s.atl,
                "tsb": s.tsb,
                "acwr": s.acwr,
                "ramp_7d": s.ramp_7d,
                "psycho_status": status,
                "readiness": r.score,
                "readiness_parts": parts,
                "warming_up": s.warming_up,
            }
        )
    return rows


def recompute(store, from_date: date, *, force: bool = False) -> dict[str, int]:
    """DB-facing entry point used by the loops and by `python -m psycho_worker metrics`."""
    today = datetime.now(TZ).date()
    config = store.athlete_config()
    recent = store.recent_rhr(today - timedelta(days=7), today)
    c = derive_constants(config, recent)
    log.info("constants", hr_max=c.hr_max, hr_rest=c.hr_rest, lthr=c.lthr, z2_band=list(c.z2_band))

    activities = store.activities_since(date(2000, 1, 1))
    existing = store.activity_metrics_all()
    computed = 0
    for a in activities:
        aid = int(a["id"])
        a_day = date.fromisoformat(str(a["start_local"])[:10])
        m = existing.get(aid)
        if a_day < from_date and not force:
            continue  # older activities are the nightly/backfill catch-up's job, not sync's
        stale = m is None or force or str(m.get("computed_at")) < str(a.get("synced_at"))
        if not stale:
            continue
        streams = store.streams(aid)
        row = activity_metrics_row(a, streams, c)
        store.upsert_activity_metrics(row)
        existing[aid] = row
        computed += 1

    wellness = store.wellness_since(date(2000, 1, 1))
    rows = build_daily_load(
        activities=activities, metrics_by_id=existing, wellness=wellness, config=config, today=today
    )
    written = store.upsert_daily_load(rows)
    log.info("metrics recomputed", activities=computed, load_days=written)
    return {"activity_metrics": computed, "load_days": written}
