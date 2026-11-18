"""Metrics engine tests (spec §8.8)."""

from __future__ import annotations

import json
import math
from datetime import date, timedelta
from pathlib import Path

import pytest

from psycho_worker.fitparse import parse_fit
from psycho_worker.metrics.constants import Constants, derive_constants
from psycho_worker.metrics.efficiency import (
    decoupling_pct,
    efficiency_factor,
    is_hilly,
    is_steady,
    pace_at_hr,
)
from psycho_worker.metrics.engine import activity_metrics_row, build_daily_load
from psycho_worker.metrics.fitness import build_series, classify_status, trend
from psycho_worker.metrics.load import (
    estimated_hrtss,
    three_zone_pct,
    time_in_zones,
    trimp_and_hrtss,
)
from psycho_worker.metrics.races import best_riegel, goal_gap, riegel
from psycho_worker.metrics.readiness import compute_readiness, verdict_sentence

ROOT = Path(__file__).resolve().parents[3]
C = Constants(
    hr_max=207, hr_rest=52, lthr=186, zone_floors=(104, 124, 145, 166, 186), z2_band=(135, 144)
)


# -- 8.1 load -----------------------------------------------------------------------------------


def test_hrtss_is_100_for_one_hour_at_lthr():
    t = list(range(0, 3601))
    hr = [C.lthr] * len(t)
    trimp, hrtss = trimp_and_hrtss(t, hr, C)
    assert hrtss == pytest.approx(100.0, abs=0.5)
    hrr = (C.lthr - C.hr_rest) / (C.hr_max - C.hr_rest)
    assert trimp == pytest.approx(60 * hrr * 0.64 * math.exp(1.92 * hrr), rel=1e-3)


def test_hrtss_gap_rule_skips_long_gaps():
    t = list(range(0, 1800)) + list(range(3600, 5400))  # 30-min hole
    hr = [C.lthr] * len(t)
    _, hrtss = trimp_and_hrtss(t, hr, C)
    assert hrtss == pytest.approx(100.0, abs=1.0)  # 60 min of actual samples, not 90


def test_no_hr_estimate():
    assert estimated_hrtss(3600) == 36.0
    assert estimated_hrtss(None) == 0.0


def test_zones_and_three_zone_model():
    t = list(range(0, 600))
    hr = [110] * 200 + [150] * 200 + [190] * 200
    z = time_in_zones(t, hr, C)
    assert (
        z[0] == pytest.approx(200, abs=2)
        and z[2] == pytest.approx(200, abs=2)
        and z[4] == pytest.approx(200, abs=2)
    )
    low, mod, high = three_zone_pct(z)
    assert (
        low == pytest.approx(33.3, abs=0.5)
        and mod == pytest.approx(33.3, abs=0.5)
        and high == pytest.approx(33.3, abs=0.5)
    )


# -- 8.2 / 8.3 fitness ----------------------------------------------------------------------------


def test_ctl_atl_tsb_match_reference_fixture():
    ref = json.loads((ROOT / "fixtures" / "metrics" / "ctl_atl_reference.json").read_text())
    start = date(2026, 1, 1)
    tss_by_day = {start + timedelta(days=r["day"]): {"run": r["tss"]} for r in ref["rows"]}
    series = build_series(start, start + timedelta(days=99), tss_by_day)
    assert len(series) == 100
    for s, r in zip(series, ref["rows"], strict=True):
        assert s.ctl == pytest.approx(r["ctl"], abs=0.01)
        assert s.atl == pytest.approx(r["atl"], abs=0.01)
        assert s.tsb == pytest.approx(r["tsb"], abs=0.01)
    assert all(s.warming_up for s in series[:42]) and not any(s.warming_up for s in series[42:])
    assert series[7].ramp_7d is not None and series[6].ramp_7d is None


def test_acwr_null_until_chronic_builds():
    start = date(2026, 1, 1)
    series = build_series(
        start,
        start + timedelta(days=60),
        {start + timedelta(days=i): {"run": 50.0} for i in range(61)},
    )
    assert series[0].acwr is None
    assert series[-1].acwr == pytest.approx(1.0, abs=0.05)


def test_status_rules_first_match_wins():
    from psycho_worker.metrics.fitness import DayLoad

    d = DayLoad(
        date(2026, 1, 1), 0, 0, 0, 0, ctl=40, atl=50, tsb=-5, acwr=1.6, ramp_7d=2, warming_up=False
    )
    assert classify_status(d, 40, "rising", "rising") == "overreaching"
    d.acwr = 1.0
    assert classify_status(d, 60, "rising", "rising") == "detraining"  # 40 < 0.85*60
    assert classify_status(d, 40, "flat", "falling") == "productive"
    assert classify_status(d, 40, "falling", "falling") == "unproductive"
    d.ramp_7d = -1
    d.tsb = 12
    assert classify_status(d, 40, "flat", "flat") == "recovering"
    d.tsb = 0
    assert classify_status(d, 40, "flat", "flat") == "maintaining"


