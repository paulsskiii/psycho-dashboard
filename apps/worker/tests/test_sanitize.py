"""Sanitiser tests: GPS near home is removed, everything else survives, file still decodes."""

from __future__ import annotations

import datetime as dt

from garmin_fit_sdk import Encoder, Profile

from psycho_worker.fitfile import decode
from psycho_worker.sanitize import sanitize_fit, sanitize_json

MESG = Profile["mesg_num"]
SEMI = 2**31 / 180.0  # degrees → semicircles


def _build_fit(n_records: int = 120, step_m: float = 10.0) -> bytes:
    """A 1.2 km fake run: 120 records 10 m apart, with HR, plus a lap and a session."""
    enc = Encoder()
    t0 = dt.datetime(2026, 11, 10, 6, 0, tzinfo=dt.UTC)
    enc.write_mesg(
        {
            "mesg_num": MESG["FILE_ID"],
            "type": "activity",
            "manufacturer": "garmin",
            "time_created": t0,
        }
    )
    lat0, lon0 = 14.55, 121.02
    for i in range(n_records):
        enc.write_mesg(
            {
                "mesg_num": MESG["RECORD"],
                "timestamp": t0 + dt.timedelta(seconds=i * 4),
                "position_lat": int((lat0 + i * 1e-4) * SEMI),
                "position_long": int((lon0 + i * 1e-4) * SEMI),
                "distance": i * step_m,
                "heart_rate": 140 + (i % 7),
                "cadence": 85,
                "enhanced_speed": 2.6,
            }
        )
    enc.write_mesg(
        {
            "mesg_num": MESG["LAP"],
            "timestamp": t0 + dt.timedelta(seconds=n_records * 4),
            "start_time": t0,
            "start_position_lat": int(lat0 * SEMI),
            "start_position_long": int(lon0 * SEMI),
            "end_position_lat": int((lat0 + 0.012) * SEMI),
            "end_position_long": int((lon0 + 0.012) * SEMI),
            "total_distance": n_records * step_m,
            "avg_heart_rate": 143,
        }
    )
    enc.write_mesg(
        {
            "mesg_num": MESG["SESSION"],
            "timestamp": t0 + dt.timedelta(seconds=n_records * 4),
            "start_time": t0,
            "sport": "running",
            "start_position_lat": int(lat0 * SEMI),
            "start_position_long": int(lon0 * SEMI),
            "nec_lat": int((lat0 + 0.012) * SEMI),
            "nec_long": int((lon0 + 0.012) * SEMI),
            "swc_lat": int(lat0 * SEMI),
            "swc_long": int(lon0 * SEMI),
            "total_distance": n_records * step_m,
            "total_training_effect": 3.1,
            "avg_heart_rate": 143,
        }
    )
    return bytes(enc.close())


def test_fit_sanitiser_blanks_only_home_area_and_still_decodes():
    original = _build_fit()
    clean = sanitize_fit(original, home_radius_m=300.0)
    assert len(clean) == len(original)

    msgs_in, err_in = decode(original)
    msgs_out, err_out = decode(clean)
    assert not err_in and not err_out

    recs_in = msgs_in["record_mesgs"]
    recs_out = msgs_out["record_mesgs"]
    assert len(recs_in) == len(recs_out) == 120

    for a, b in zip(recs_in, recs_out, strict=True):
        d = a["distance"]
        assert b["heart_rate"] == a["heart_rate"]
        assert b["distance"] == d
        if d <= 300 or d >= 1190 - 300:
            assert "position_lat" not in b or b.get("position_lat") is None
            assert "position_long" not in b or b.get("position_long") is None
        else:
            assert b["position_lat"] == a["position_lat"]
            assert b["position_long"] == a["position_long"]

    lap = msgs_out["lap_mesgs"][0]
    for k in ("start_position_lat", "start_position_long", "end_position_lat", "end_position_long"):
        assert lap.get(k) is None
    assert lap["avg_heart_rate"] == 143

    session = msgs_out["session_mesgs"][0]
    for k in (
        "start_position_lat",
        "start_position_long",
        "nec_lat",
        "nec_long",
        "swc_lat",
        "swc_long",
    ):
        assert session.get(k) is None
    assert abs(session["total_training_effect"] - 3.1) < 0.05
    assert session["sport"] == "running"


def test_json_sanitiser():
    raw = {
        "activityId": 123,
        "activityName": "Morning Run around BGC",
        "startLatitude": 14.55,
        "startLongitude": 121.02,
        "ownerDisplayName": "paul",
        "fullname": "Paul Example",
        "userProfileId": 99,
        "averageHR": 150,
        "geoPolylineDTO": {"polyline": [{"lat": 1, "lon": 2}]},
        "summaryDTO": {"maxHR": 171, "endLatitude": 14.6},
        "nested": [{"lat": 1.0}, {"x": "ok"}],
    }
    out = sanitize_json(raw)
    assert out["activityId"] == 123
    assert out["activityName"] == "[run]"
    assert out["startLatitude"] is None and out["startLongitude"] is None
    assert out["ownerDisplayName"] == "[redacted]"
    assert out["fullname"] == "[redacted]"
    assert out["userProfileId"] == 0
    assert out["averageHR"] == 150
    assert out["geoPolylineDTO"] == "[stripped]"
    assert out["summaryDTO"] == {"maxHR": 171, "endLatitude": None}
    assert out["nested"] == [{"lat": None}, {"x": "ok"}]
