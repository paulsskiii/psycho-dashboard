"""Fitness / fatigue / form, ACWR, ramp and Psycho training status (spec §8.2–8.4)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta

K_CTL = 1 - math.exp(-1 / 42)
K_ATL = 1 - math.exp(-1 / 7)
LAMBDA_ACUTE = 2 / (7 + 1)
LAMBDA_CHRONIC = 2 / (28 + 1)
WARMING_UP_DAYS = 42
ACWR_MIN_CHRONIC = 5.0


@dataclass
class DayLoad:
    date: date
    tss_total: float
    tss_run: float
    tss_ride: float
    tss_strength: float
    ctl: float
    atl: float
    tsb: float
    acwr: float | None
    ramp_7d: float | None
    warming_up: bool
    status: str | None = None


def build_series(start: date, end: date, tss_by_day: dict[date, dict[str, float]]) -> list[DayLoad]:
    """Daily CTL/ATL/TSB/ACWR/ramp from ``start`` (seeded at 0) through ``end``."""
    out: list[DayLoad] = []
    ctl = atl = 0.0
    acute = chronic = 0.0
    ctl_hist: list[float] = []
    d = start
    i = 0
    while d <= end:
        by = tss_by_day.get(d, {})
        tss = float(sum(by.values()))
        tsb = ctl - atl  # form going into day d
        ctl = ctl + (tss - ctl) * K_CTL
        atl = atl + (tss - atl) * K_ATL
        acute = acute + (tss - acute) * LAMBDA_ACUTE
        chronic = chronic + (tss - chronic) * LAMBDA_CHRONIC
        ctl_hist.append(ctl)
        ramp = ctl - ctl_hist[-8] if len(ctl_hist) >= 8 else None
        acwr = acute / chronic if chronic >= ACWR_MIN_CHRONIC else None
        out.append(
            DayLoad(
                date=d,
                tss_total=round(tss, 1),
                tss_run=round(by.get("run", 0.0), 1),
                tss_ride=round(by.get("ride", 0.0), 1),
                tss_strength=round(by.get("strength", 0.0), 1),
                ctl=round(ctl, 2),
                atl=round(atl, 2),
                tsb=round(tsb, 2),
                acwr=round(acwr, 3) if acwr is not None else None,
                ramp_7d=round(ramp, 2) if ramp is not None else None,
                warming_up=i < WARMING_UP_DAYS,
            )
        )
        d += timedelta(days=1)
        i += 1
    return out


# -- status (§8.4) -------------------------------------------------------------------------------


def trend(
    values_by_day: dict[date, float], day: date, *, window: int = 28, tol: float = 0.0
) -> str:
    """'rising' | 'flat' | 'falling' | 'unknown' comparing the last 14 d mean to the prior 14 d."""
    half = window // 2
    recent = [v for d, v in values_by_day.items() if day - timedelta(days=half) < d <= day]
    prior = [
        v
        for d, v in values_by_day.items()
        if day - timedelta(days=window) < d <= day - timedelta(days=half)
    ]
    if len(recent) < 1 or len(prior) < 1:
        return "unknown"
    a, b = sum(recent) / len(recent), sum(prior) / len(prior)
    if b == 0:
        return "unknown"
    delta = (a - b) / abs(b)
    if delta < -tol:
        return "falling"
    if delta > tol:
        return "rising"
    return "flat"


def classify_status(
    day: DayLoad,
    ctl_28_ago: float | None,
    vo2_trend: str,
    ef_trend: str,
) -> str:
    """First matching rule wins (spec §8.4)."""
    if (day.acwr is not None and day.acwr > 1.5) or day.tsb < -30:
        return "overreaching"
    if ctl_28_ago and ctl_28_ago > 0 and day.ctl < 0.85 * ctl_28_ago:
        return "detraining"
    ramp_pos = day.ramp_7d is not None and day.ramp_7d > 0
    not_falling = {"flat", "rising", "unknown"}
    if ramp_pos and (vo2_trend in not_falling or ef_trend in not_falling):
        return "productive"
    if ramp_pos and vo2_trend == "falling" and ef_trend == "falling":
        return "unproductive"
    if day.tsb > 10 and (day.ramp_7d is None or day.ramp_7d <= 0):
        return "recovering"
    return "maintaining"
