"""Sanitise Garmin data before it is committed as a fixture (spec 14, Phase 0).

Rules:
  * JSON: null every latitude/longitude scalar, drop polyline/geo arrays entirely, and redact
    identity fields (names, emails, profile IDs, image URLs). Health values stay (they are the
    point of the fixtures; the repo is private).
  * FIT: blank ``record`` positions within the first and last 300 m of distance, and blank
    every start/end/bounding-box position on ``lap``, ``session``, ``segment_lap``,
    ``gps_metadata`` and ``course_point`` messages. Everything else is byte-identical, so the
    fixture still exercises the real parser. CRCs are recomputed.
"""

from __future__ import annotations

import re
import struct
from typing import Any

from garmin_fit_sdk import CrcCalculator

HOME_RADIUS_M = 300.0

_LATLON_KEY = re.compile(r"(lat|lon|lng|longitude|latitude)", re.IGNORECASE)
_GEO_ARRAY_KEY = re.compile(
    r"(polyline|geoPolyline|polylineDTO|gpsPoints|route|coordinates)", re.IGNORECASE
)
_IDENTITY_KEY = re.compile(
    r"^(displayName|fullName|firstName|lastName|userName|username|emailAddress|email|"
    r"ownerDisplayName|ownerFullName|ownerProfileImageUrl.*|profileImageUrl.*|"
    r"userProfileId|userProfilePk|ownerId|profileId|displayname|location|"
    r"deviceSerialNumber|unitId|serialNumber|garminGUID|imageUrl|.*ImageUrl)$",
    re.IGNORECASE,  # Garmin mixes fullName / fullname / displayname across services
)
_FREE_TEXT_KEY = re.compile(r"^(description|locationName|activityName|name)$")


def sanitize_json(value: Any, *, key: str | None = None) -> Any:
    """Recursively sanitise a decoded JSON structure. Returns a new structure."""
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if _GEO_ARRAY_KEY.search(k) and isinstance(v, (list, dict)):
                out[k] = "[stripped]"
            elif _IDENTITY_KEY.match(k):
                out[k] = _redact_scalar(v)
            elif _LATLON_KEY.search(k) and isinstance(v, (int, float)) and not isinstance(v, bool):
                out[k] = None
            elif _FREE_TEXT_KEY.match(k) and isinstance(v, str):
                # Activity names may contain place names; keep the sport word if any.
                out[k] = _generic_name(v)
            else:
                out[k] = sanitize_json(v, key=k)
        return out
    if isinstance(value, list):
        if (
            value
            and all(isinstance(p, (list, tuple)) and len(p) == 2 for p in value)
            and (key and _LATLON_KEY.search(key))
        ):
            return "[stripped]"
        return [sanitize_json(v, key=key) for v in value]
    return value


def _redact_scalar(v: Any) -> Any:
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)):
        return 0
    return "[redacted]"


def _generic_name(name: str) -> str:
    low = name.lower()
    for sport in ("run", "ride", "cycl", "strength", "walk", "treadmill", "swim", "hike"):
        if sport in low:
            return f"[{sport}]"
    return "[activity]"


# -- FIT ---------------------------------------------------------------------------------------

_FIT_SINT32_INVALID = 0x7FFFFFFF
_MESG_RECORD = 20
_MESG_LAP = 19
_MESG_SESSION = 18
_MESG_SEGMENT_LAP = 142
_MESG_GPS_METADATA = 160
_MESG_COURSE_POINT = 32

# Position fields to blank unconditionally, by global message number → field def numbers.
_ALWAYS_BLANK: dict[int, frozenset[int]] = {
    _MESG_LAP: frozenset({3, 4, 5, 6, 27, 28, 29, 30}),
    _MESG_SESSION: frozenset({3, 4, 29, 30, 31, 32, 38, 39}),
    _MESG_SEGMENT_LAP: frozenset({3, 4, 5, 6, 25, 26, 27, 28}),
    _MESG_GPS_METADATA: frozenset({1, 2}),
    _MESG_COURSE_POINT: frozenset({2, 3}),
}
_RECORD_LAT, _RECORD_LON, _RECORD_DISTANCE = 0, 1, 5


