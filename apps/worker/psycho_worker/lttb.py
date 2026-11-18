"""Largest-Triangle-Three-Buckets downsampling (spec §6.4): ≤ N points per channel, keeps peaks."""

from __future__ import annotations

import numpy as np


def lttb(x: np.ndarray, y: np.ndarray, threshold: int = 800) -> tuple[np.ndarray, np.ndarray]:
    """Return (x', y') with at most ``threshold`` points. NaNs in ``y`` are dropped first."""
    keep = ~np.isnan(y.astype(float))
    x, y = x[keep], y[keep]
    n = len(x)
    if threshold >= n or threshold < 3:
        return x, y
    xf = x.astype(float)
    yf = y.astype(float)
    sampled_idx = [0]
    bucket = (n - 2) / (threshold - 2)
    a = 0
    for i in range(threshold - 2):
        # Next bucket's average point.
        r0 = int(np.floor((i + 1) * bucket)) + 1
        r1 = min(int(np.floor((i + 2) * bucket)) + 1, n)
        avg_x = xf[r0:r1].mean()
        avg_y = yf[r0:r1].mean()
        # Current bucket range.
        c0 = int(np.floor(i * bucket)) + 1
        c1 = min(int(np.floor((i + 1) * bucket)) + 1, n)
        ax, ay = xf[a], yf[a]
        areas = np.abs((ax - avg_x) * (yf[c0:c1] - ay) - (ax - xf[c0:c1]) * (avg_y - ay))
        a = c0 + int(np.argmax(areas))
        sampled_idx.append(a)
    sampled_idx.append(n - 1)
    idx = np.array(sampled_idx)
    return x[idx], y[idx]