def test_trend():
    day = date(2026, 3, 1)
    rising = {day - timedelta(days=i): 50 + (28 - i) * 0.1 for i in range(28)}
    assert trend(rising, day, tol=0.005) == "rising"
    assert trend({day - timedelta(days=i): 50.0 for i in range(28)}, day, tol=0.005) == "flat"
    assert trend({day: 1.0}, day) == "unknown"


# -- 8.5 readiness --------------------------------------------------------------------------------


def _wellness(days: int = 30, **today):
    base = date(2026, 3, 1)
    out = {}
    for i in range(1, days + 1):
        d = base - timedelta(days=i)
        out[d] = {
            "hrv_night_avg": 65 + (i % 5) - 2,
            "rhr": 52 + (i % 3) - 1,
            "sleep_score": 75 + (i % 7) - 3,
            "bb_wake": 70 + (i % 9) - 4,
        }
    out[base] = today
    return base, out


def test_readiness_renormalises_when_inputs_missing():
    day, w = _wellness(hrv_night_avg=75, rhr=49, sleep_score=90, bb_wake=85)
    full = compute_readiness(day, w, tsb=5.0)
    assert full.score is not None and full.score > 60 and full.band in ("primed", "steady")
    assert (
        abs(
            sum(p["weight"] for k, p in full.parts.items() if isinstance(p, dict) and "weight" in p)
            - 1.0
        )
        < 5e-3
    )

    day, w = _wellness(hrv_night_avg=75, rhr=49)  # sleep + bb missing
    partial = compute_readiness(day, w, tsb=5.0)
    assert partial.score is not None
    weights = {
        k: p["weight"] for k, p in partial.parts.items() if isinstance(p, dict) and "weight" in p
    }
    assert set(weights) == {"hrv", "rhr", "tsb"}
    assert abs(sum(weights.values()) - 1.0) < 5e-3  # weights are stored rounded to 3 dp
    assert weights["hrv"] == pytest.approx(0.30 / 0.65, abs=1e-3)

    day, w = _wellness(hrv_night_avg=75)  # only 1 input + tsb → below the 3-input floor
    assert compute_readiness(day, w, tsb=None).score is None


def test_readiness_needs_14_days_history():
    day, w = _wellness(days=10, hrv_night_avg=75, rhr=49, sleep_score=90, bb_wake=85)
    r = compute_readiness(day, w, tsb=0.0)
    assert r.score is None and r.parts["reason"] == "warming_up"


def test_readiness_uses_sleep_duration_when_score_missing():
    day, w = _wellness(hrv_night_avg=65, rhr=52, sleep_s=7 * 3600, bb_wake=70)
    for d in w:
        if d != day:
            w[d]["sleep_s"] = 6 * 3600 + (hash(d) % 1800)
            w[d].pop("sleep_score", None)
    r = compute_readiness(day, w, tsb=0.0)
    assert r.score is not None and "sleep" in r.parts


def test_verdict_phrases():
    parts = {"hrv": {"pct_vs_normal": 12.0}, "sleep": {"value": 7 * 3600 + 40 * 60}}
    s = verdict_sentence("primed", parts, sessions_today=["tempo", "prehab"], days_to_a_race=27)
    assert s == "Primed. HRV 12 % above your normal, slept 7 h 40. Good day for the tempo."
    s = verdict_sentence(
        "hold_back",
        {"hrv": {"pct_vs_normal": -9.0}},
        sessions_today=["intervals"],
        days_to_a_race=None,
    )
    assert s.endswith("Swap the intervals for an easy run.")
    s = verdict_sentence("steady", {}, sessions_today=["tempo"], days_to_a_race=3)
    assert s.startswith("Steady.") and "Race week" in s
    assert verdict_sentence("recover", {}, sessions_today=[], days_to_a_race=None).endswith("rest.")
    assert verdict_sentence(None, {}, sessions_today=[], days_to_a_race=None) is None


# -- 8.6 efficiency -------------------------------------------------------------------------------


def _synthetic_run(minutes: int = 60, drift_pct: float = 0.0, speed: float = 3.0):
    t = list(range(0, minutes * 60))
    hr, sp = [], []
    for s in t:
        frac = max(0.0, (s - 600) / max(1, (minutes * 60 - 600)))
        hr.append(int(round(150 * (1 + drift_pct / 100 * frac))))
        sp.append(speed)
    return t, hr, sp


def test_decoupling_on_known_drift():
    t, hr, sp = _synthetic_run(60, drift_pct=8.0)
    assert is_steady(t, sp) is True
    d = decoupling_pct(t, hr, sp)
    # HR rises linearly 0→8 % after warm-up; halves average 2 % vs 6 % → EF drop ≈ 3.8 %
    assert d == pytest.approx(3.8, abs=0.6)
    t, hr, sp = _synthetic_run(60, drift_pct=0.0)
    assert decoupling_pct(t, hr, sp) == pytest.approx(0.0, abs=0.1)
    assert efficiency_factor(t, hr, sp) == pytest.approx(3.0 * 60 / 150, rel=1e-3)