def sanitize_fit(data: bytes, *, home_radius_m: float = HOME_RADIUS_M) -> bytes:
    """Return a copy of a FIT file with home-area GPS removed. See module docstring."""
    buf = bytearray(data)
    header_size = buf[0]
    data_size = struct.unpack_from("<I", buf, 4)[0]
    end = header_size + data_size

    # Pass 1: find the total distance so we know where "the last 300 m" starts.
    total_distance = _scan_total_distance(buf, header_size, end)
    tail_start = max(0.0, total_distance - home_radius_m) if total_distance else None

    # Pass 2: rewrite.
    defs: dict[int, dict[str, Any]] = {}
    pos = header_size
    while pos < end:
        hdr = buf[pos]
        if hdr & 0x80:  # compressed timestamp header: local type in bits 5-6, data message
            local = (hdr >> 5) & 0x03
            pos += 1
            pos = _handle_data(buf, pos, defs[local], tail_start, home_radius_m)
            continue
        local = hdr & 0x0F
        if hdr & 0x40:  # definition message
            has_dev = bool(hdr & 0x20)
            defn, pos = _read_definition(buf, pos + 1, has_dev)
            defs[local] = defn
        else:
            pos += 1
            pos = _handle_data(buf, pos, defs[local], tail_start, home_radius_m)

    # Recompute the data CRC (last two bytes) and the header CRC when the header is 14 bytes.
    if header_size == 14:
        struct.pack_into("<H", buf, 12, CrcCalculator.calculate_crc(bytes(buf[:12]), 0, 12))
    struct.pack_into("<H", buf, end, CrcCalculator.calculate_crc(bytes(buf[:end]), 0, end))
    return bytes(buf)


def _read_definition(buf: bytearray, pos: int, has_dev: bool) -> tuple[dict[str, Any], int]:
    pos += 1  # reserved
    arch = buf[pos]
    pos += 1
    endian = ">" if arch == 1 else "<"
    global_num = struct.unpack_from(endian + "H", buf, pos)[0]
    pos += 2
    nfields = buf[pos]
    pos += 1
    fields = []
    for _ in range(nfields):
        fields.append((buf[pos], buf[pos + 1], buf[pos + 2]))  # (def_num, size, base_type)
        pos += 3
    dev_size = 0
    if has_dev:
        ndev = buf[pos]
        pos += 1
        for _ in range(ndev):
            dev_size += buf[pos + 1]
            pos += 3
    total = sum(size for _, size, _ in fields) + dev_size
    return {"global": global_num, "endian": endian, "fields": fields, "size": total}, pos


def _scan_total_distance(buf: bytearray, start: int, end: int) -> float | None:
    defs: dict[int, dict[str, Any]] = {}
    pos = start
    last_distance: float | None = None
    while pos < end:
        hdr = buf[pos]
        if hdr & 0x80:
            local = (hdr >> 5) & 0x03
            pos += 1
        else:
            local = hdr & 0x0F
            if hdr & 0x40:
                defn, pos = _read_definition(buf, pos + 1, bool(hdr & 0x20))
                defs[local] = defn
                continue
            pos += 1
        defn = defs[local]
        if defn["global"] == _MESG_RECORD:
            off = pos
            for def_num, size, _bt in defn["fields"]:
                if def_num == _RECORD_DISTANCE and size == 4:
                    raw = struct.unpack_from(defn["endian"] + "I", buf, off)[0]
                    if raw != 0xFFFFFFFF:
                        last_distance = raw / 100.0
                off += size
        pos += defn["size"]
    return last_distance


def _handle_data(
    buf: bytearray, pos: int, defn: dict[str, Any], tail_start: float | None, radius: float
) -> int:
    g = defn["global"]
    endian = defn["endian"]
    if g in _ALWAYS_BLANK:
        off = pos
        for def_num, size, _bt in defn["fields"]:
            if def_num in _ALWAYS_BLANK[g] and size == 4:
                struct.pack_into(endian + "i", buf, off, _FIT_SINT32_INVALID)
            off += size
    elif g == _MESG_RECORD:
        offsets: dict[int, int] = {}
        off = pos
        for def_num, size, _bt in defn["fields"]:
            offsets[def_num] = off
            off += size
        distance = None
        if _RECORD_DISTANCE in offsets:
            raw = struct.unpack_from(endian + "I", buf, offsets[_RECORD_DISTANCE])[0]
            if raw != 0xFFFFFFFF:
                distance = raw / 100.0
        near_home = (
            distance is None  # no distance → can't place it, so be safe and blank it
            or distance <= radius
            or (tail_start is not None and distance >= tail_start)
        )
        if near_home:
            for f in (_RECORD_LAT, _RECORD_LON):
                if f in offsets:
                    struct.pack_into(endian + "i", buf, offsets[f], _FIT_SINT32_INVALID)
    return pos + defn["size"]
