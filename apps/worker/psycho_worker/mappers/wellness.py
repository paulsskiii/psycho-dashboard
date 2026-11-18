"""Official daily endpoints → ``daily_wellness`` rows.

Field names verified on Paul's account (Phase 0 fixtures):
  daily summaries item: heartRate.restingValue, stress.avgLevel, bodyBattery.{min,max,charged,drained}Value,
                        respiration.avgValue
  sleep summaries item: sleepScores.overall.value, sleepTimeSeconds, deep/light/rem/awakeSleepSeconds,
                        sleepEndTimestampGMT (ms)
  hrv summaries item:   lastNightAvg, weeklyAvg, baseline.balancedLow/balancedUpper, status
  body battery item:    date, bodyBatteryValuesArray [[ts_ms, level], ...]
  steps item:           calendarDate, totalSteps
  spo2 (per day):       averageSpO2 (null when Pulse Ox is off)
"""

from __future__ import annotations

from datetime import date
from typing import Any

Row = dict[str, Any]


def _by_date(items: Any, key: str = "calendarDate") -> dict[str, dict]:
    if isinstance(items, dict):
        items = items.get("data") or items.get("hrvSummaries") or []
    out: dict[str, dict] = {}
    for it in items or []:
        if isinstance(it, dict) and it.get(key):
            out[str(it[key])] = it
    return out


def build_wellness_rows(
    *,
    dates: list[date],
    daily_summaries: Any = None,
    sleep_summaries: Any = None,
    hrv_summaries: Any = None,
    body_battery: Any = None,
    steps: Any = None,
    spo2_by_date: dict[str, Any] | None = None,
) -> list[Row]:
    ds = _by_date(daily_summaries)
    sl = _by_date(sleep_summaries)
    hv = _by_date(hrv_summaries)
    bb = _by_date(body_battery, key="date")
    st = _by_date(steps)
    spo2_by_date = spo2_by_date or {}

    rows: list[Row] = []
    for d in dates:
        k = d.isoformat()
        s = ds.get(k) or {}
        sleep = sl.get(k) or {}
        hrv = hv.get(k) or {}
        bat = bb.get(k) or {}
        stp = st.get(k) or {}
        spo2 = spo2_by_date.get(k) or {}

        hr_block = s.get("heartRate") or {}
        stress_block = s.get("stress") or {}
        bb_block = s.get("bodyBattery") or {}
        resp_block = s.get("respiration") or {}
        scores = sleep.get("sleepScores") or {}

        row: Row = {
            "date": k,
            "rhr": hr_block.get("restingValue"),
            "hrv_night_avg": hrv.get("lastNightAvg"),
            "hrv_7d_avg": hrv.get("weeklyAvg"),
            "hrv_baseline_low": (hrv.get("baseline") or {}).get("balancedLow"),
            "hrv_baseline_high": (hrv.get("baseline") or {}).get("balancedUpper"),
            "hrv_status": hrv.get("status"),
            "sleep_score": (scores.get("overall") or {}).get("value"),
            "sleep_s": sleep.get("sleepTimeSeconds"),
            "deep_s": sleep.get("deepSleepSeconds"),
            "light_s": sleep.get("lightSleepSeconds"),
            "rem_s": sleep.get("remSleepSeconds"),
            "awake_s": sleep.get("awakeSleepSeconds"),
            "bb_wake": _bb_at_wake(bat, sleep),
            "bb_high": bb_block.get("maxValue"),
            "bb_low": bb_block.get("minValue"),
            "bb_charged": bb_block.get("chargedValue", bat.get("charged")),
            "bb_drained": bb_block.get("drainedValue", bat.get("drained")),
            "stress_avg": stress_block.get("avgLevel"),
            "respiration_avg": resp_block.get("avgValue"),
            "spo2_avg": spo2.get("averageSpO2"),
            "steps": stp.get("totalSteps"),
            "raw": {
                "summary": _slim(s),
                "sleep": _slim(sleep),
                "hrv": hrv or None,
                "bb": {"charged": bat.get("charged"), "drained": bat.get("drained")}
                if bat
                else None,
            },
        }
        _clean_sentinels(row)
        # Skip days Garmin has nothing for (keeps backfill idempotent and the table honest).
        if all(row[k2] is None for k2 in row if k2 not in ("date", "raw")):
            continue
        rows.append(row)
    return rows


def _clean_sentinels(row: Row) -> Row:
    """Garmin writes -1 / -2 for "not enough data" (seen on stress). No wellness value Psycho
    stores can be negative, so any negative number becomes None."""
    for k, v in row.items():
        if (
            k not in ("date", "raw")
            and isinstance(v, (int, float))
            and not isinstance(v, bool)
            and v < 0
        ):
            row[k] = None
    return row


def _bb_at_wake(bat: dict, sleep: dict) -> int | None:
    """Body Battery level at sleep end (nearest sample at or after wake), else first of day."""
    values = bat.get("bodyBatteryValuesArray") or []
    pts = [(v[0], v[1]) for v in values if isinstance(v, list) and len(v) >= 2 and v[1] is not None]
    if not pts:
        return None
    wake_ms = sleep.get("sleepEndTimestampGMT")
    if isinstance(wake_ms, (int, float)):
        after = [lvl for ts, lvl in pts if ts >= wake_ms]
        if after:
            return int(after[0])
    return int(pts[0][1])


_DROP = {
    "wellnessChronology",
    "bodyBatteryValuesArray",
    "sleepScoreInsight",
    "sleepScorePersonalizedInsight",
}


def _slim(d: dict) -> dict | None:
    if not d:
        return None
    return {k: v for k, v in d.items() if k not in _DROP and not isinstance(v, list)}
