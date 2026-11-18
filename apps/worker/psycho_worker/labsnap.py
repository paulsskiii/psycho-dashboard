"""Export a real-data snapshot for the web app's hidden /lab route (dev only).

Writes ``apps/web/.lab/snapshot.json`` (gitignored). Reads with the service role on Paul's Mac
so the web app never needs a privileged key and /lab screenshots don't depend on an OTP login.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .config import REPO_DIR, TIMEZONE
from .db import Store

OUT = REPO_DIR / "apps" / "web" / ".lab" / "snapshot.json"


def export(store: Store, days: int = 180) -> dict:
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    since = (today - timedelta(days=days)).isoformat()
    c = store.c

    load = (
        c.table("daily_load")
        .select(
            "date, tss_total, tss_run, tss_ride, tss_strength, ctl, atl, tsb, acwr, ramp_7d, psycho_status, readiness, readiness_parts, warming_up"
        )
        .gte("date", since)
        .order("date")
        .execute()
        .data
    )
    wellness = (
        c.table("daily_wellness")
        .select(
            "date, rhr, hrv_night_avg, hrv_7d_avg, hrv_baseline_low, hrv_baseline_high, hrv_status, sleep_score, sleep_s, deep_s, light_s, rem_s, awake_s, bb_wake, bb_high, bb_low, stress_avg, respiration_avg, steps, vo2max"
        )
        .gte("date", since)
        .order("date")
        .execute()
        .data
    )
    activities = (
        c.table("activities")
        .select(
            "id, start_local, sport, garmin_type, name, duration_s, distance_m, avg_hr, avg_speed_mps, aerobic_te, anaerobic_te, te_label, indoor, has_gps"
        )
        .gte("start_local", since)
        .order("start_local")
        .execute()
        .data
    )
    ids = [a["id"] for a in activities]
    metrics = []
    for i in range(0, len(ids), 200):
        metrics += (
            c.table("activity_metrics")
            .select(
                "activity_id, hrtss, hrtss_estimated, zone_s, low_pct, mod_pct, high_pct, ef, decoupling_pct, pace_at_hr_s_per_km, steady, drifted_hard, hilly"
            )
            .in_("activity_id", ids[i : i + 200])
            .execute()
            .data
        )
    runs = [a for a in activities if a["sport"] == "run" and a.get("has_gps")]
    latest = runs[-1] if runs else (activities[-1] if activities else None)
    detail = None
    if latest:
        s = (
            c.table("activity_streams")
            .select("chart")
            .eq("activity_id", latest["id"])
            .execute()
            .data
        )
        laps = (
            c.table("activity_laps")
            .select(
                "idx, kind, duration_s, distance_m, avg_hr, avg_speed_mps, avg_cadence, elev_gain_m"
            )
            .eq("activity_id", latest["id"])
            .eq("kind", "km")
            .order("idx")
            .execute()
            .data
        )
        detail = {"activity": latest, "chart": s[0]["chart"] if s else None, "km": laps}
    preds = c.table("race_predictions").select("*").gte("date", since).order("date").execute().data
    config = (
        c.table("athlete_config")
        .select("goals, weekly_template, hr_zones, max_hr, lthr")
        .eq("id", 1)
        .single()
        .execute()
        .data
    )
    return {
        "generated_at": datetime.now(ZoneInfo(TIMEZONE)).isoformat(),
        "today": today.isoformat(),
        "daily_load": load,
        "wellness": wellness,
        "activities": activities,
        "metrics": metrics,
        "latest_run": detail,
        "race_predictions": preds,
        "config": config,
    }


def write(store: Store) -> str:
    data = export(store)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, default=str))
    return f"{OUT} ({OUT.stat().st_size // 1024} KB, {len(data['daily_load'])} load days, {len(data['activities'])} activities)"


__all__ = ["export", "write", "date"]
