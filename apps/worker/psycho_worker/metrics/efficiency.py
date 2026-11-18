"""Efficiency factor, aerobic decoupling, steadiness, pace at fixed HR (spec §8.6)."""

from __future__ import annotations

import numpy as np

WARMUP_S = 10 * 60
MIN_EF_DURATION_S = 30 * 60
MIN_DECOUPLING_DURATION_S = 45 * 60
MOVING_SPEED_MPS = 0.5
STEADY_CV_MAX = 0.10
HILLY_M_PER_KM = 15.0
MIN_BAND_S = 8 * 60


def _arrays(t, hr, speed):
    tt = np.array(t, dtype=float)
    hh = np.array([np.nan if v is None else v for v in hr], dtype=float)
    ss = np.array([np.nan if v is None else v for v in speed], dtype=float)
    return tt, hh, ss


def efficiency_factor(
    t, hr, speed, *, start_s: float = WARMUP_S, end_s: float | None = None
) -> float | None:
    """EF = mean speed (m/min) / mean HR over moving samples in [start_s, end_s]."""
    tt, hh, ss = _arrays(t, hr, speed)
    end_s = tt[-1] if end_s is None and len(tt) else end_s
    m = (tt >= start_s) & (tt <= end_s) & ~np.isnan(hh) & ~np.isnan(ss) & (ss >= MOVING_SPEED_MPS)
    if m.sum() < 60:
        return None
    mean_speed_m_min = float(ss[m].mean() * 60.0)
    mean_hr = float(hh[m].mean())
    return round(mean_speed_m_min / mean_hr, 4) if mean_hr > 0 else None


def is_hilly(elev_gain_m: float | None, distance_m: float | None) -> bool:
    if not elev_gain_m or not distance_m or distance_m < 500:
        return False
    return elev_gain_m / (distance_m / 1000.0) > HILLY_M_PER_KM


def is_steady(t, speed, *, window_s: int = 30) -> bool | None:
    """CV of 30-s rolling pace after warm-up < 10 %. None when there's too little data."""
    tt, _, ss = _arrays(t, [None] * len(t), speed)
    m = (tt >= WARMUP_S) & ~np.isnan(ss) & (ss >= MOVING_SPEED_MPS)
    if m.sum() < 120:
        return None
    tt, ss = tt[m], ss[m]
    bins = ((tt - tt[0]) // window_s).astype(int)
    paces = []
    for b in np.unique(bins):
        sp = ss[bins == b].mean()
        if sp > 0:
            paces.append(1000.0 / sp)  # s/km
    if len(paces) < 4:
        return None
    p = np.array(paces)
    return bool(p.std() / p.mean() < STEADY_CV_MAX)


def decoupling_pct(t, hr, speed) -> float | None:
    """(EF₁ − EF₂) / EF₁ × 100 over two equal-time halves of the post-warm-up portion."""
    tt = np.array(t, dtype=float)
    if len(tt) == 0 or tt[-1] - WARMUP_S < 2 * 600:
        return None
    mid = WARMUP_S + (tt[-1] - WARMUP_S) / 2.0
    ef1 = efficiency_factor(t, hr, speed, start_s=WARMUP_S, end_s=mid)
    ef2 = efficiency_factor(t, hr, speed, start_s=mid, end_s=tt[-1])
    if not ef1 or ef2 is None:
        return None
    return round((ef1 - ef2) / ef1 * 100.0, 2)


def pace_at_hr(t, hr, speed, band: tuple[int, int]) -> float | None:
    """Median pace (s/km) of moving samples with HR inside ``band``; needs ≥ 8 min in band."""
    tt, hh, ss = _arrays(t, hr, speed)
    m = ~np.isnan(hh) & ~np.isnan(ss) & (ss >= MOVING_SPEED_MPS) & (hh >= band[0]) & (hh <= band[1])
    if m.sum() == 0:
        return None
    dt = np.diff(tt, prepend=tt[0])
    dt[dt > 10] = 0
    if float(dt[m].sum()) < MIN_BAND_S:
        return None
    return round(float(np.median(1000.0 / ss[m])), 1)
