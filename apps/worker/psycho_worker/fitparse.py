"""FIT → activity_streams / activity_laps rows (spec §6.4).

Verified against a real FR165 run and strength FIT (Phase 0): record fields are
``timestamp, position_lat/long (semicircles), distance (m), enhanced_speed (m/s),
enhanced_altitude (m), heart_rate, cadence + fractional_cadence (per-foot steps/min on runs),
power, temperature``; laps carry ``start_time, total_timer_time, total_distance, avg/max_heart_rate,
enhanced_avg_speed, avg_cadence, total_ascent``.
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any

import numpy as np

from .fitfile import decode
from .lttb import lttb

SEMI_TO_DEG = 180.0 / 2**31
CHART_POINTS = 800
STREAM_CHANNELS = ("dist", "hr", "speed", "cadence", "power", "alt")


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def _i(v: Any) -> int | None:
    f = _f(v)
    return None if f is None else int(round(f))


def parse_fit(data: bytes) -> dict[str, Any]:
    """Return {session, streams, laps, has_gps, sport, sub_sport, sets, decode_errors}."""
    messages, errors = decode(data)
    records = messages.get("record_mesgs") or []
    session = (messages.get("session_mesgs") or [{}])[0]
    sport = str(session.get("sport") or "")
    is_run = sport == "running"

    start: datetime | None = session.get("start_time") or (
        records[0]["timestamp"] if records else None
    )
    t: list[int] = []
    dist: list[float | None] = []
    hr: list[int | None] = []
    speed: list[float | None] = []
    cadence: list[float | None] = []
    power: list[float | None] = []
    alt: list[float | None] = []
    lat: list[float | None] = []
    lon: list[float | None] = []
    for r in records:
        ts = r.get("timestamp")
        if ts is None or start is None:
            continue
        t.append(int((ts - start).total_seconds()))
        dist.append(_f(r.get("distance")))
        hr.append(_i(r.get("heart_rate")))
        speed.append(_f(r.get("enhanced_speed", r.get("speed"))))
        cad = _f(r.get("cadence"))
        if cad is not None:
            cad += _f(r.get("fractional_cadence")) or 0.0
            if is_run:
                cad *= 2  # Garmin records per-foot cadence on runs; UI shows steps/min
        cadence.append(cad)
        power.append(_f(r.get("power")))
        alt.append(_f(r.get("enhanced_altitude", r.get("altitude"))))
        la, lo = r.get("position_lat"), r.get("position_long")
        lat.append(la * SEMI_TO_DEG if isinstance(la, int) else None)
        lon.append(lo * SEMI_TO_DEG if isinstance(lo, int) else None)

    has_gps = any(v is not None for v in lat)
    streams = {
        "t": t,
        "dist": dist,
        "hr": hr,
        "speed": speed,
        "cadence": cadence,
        "power": power,
        "alt": alt,
        "lat": lat if has_gps else None,
        "lon": lon if has_gps else None,
        "chart": build_chart(t, dist, hr, speed, cadence, power, alt, lat, lon, has_gps),
    }

    laps = _laps(messages.get("lap_mesgs") or [], start, is_run)
    laps += _km_splits(t, dist, hr, speed, cadence, alt)

    return {
        "session": _jsonable(session),
        "streams": streams,
        "laps": laps,
        "has_gps": has_gps,
        "sport": sport,
        "sub_sport": str(session.get("sub_sport") or ""),
        "sets": [_jsonable(s) for s in messages.get("set_mesgs") or []],
        "record_count": len(records),
        "decode_errors": [str(e) for e in errors][:5],
    }


def build_chart(t, dist, hr, speed, cadence, power, alt, lat, lon, has_gps) -> dict[str, Any]:
    """Downsample each channel independently to ≤ 800 points, keeping peaks (LTTB)."""
    x = np.array(t, dtype=float)
    chart: dict[str, Any] = {}
    for name, series in (
        ("dist", dist),
        ("hr", hr),
        ("speed", speed),
        ("cadence", cadence),
        ("power", power),
        ("alt", alt),
    ):
        y = np.array([np.nan if v is None else v for v in series], dtype=float)
        if np.all(np.isnan(y)):
            continue
        xs, ys = lttb(x, y, CHART_POINTS)
        chart[name] = {"t": [int(v) for v in xs], "v": [round(float(v), 3) for v in ys]}
    if has_gps:
        # Route line: thin uniformly to ≤ 800 points (shape matters, not peaks).
        pts = [
            (la, lo) for la, lo in zip(lat, lon, strict=True) if la is not None and lo is not None
        ]
        step = max(1, math.ceil(len(pts) / CHART_POINTS))
        thinned = pts[::step]
        if thinned and thinned[-1] != pts[-1]:
            thinned.append(pts[-1])
        chart["route"] = [[round(la, 6), round(lo, 6)] for la, lo in thinned]
    return chart


def _laps(lap_msgs: list[dict], start: datetime | None, is_run: bool) -> list[dict[str, Any]]:
    out = []
    for idx, lap in enumerate(lap_msgs):
        st = lap.get("start_time")
        start_s = int((st - start).total_seconds()) if st and start else None
        cad = _f(lap.get("avg_running_cadence", lap.get("avg_cadence")))
        if cad is not None:
            cad += _f(lap.get("avg_fractional_cadence")) or 0.0
            if is_run:
                cad *= 2
        out.append(
            {
                "idx": idx,
                "kind": "lap",
                "start_s": start_s,
                "duration_s": _i(lap.get("total_timer_time")),
                "distance_m": _f(lap.get("total_distance")),
                "avg_hr": _i(lap.get("avg_heart_rate")),
                "max_hr": _i(lap.get("max_heart_rate")),
                "avg_speed_mps": _f(lap.get("enhanced_avg_speed", lap.get("avg_speed"))),
                "avg_cadence": cad,
                "elev_gain_m": _f(lap.get("total_ascent")),
            }
        )
    return out


def _km_splits(t, dist, hr, speed, cadence, alt) -> list[dict[str, Any]]:
    """Per-kilometre splits computed from the record stream."""
    if not dist or all(d is None for d in dist):
        return []
    out = []
    seg_start_i = 0
    next_mark = 1000.0
    n = len(t)
    for i in range(n):
        d = dist[i]
        if d is None:
            continue
        if d >= next_mark or i == n - 1:
            idx = len(out)
            seg = slice(seg_start_i, i + 1)
            d0 = next((x for x in dist[seg_start_i : i + 1] if x is not None), 0.0)
            hrs = [v for v in hr[seg] if v is not None]
            cads = [v for v in cadence[seg] if v is not None]
            alts = [v for v in alt[seg] if v is not None]
            gain = (
                sum(max(0.0, b - a) for a, b in zip(alts, alts[1:], strict=False))
                if len(alts) > 1
                else 0.0
            )
            dur = t[i] - t[seg_start_i]
            seg_dist = d - d0
            if seg_dist < 50:  # tail shorter than 50 m isn't a split
                break
            out.append(
                {
                    "idx": idx,
                    "kind": "km",
                    "start_s": t[seg_start_i],
                    "duration_s": int(dur),
                    "distance_m": round(seg_dist, 1),
                    "avg_hr": int(round(sum(hrs) / len(hrs))) if hrs else None,
                    "max_hr": max(hrs) if hrs else None,
                    "avg_speed_mps": round(seg_dist / dur, 3) if dur > 0 else None,
                    "avg_cadence": round(sum(cads) / len(cads), 1) if cads else None,
                    "elev_gain_m": round(gain, 1),
                }
            )
            seg_start_i = i
            next_mark += 1000.0
    return out


def _jsonable(d: dict) -> dict:
    out = {}
    for k, v in d.items():
        if isinstance(k, int):
            continue
        if isinstance(v, datetime):
            v = v.isoformat()
        out[k] = v
    return out