def test_steady_detects_intervals():
    t = list(range(0, 3600))
    sp = [2.5 if (s // 180) % 2 == 0 else 4.2 for s in t]  # 3-min on/off → CV ≫ 10 %
    assert is_steady(t, sp) is False


def test_hilly_and_pace_at_hr():
    assert is_hilly(200, 10000) is True and is_hilly(100, 10000) is False
    t = list(range(0, 1200))
    hr = [140] * 1200
    sp = [3.0] * 1200
    assert pace_at_hr(t, hr, sp, (135, 144)) == pytest.approx(333.3, abs=0.2)
    assert pace_at_hr(t, [120] * 1200, sp, (135, 144)) is None
    assert pace_at_hr(t[:300], hr[:300], sp[:300], (135, 144)) is None  # < 8 min in band


# -- 8.7 races ------------------------------------------------------------------------------------


def test_riegel_and_goal_gap():
    assert riegel(3364, 10000, 21097.5) == pytest.approx(3364 * (2.10975) ** 1.06, rel=1e-6)
    best = best_riegel([(3364, 10000), (1700, 5000), (1200, 3000)], 21097.5)
    assert best == pytest.approx(
        min(riegel(3364, 10000, 21097.5), riegel(1700, 5000, 21097.5)), abs=1
    )
    gap = goal_gap(7480, 7200, 21097.5)
    assert gap == {"gap_s": 280, "gap_s_per_km": 13.3}


# -- constants + real FIT through the engine -------------------------------------------------------


def test_constants_from_config():
    cfg = {
        "max_hr": 207,
        "lthr": None,
        "hr_zones": {"floors": [104, 124, 145, 166, 186], "rest_hr": 46},
    }
    c = derive_constants(cfg, [52, 51, 53, None, 52])
    assert c.hr_max == 207 and c.hr_rest == 52 and c.lthr == 186
    assert c.z2_band == (135, 144)
    c2 = derive_constants({"max_hr": 200, "hr_zones": {}}, [])
    assert c2.lthr == 178 and c2.zone_floors == (100, 120, 140, 160, 180)


@pytest.mark.skipif(
    not (ROOT / "fixtures" / "fit").is_dir(), reason="fixtures/fit not present (public copy)"
)
def test_real_run_fixture_through_engine():
    fit = parse_fit((ROOT / "fixtures" / "fit" / "running_25086182199.fit").read_bytes())
    activity = {
        "id": 25086182199,
        "sport": "run",
        "garmin_type": "running",
        "duration_s": 7322,
        "distance_m": 18007,
        "elev_gain_m": 63,
        "indoor": False,
        "has_workout": True,
    }
    row = activity_metrics_row(activity, fit["streams"], C)
    # 2-hour run at avg HR 157 (~LTHR-29): well above 100 hrTSS but below 200
    assert 110 < row["hrtss"] < 200 and row["hrtss_estimated"] is False
    assert sum(row["zone_s"]) == pytest.approx(7322, abs=120)
    assert row["ef"] is not None and 0.8 < row["ef"] < 1.2  # 2.46 m/s*60 / 157 ≈ 0.94
    assert row["hilly"] is False
    assert row["pace_at_hr_s_per_km"] is None or 300 < row["pace_at_hr_s_per_km"] < 600
    assert row["drifted_hard"] is False  # structured workout attached


def test_build_daily_load_end_to_end():
    today = date(2026, 3, 1)
    acts, metrics = [], {}
    for i in range(60):
        d = today - timedelta(days=59 - i)
        if i % 2 == 0:
            acts.append(
                {
                    "id": i,
                    "start_local": d.isoformat() + "T06:00:00",
                    "sport": "run",
                    "indoor": False,
                }
            )
            metrics[i] = {"hrtss": 60.0, "ef": 0.9 + i * 0.001, "hilly": False}
    wellness = []
    for i in range(60):
        d = today - timedelta(days=59 - i)
        wellness.append(
            {
                "date": d.isoformat(),
                "rhr": 52,
                "hrv_night_avg": 65 + (i % 4),
                "sleep_score": 75 + (i % 5),
                "bb_wake": 70,
                "vo2max": 51.5,
            }
        )
    cfg = {
        "goals": {"races": [{"date": "2026-03-05", "priority": "A"}]},
        "weekly_template": {"sun": ["long_run_or_rest"]},
    }
    rows = build_daily_load(
        activities=acts, metrics_by_id=metrics, wellness=wellness, config=cfg, today=today
    )
    assert len(rows) == 60
    last = rows[-1]
    assert (
        last["tss_run"] in (0.0, 60.0)
        and last["ctl"] > 0
        and last["psycho_status"]
        in {"productive", "maintaining", "recovering", "overreaching", "unproductive", "detraining"}
    )
    assert last["readiness"] is not None and "verdict" in last["readiness_parts"]
    assert "Race week" in last["readiness_parts"]["verdict"]
    assert rows[0]["warming_up"] and not last["warming_up"]
    json.dumps(rows)
