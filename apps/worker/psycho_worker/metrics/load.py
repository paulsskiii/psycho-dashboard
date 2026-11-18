"""hrTSS via Banister TRIMP (spec §8.1) and time in HR zones (§8.6)."""

from __future__ import annotations

import math

import numpy as np

from .constants import Constants

MAX_GAP_S = 10  # don't integrate across HR gaps longer than this
NO_HR_TSS_PER_MIN = 0.6


def _clean(t: list[int], hr: list[int | None]) -> tuple[np.ndarray, np.ndarray]:
    tt = np.array(t, dtype=float)
    hh = np.array([np.nan if v is None else v for v in hr], dtype=float)
    keep = ~np.isnan(hh)
    return tt[keep], hh[keep]


def _dt(tt: np.ndarray) -> np.ndarray:
    """Seconds attributed to each sample: the gap since the previous sample, capped by the gap rule."""
    if len(tt) == 0:
        return tt
    dt = np.diff(tt, prepend=tt[0])
    dt[0] = 1.0 if len(tt) > 1 else 0.0
    dt[dt > MAX_GAP_S] = 0.0
    return dt


def trimp_and_hrtss(t: list[int], hr: list[int | None], c: Constants) -> tuple[float, float]:
    """Returns (TRIMP, hrTSS). Empty HR → (0, 0)."""
    tt, hh = _clean(t, hr)
    if len(tt) < 2:
        return 0.0, 0.0
    dt = _dt(tt)
    hrr = np.clip((hh - c.hr_rest) / (c.hr_max - c.hr_rest), 0.0, 1.0)
    trimp = float(np.sum((dt / 60.0) * hrr * 0.64 * np.exp(1.92 * hrr)))
    denom = 60.0 * c.hrr_lt * 0.64 * math.exp(1.92 * c.hrr_lt)
    return trimp, 100.0 * trimp / denom


def estimated_hrtss(duration_s: int | None) -> float:
    return round(((duration_s or 0) / 60.0) * NO_HR_TSS_PER_MIN, 1)


def zone_of(hr: float, floors: tuple[int, ...]) -> int:
    """1-based Garmin zone. Below the zone-1 floor counts as zone 1."""
    z = 1
    for i, f in enumerate(floors, start=1):
        if hr >= f:
            z = i
    return z


def time_in_zones(t: list[int], hr: list[int | None], c: Constants) -> list[int]:
    """Seconds in Garmin zones 1..5, using the same gap rule as TRIMP."""
    tt, hh = _clean(t, hr)
    out = [0.0] * 5
    if len(tt) < 2:
        return [0] * 5
    dt = _dt(tt)
    for v, d in zip(hh, dt, strict=True):
        out[zone_of(v, c.zone_floors) - 1] += d
    return [int(round(x)) for x in out]


def three_zone_pct(zone_s: list[int]) -> tuple[float, float, float]:
    """low = Z1+Z2, moderate = Z3, high = Z4+Z5, as percentages of time with HR."""
    total = sum(zone_s)
    if total <= 0:
        return 0.0, 0.0, 0.0
    low = (zone_s[0] + zone_s[1]) / total * 100
    mod = zone_s[2] / total * 100
    high = (zone_s[3] + zone_s[4]) / total * 100
    return round(low, 1), round(mod, 1), round(high, 1)
