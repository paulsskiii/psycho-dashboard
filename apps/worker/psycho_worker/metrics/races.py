"""Riegel prediction and goal gap (spec §8.7). Also implemented in the web for display."""

from __future__ import annotations

RIEGEL_EXPONENT = 1.06


def riegel(t1_s: float, d1_m: float, d2_m: float) -> float:
    return t1_s * (d2_m / d1_m) ** RIEGEL_EXPONENT


def best_riegel(
    efforts: list[tuple[float, float]], target_m: float, *, min_distance_m: float = 5000
) -> float | None:
    """Fastest Riegel prediction over (time_s, distance_m) efforts of at least ``min_distance_m``."""
    preds = [riegel(t, d, target_m) for t, d in efforts if d >= min_distance_m and t > 0]
    return round(min(preds), 0) if preds else None


def goal_gap(predicted_s: float | None, goal_s: float | None, distance_m: float) -> dict | None:
    if predicted_s is None or not goal_s:
        return None
    gap = predicted_s - goal_s
    return {"gap_s": round(gap), "gap_s_per_km": round(gap / (distance_m / 1000.0), 1)}
