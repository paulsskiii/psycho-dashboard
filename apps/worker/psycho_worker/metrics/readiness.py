"""Readiness 0–100 (spec §8.5) and the rule-based verdict sentence (§8.7)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from statistics import mean, pstdev
from typing import Any

WEIGHTS = {"hrv": 0.30, "rhr": 0.20, "sleep": 0.20, "bb_wake": 0.15, "tsb": 0.15}
DIRECTION = {"hrv": 1, "rhr": -1, "sleep": 1, "bb_wake": 1, "tsb": 1}
MIN_HISTORY_DAYS = 14
MIN_INPUTS = 3
MIN_BASELINE_SAMPLES = 7
WINDOW_DAYS = 28


@dataclass
class Readiness:
    score: int | None
    band: str | None
    parts: dict[str, Any]


def band_for(score: int) -> str:
    if score >= 70:
        return "primed"
    if score >= 50:
        return "steady"
    if score >= 35:
        return "hold_back"
    return "recover"


def _z(value: float, history: list[float]) -> tuple[float, float, float] | None:
    if len(history) < MIN_BASELINE_SAMPLES:
        return None
    mu = mean(history)
    sd = pstdev(history)
    if sd <= 0:
        return None
    return max(-2.0, min(2.0, (value - mu) / sd)), mu, sd


def compute_readiness(
    day: date,
    wellness_by_day: dict[date, dict[str, Any]],
    tsb: float | None,
) -> Readiness:
    """z-score each input against its own trailing 28 days (excluding today), clipped ±2."""
    today = wellness_by_day.get(day) or {}
    history_days = [d for d in wellness_by_day if day - timedelta(days=WINDOW_DAYS) <= d < day]
    if len(history_days) < MIN_HISTORY_DAYS:
        return Readiness(None, None, {"reason": "warming_up", "history_days": len(history_days)})

    def hist(key: str, alt: str | None = None) -> list[float]:
        out = []
        for d in history_days:
            r = wellness_by_day[d]
            v = r.get(key)
            if v is None and alt:
                v = r.get(alt)
            if isinstance(v, (int, float)):
                out.append(float(v))
        return out

    parts: dict[str, Any] = {}
    zs: dict[str, float] = {}

    inputs = {
        "hrv": (today.get("hrv_night_avg"), hist("hrv_night_avg")),
        "rhr": (today.get("rhr"), hist("rhr")),
        "sleep": (
            today.get("sleep_score")
            if today.get("sleep_score") is not None
            else today.get("sleep_s"),
            hist("sleep_score") if today.get("sleep_score") is not None else hist("sleep_s"),
        ),
        "bb_wake": (today.get("bb_wake"), hist("bb_wake")),
    }
    for key, (value, history) in inputs.items():
        if not isinstance(value, (int, float)):
            continue
        zr = _z(float(value), history)
        if zr is None:
            continue
        z, mu, sd = zr
        zs[key] = z * DIRECTION[key]
        parts[key] = {
            "value": value,
            "mean": round(mu, 1),
            "sd": round(sd, 1),
            "z": round(z, 2),
            "pct_vs_normal": round((value - mu) / mu * 100, 1) if mu else None,
        }
    if tsb is not None:
        zs["tsb"] = max(-2.0, min(2.0, tsb / 10.0))
        parts["tsb"] = {"value": round(tsb, 1), "z": round(zs["tsb"], 2)}

    if len(zs) < MIN_INPUTS:
        return Readiness(None, None, {"reason": "too_few_inputs", "inputs": sorted(zs)} | parts)

    total_w = sum(WEIGHTS[k] for k in zs)
    weighted = sum(WEIGHTS[k] / total_w * z for k, z in zs.items())
    score = int(round(max(0.0, min(100.0, 50 + 25 * weighted))))
    for k in zs:
        parts[k]["weight"] = round(WEIGHTS[k] / total_w, 3)
    parts["weighted_z"] = round(weighted, 3)
    return Readiness(score, band_for(score), parts)


# -- verdict (§8.7) -------------------------------------------------------------------------------

BAND_LABEL = {
    "primed": "Primed",
    "steady": "Steady",
    "hold_back": "Hold back",
    "recover": "Recover",
}

SUGGESTION: dict[tuple[str, str], str] = {
    ("primed", "intervals"): "Good day for the intervals.",
    ("primed", "tempo"): "Good day for the tempo.",
    ("primed", "easy_run"): "Easy run as planned; keep it easy.",
    ("primed", "long_run_or_rest"): "Good day for the long run.",
    ("primed", "gym_upper"): "Lift as planned.",
    ("primed", "gym_legs"): "Lift as planned.",
    ("primed", "prehab"): "Prehab as planned.",
    ("steady", "intervals"): "Intervals are fine; stop a rep early if it fades.",
    ("steady", "tempo"): "Tempo is fine; hold the easier end of the pace.",
    ("steady", "easy_run"): "Easy run as planned.",
    ("steady", "long_run_or_rest"): "Long run is fine; keep it conversational.",
    ("steady", "gym_upper"): "Lift as planned.",
    ("steady", "gym_legs"): "Lift as planned, a little lighter on legs.",
    ("steady", "prehab"): "Prehab as planned.",
    ("hold_back", "intervals"): "Swap the intervals for an easy run.",
    ("hold_back", "tempo"): "Swap the tempo for an easy run.",
    ("hold_back", "easy_run"): "Keep the run short and easy.",
    ("hold_back", "long_run_or_rest"): "Shorten the long run or rest.",
    ("hold_back", "gym_upper"): "Lift lighter today.",
    ("hold_back", "gym_legs"): "Skip heavy legs; go light or upper only.",
    ("hold_back", "prehab"): "Prehab only; no extra.",
    ("recover", "intervals"): "Rest day; skip the intervals.",
    ("recover", "tempo"): "Rest day; skip the tempo.",
    ("recover", "easy_run"): "Rest, or a 20-minute walk.",
    ("recover", "long_run_or_rest"): "Rest today.",
    ("recover", "gym_upper"): "Rest; move the lift to tomorrow.",
    ("recover", "gym_legs"): "Rest; move the lift to tomorrow.",
    ("recover", "prehab"): "Gentle prehab only.",
}
NO_SESSION = {
    "primed": "Nothing planned; a good day to train.",
    "steady": "Nothing planned; train as you feel.",
    "hold_back": "Nothing planned; keep it light if you train.",
    "recover": "Nothing planned; rest.",
}
TAPER = {
    "primed": "Race week: stay sharp, keep it short.",
    "steady": "Race week: short and easy only.",
    "hold_back": "Race week: rest beats one more session.",
    "recover": "Race week: rest.",
}


def verdict_sentence(
    band: str | None,
    parts: dict[str, Any],
    *,
    sessions_today: list[str],
    days_to_a_race: int | None,
) -> str | None:
    if band is None:
        return None
    hrv = parts.get("hrv", {}).get("pct_vs_normal")
    sleep_s = parts.get("sleep", {}).get("value")
    bits = [BAND_LABEL[band] + "."]
    if hrv is not None:
        if abs(hrv) < 3:
            bits.append("HRV at your normal")
        else:
            bits.append(f"HRV {abs(hrv):.0f} % {'above' if hrv > 0 else 'below'} your normal")
    sleep_phrase = None
    if isinstance(sleep_s, (int, float)):
        # sleep part holds the score when available; fall back to duration phrasing when it's seconds.
        if sleep_s > 100:
            h, m = divmod(int(sleep_s) // 60, 60)
            sleep_phrase = f"slept {h} h {m:02d}"
        else:
            sleep_phrase = f"sleep score {int(sleep_s)}"
    if sleep_phrase:
        bits[-1] = bits[-1] + ", " + sleep_phrase if len(bits) > 1 else sleep_phrase
    sentence = bits[0] + (" " + bits[1] + "." if len(bits) > 1 else "")
    if days_to_a_race is not None and 0 <= days_to_a_race <= 7:
        return sentence + " " + TAPER[band]
    for s in sessions_today:
        key = (band, s)
        if key in SUGGESTION:
            return sentence + " " + SUGGESTION[key]
    return sentence + " " + NO_SESSION[band]
