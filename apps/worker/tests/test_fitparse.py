"""Real FIT fixtures parse with no exceptions and produce sane streams/laps (spec §8.8)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from psycho_worker.fitparse import parse_fit
from psycho_worker.lttb import lttb

FIT_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "fit"
FIT_FILES = sorted(FIT_DIR.glob("*.fit"))
if not FIT_FILES:  # the public copy ships without the owner's Garmin data
    pytest.skip("fixtures/fit not present", allow_module_level=True)


@pytest.mark.parametrize("path", FIT_FILES, ids=[p.stem for p in FIT_FILES])
def test_fixture_parses(path: Path):
    out = parse_fit(path.read_bytes())
    assert not out["decode_errors"]
    s = out["streams"]
    n = len(s["t"])
    assert n == out["record_count"] > 100
    for ch in ("dist", "hr", "speed", "cadence", "power", "alt"):
        assert len(s[ch]) == n
    assert s["t"] == sorted(s["t"])
    assert all(v is None or 30 <= v <= 230 for v in s["hr"])
    # chart ≤ 800 points per channel, JSON-serialisable
    for ch, series in s["chart"].items():
        if ch == "route":
            assert len(series) <= 801
        else:
            assert len(series["t"]) <= 800 and len(series["t"]) == len(series["v"])
    json.dumps(s["chart"])
    json.dumps(out["laps"])
    json.dumps(out["sets"])


def test_run_fixture_specifics():
    run = next(p for p in FIT_FILES if p.stem.startswith("running"))
    out = parse_fit(run.read_bytes())
    assert out["sport"] == "running" and out["has_gps"]
    s = out["streams"]
    # Sanitised fixture: no GPS within first/last 300 m, GPS elsewhere.
    assert s["lat"][0] is None and s["lat"][-1] is None
    assert any(v is not None for v in s["lat"])
    # Cadence is steps/min (both feet): a run sits around 150-190.
    cad = [v for v in s["cadence"] if v]
    assert 140 < np.median(cad) < 200
    laps = [lap for lap in out["laps"] if lap["kind"] == "lap"]
    kms = [lap for lap in out["laps"] if lap["kind"] == "km"]
    assert len(laps) == 19
    assert 17 <= len(kms) <= 18
    assert all(900 <= k["distance_m"] <= 1100 for k in kms[:-1])
    assert abs(sum(k["duration_s"] for k in kms) - s["t"][-1]) < 120
    assert out["session"]["total_training_effect"] == pytest.approx(3.8, abs=0.05)
    assert "route" in s["chart"] and len(s["chart"]["route"]) <= 801


def test_strength_fixture_specifics():
    st = next(p for p in FIT_FILES if p.stem.startswith("strength"))
    out = parse_fit(st.read_bytes())
    assert not out["has_gps"]
    assert out["streams"]["lat"] is None
    assert len(out["sets"]) > 10
    assert out["laps"] == [] or all(lap["kind"] == "lap" for lap in out["laps"])
    assert "hr" in out["streams"]["chart"]


def test_lttb_keeps_endpoints_and_peak():
    x = np.arange(1000, dtype=float)
    y = np.zeros(1000)
    y[500] = 100.0  # a single spike must survive
    xs, ys = lttb(x, y, 50)
    assert len(xs) == 50
    assert xs[0] == 0 and xs[-1] == 999
    assert 100.0 in ys
