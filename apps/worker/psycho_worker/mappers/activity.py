"""Garmin activity JSON + parsed FIT → ``activities`` row (+ laps, streams via fitparse)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

RUN_TYPES = {
    "running",
    "treadmill_running",
    "indoor_running",
    "trail_running",
    "track_running",
    "street_running",
    "virtual_run",
    "ultra_run",
}
RIDE_TYPES = {
    "cycling",
    "road_biking",
    "indoor_cycling",
    "virtual_ride",
    "gravel_cycling",
    "mountain_biking",
    "cyclocross",
    "e_bike_fitness",
    "bmx",
    "track_cycling",
    "commuting",
    "recumbent_cycling",
}
STRENGTH_TYPES = {
    "strength_training",
    "indoor_cardio",
    "hiit",
    "pilates",
    "yoga",
    "breathwork",
    "fitness_equipment",
    "elliptical",
    "stair_climbing",
    "indoor_rowing",
}
WALK_TYPES = {"walking", "hiking", "casual_walking", "speed_walking"}
INDOOR_TYPES = {
    "treadmill_running",
    "indoor_running",
    "indoor_cycling",
    "virtual_ride",
    "virtual_run",
    "strength_training",
    "indoor_cardio",
    "hiit",
    "pilates",
    "yoga",
    "fitness_equipment",
    "elliptical",
    "stair_climbing",
    "indoor_rowing",
}


def sport_for(type_key: str) -> str:
    if type_key in RUN_TYPES:
        return "run"
    if type_key in RIDE_TYPES:
        return "ride"
    if type_key in STRENGTH_TYPES:
        return "strength"
    if type_key in WALK_TYPES:
        return "walk"
    return "other"


def _ts_gmt(s: str | None) -> str | None:
    """'2026-11-16 09:00:42' (GMT) → ISO with Z."""
    if not s:
        return None
    return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC).isoformat()


def _ts_local(s: str | None) -> str | None:
    if not s:
        return None
    return s[:19].replace(" ", "T")


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _int(v: Any) -> int | None:
    f = _num(v)
    return int(round(f)) if f is not None else None


def build_activity_row(
    *,
    summary: dict[str, Any],
    detail: dict[str, Any] | None = None,
    workouts: Any = None,
    fit: dict[str, Any] | None = None,
    fit_path: str | None = None,
    unofficial: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """``summary`` is a search_activities item; ``detail`` is get_activity; ``fit`` is parse_fit()."""
    sd = (detail or {}).get("summaryDTO") or {}
    type_key = str((summary.get("activityType") or {}).get("typeKey") or "unknown")
    session = (fit or {}).get("session") or {}
    uo = unofficial or {}
    by_date = uo.get("by_date") or {}
    has_gps = bool((fit or {}).get("has_gps"))
    sport = sport_for(type_key)
    indoor = type_key in INDOOR_TYPES or (sport in ("run", "ride", "walk") and not has_gps)

    cadence = (
        sd.get("averageRunCadence")
        or sd.get("averageBikingCadence")
        or summary.get("averageRunningCadenceInStepsPerMinute")
        or summary.get("averageBikingCadenceInRevPerMinute")
    )
    weather = uo.get("weather")
    if isinstance(weather, dict) and weather.get("temp") is not None:
        weather = {
            "temp_c": round((weather["temp"] - 32) * 5 / 9, 1),
            "apparent_c": round((weather["apparentTemp"] - 32) * 5 / 9, 1)
            if weather.get("apparentTemp") is not None
            else None,
            "humidity_pct": weather.get("relativeHumidity"),
            "wind_kph": round(weather["windSpeed"] * 1.609, 1)
            if weather.get("windSpeed") is not None
            else None,
            "desc": (weather.get("weatherTypeDTO") or {}).get("desc"),
        }
    else:
        weather = None

    row = {
        "id": int(summary["activityId"]),
        "start_utc": _ts_gmt(summary.get("startTimeGMT") or sd.get("startTimeGMT")),
        "start_local": _ts_local(summary.get("startTimeLocal") or sd.get("startTimeLocal")),
        "sport": sport,
        "garmin_type": type_key,
        "name": summary.get("activityName"),
        "duration_s": _int(
            summary.get("duration") or sd.get("duration") or session.get("total_timer_time")
        ),
        "moving_s": _int(summary.get("movingDuration") or sd.get("movingDuration")),
        "distance_m": _num(
            summary.get("distance") or sd.get("distance") or session.get("total_distance")
        ),
        "elev_gain_m": _num(sd.get("elevationGain") or session.get("total_ascent")),
        "avg_hr": _int(
            summary.get("averageHR") or sd.get("averageHR") or session.get("avg_heart_rate")
        ),
        "max_hr": _int(summary.get("maxHR") or sd.get("maxHR") or session.get("max_heart_rate")),
        "avg_speed_mps": _num(
            summary.get("averageSpeed")
            or sd.get("averageSpeed")
            or session.get("enhanced_avg_speed")
        ),
        "avg_cadence": _num(cadence),
        "avg_power": _num(session.get("avg_power") or summary.get("avgPower")),
        "calories": _int(
            summary.get("calories") or sd.get("calories") or session.get("total_calories")
        ),
        "aerobic_te": _num(
            session.get("total_training_effect", summary.get("aerobicTrainingEffect"))
        ),
        "anaerobic_te": _num(
            session.get("total_anaerobic_training_effect", summary.get("anaerobicTrainingEffect"))
        ),
        "te_label": summary.get("trainingEffectLabel") or sd.get("trainingEffectLabel"),
        "vo2max": _num(by_date.get("vO2MaxValue")),
        "recovery_time_h": None,
        "weather": weather,
        "has_gps": has_gps,
        "indoor": indoor,
        "has_workout": bool(workouts),
        "fit_path": fit_path,
        "raw_official": {
            "summary": _strip_owner(summary),
            "detail_summary": sd or None,
            "workouts": workouts or None,
            "fit_session": session or None,
        },
        "raw_unofficial": _slim_unofficial(uo) or None,
    }
    return row


_OWNER_KEYS = {
    "ownerDisplayName",
    "ownerFullName",
    "ownerId",
    "ownerProfileImageUrlLarge",
    "ownerProfileImageUrlMedium",
    "ownerProfileImageUrlSmall",
}


def _strip_owner(d: dict) -> dict:
    return {k: v for k, v in d.items() if k not in _OWNER_KEYS}


def _slim_unofficial(uo: dict) -> dict:
    out = {}
    if uo.get("hr_zones"):
        out["hr_zones"] = uo["hr_zones"]
    if uo.get("typed_splits"):
        out["typed_splits"] = [
            {
                k: s.get(k)
                for k in (
                    "type",
                    "duration",
                    "distance",
                    "averageHR",
                    "maxHR",
                    "averageSpeed",
                    "averagePower",
                    "averageRunCadence",
                    "elevationGain",
                    "startTimeGMT",
                )
            }
            for s in (uo["typed_splits"].get("splits") or [])
        ]
    if uo.get("exercise_sets"):
        out["exercise_sets"] = [
            {
                k: s.get(k)
                for k in (
                    "exercises",
                    "duration",
                    "repetitionCount",
                    "weight",
                    "setType",
                    "startTime",
                )
            }
            for s in (uo["exercise_sets"].get("exerciseSets") or [])
        ]
    if uo.get("by_date"):
        bd = uo["by_date"]
        out["by_date"] = {
            k: bd.get(k)
            for k in ("vO2MaxValue", "hasSplits", "hasIntensityIntervals", "deviceId", "timeZoneId")
        }
    return out
