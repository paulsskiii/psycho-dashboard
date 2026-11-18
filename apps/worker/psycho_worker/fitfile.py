"""FIT decoding helpers (garmin-fit-sdk 21.221.0)."""

from __future__ import annotations

from typing import Any

from garmin_fit_sdk import Decoder, Stream


def decode(data: bytes) -> tuple[dict[str, list[dict[str, Any]]], list[Any]]:
    """Decode FIT bytes → (messages by name, errors). Never raises on unknown fields."""
    stream = Stream.from_byte_array(bytearray(data))
    decoder = Decoder(stream)
    messages, errors = decoder.read(
        apply_scale_and_offset=True,
        convert_datetimes_to_dates=True,
        convert_types_to_strings=True,
        enable_crc_check=True,
        expand_sub_fields=True,
        expand_components=True,
        merge_heart_rates=True,
    )
    return messages, errors


def field_presence(messages: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    """Summarise which fields a FIT file carries, for DATA_AVAILABILITY.md."""
    summary: dict[str, Any] = {"message_counts": {k: len(v) for k, v in messages.items()}}
    session = (messages.get("session_mesgs") or [{}])[0]
    summary["session_fields"] = sorted(str(k) for k in session)
    records = messages.get("record_mesgs") or []
    rec_fields: set[str] = set()
    for r in records[:2000]:
        rec_fields.update(str(k) for k, v in r.items() if v is not None)
    summary["record_fields"] = sorted(rec_fields)
    summary["record_count"] = len(records)
    summary["has_developer_fields"] = bool(messages.get("field_description_mesgs"))
    summary["developer_field_names"] = [
        str(m.get("field_name")) for m in messages.get("field_description_mesgs") or []
    ]
    summary["has_laps"] = bool(messages.get("lap_mesgs"))
    summary["has_sets"] = bool(messages.get("set_mesgs"))
    # The fields Garmin has been reported to strip from API-delivered FIT files.
    summary["session_training_fields"] = {
        name: session.get(name)
        for name in (
            "total_training_effect",
            "total_anaerobic_training_effect",
            "training_stress_score",
            "training_load_peak",
            "avg_stress",
        )
        if name in session
    }
    summary["session_unknown_fields"] = sorted(str(k) for k in session if isinstance(k, int))
    return summary
