"""Mappers against the Phase 0 fixtures: real field names, idempotent output."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from psycho_worker.fitparse import parse_fit
from psycho_worker.mappers.activity import build_activity_row, sport_for
from psycho_worker.mappers.wellness import build_wellness_rows

ROOT = Path(__file__).resolve().parents[3]
F = ROOT / "fixtures" / "official"
U = ROOT / "fixtures" / "unofficial"
if not F.is_dir():  # the public copy ships without the owner's Garmin data
    pytest.skip("fixtures/official not present", allow_module_level=True)


def _load(p: Path):
    return json.loads(p.read_text())


def test_wellness_rows_from_fixtures():
    dates = [date(2026, 11, 10) + (date(2026, 11, 10) - date(2026, 11, 10)) for _ in range(1)]
    dates = [date(2026, 11, 10 + i) for i in range(7)]
    rows = build_wellness_rows(
        dates=dates,
        daily_summaries=_load(F / "get_daily_summaries.json"),
        sleep_summaries=_load(F / "get_daily_sleep_summaries.json"),
        hrv_summaries=_load(F / "get_daily_hrv_summaries.json"),
        body_battery=_load(F / "get_daily_body_battery.json"),
        steps=_load(F / "get_daily_steps.json"),
    )
    assert 5 <= len(rows) <= 7
    r = {x["date"]: x for x in rows}["2026-11-10"]
    assert r["rhr"] == 52
    assert r["hrv_night_avg"] == 65 and r["hrv_7d_avg"] == 68 and r["hrv_status"] == "BALANCED"
    assert r["hrv_baseline_low"] == 65 and r["hrv_baseline_high"] == 93
    assert r["sleep_score"] == 74 and r["sleep_s"] == 24300
    assert r["deep_s"] is not None and r["rem_s"] is not None
    assert (
        r["bb_high"] == 71 and r["bb_low"] == 5 and r["bb_charged"] == 68 and r["bb_drained"] == 65
    )
    assert r["bb_wake"] is not None and 0 <= r["bb_wake"] <= 100
    assert r["stress_avg"] == 25 and r["respiration_avg"] == 15
    assert r["steps"] == 20380
    assert r["spo2_avg"] is None
    json.dumps(rows)
    # Idempotent: same input, same output.
    again = build_wellness_rows(
        dates=dates,
        daily_summaries=_load(F / "get_daily_summaries.json"),
        sleep_summaries=_load(F / "get_daily_sleep_summaries.json"),
        hrv_summaries=_load(F / "get_daily_hrv_summaries.json"),
        body_battery=_load(F / "get_daily_body_battery.json"),
        steps=_load(F / "get_daily_steps.json"),
    )
    assert again == rows


def test_sport_mapping():
    assert sport_for("running") == "run"
    assert sport_for("treadmill_running") == "run"
    assert sport_for("indoor_cycling") == "ride"
    assert sport_for("strength_training") == "strength"
    assert sport_for("walking") == "walk"
    assert sport_for("scuba") == "other"


def test_activity_row_run_from_fixtures():
    search = _load(F / "search_activities.json")
    summary = next(a for a in search if a["activityId"] == 25086182199)
    detail = _load(F / "get_activity_25086182199.json")
    workouts = _load(F / "get_activity_workouts_25086182199.json")
    fit = parse_fit((ROOT / "fixtures" / "fit" / "running_25086182199.fit").read_bytes())
    by_date = {a["activityId"]: a for a in _load(U / "get_activities_by_date.json")}
    uo = {
        "by_date": by_date[25086182199],
        "typed_splits": _load(U / "get_activity_typed_splits_25086182199.json"),
        "hr_zones": _load(U / "get_activity_hr_in_timezones_25086182199.json"),
        "weather": _load(U / "get_activity_weather_25086182199.json"),
    }
    row = build_activity_row(
        summary=summary,
        detail=detail,
        workouts=workouts,
        fit=fit,
        fit_path="fit/25086182199.fit",
        unofficial=uo,
    )
    assert row["id"] == 25086182199
    assert row["sport"] == "run" and row["garmin_type"] == "running"
    assert row["start_utc"] == "2026-11-15T09:47:08+00:00"
    assert row["start_local"] == "2026-11-15T17:47:08"
    assert 17900 < row["distance_m"] < 18100
    assert row["duration_s"] and row["avg_hr"] == 157 and row["max_hr"] == 191
    assert row["aerobic_te"] == 3.8 and row["anaerobic_te"] == 0.0
    assert row["te_label"] == "LACTATE_THRESHOLD"
    assert row["vo2max"] == 50.0
    assert row["has_gps"] is True and row["indoor"] is False
    assert row["has_workout"] is bool(workouts)
    assert row["avg_power"] == 243
    assert row["weather"]["temp_c"] is not None and row["weather"]["desc"]
    assert "ownerFullName" not in row["raw_official"]["summary"]
    assert len(row["raw_unofficial"]["hr_zones"]) == 5
    json.dumps(row)


def test_activity_row_strength_from_fixtures():
    search = _load(F / "search_activities.json")
    summary = next(a for a in search if a["activityId"] == 25095407714)
    fit = parse_fit((ROOT / "fixtures" / "fit" / "strength_training_25095407714.fit").read_bytes())
    row = build_activity_row(
        summary=summary,
        fit=fit,
        unofficial={"exercise_sets": _load(U / "get_activity_exercise_sets_25095407714.json")},
    )
    assert row["sport"] == "strength" and row["indoor"] is True and row["has_gps"] is False
    assert row["aerobic_te"] == 0.8 and row["anaerobic_te"] == 0.4
    assert row["raw_unofficial"]["exercise_sets"]
    json.dumps(row)


def test_wellness_negative_sentinels_become_none():
    # Garmin reports stress avgLevel -1/-2 when there isn't enough data.
    rows = build_wellness_rows(
        dates=[date(2026, 11, 1)],
        daily_summaries={
            "data": [
                {
                    "calendarDate": "2026-11-01",
                    "heartRate": {"restingValue": 51},
                    "stress": {"avgLevel": -2},
                }
            ]
        },
    )
    assert rows[0]["stress_avg"] is None
    assert rows[0]["rhr"] == 51
