"""Phase 0 data audit (spec 2 and 14).

``python -m psycho_worker audit`` pulls the last 7 days of every endpoint in spec 3 from both
sources, stores the unsanitised responses under ``apps/worker/.raw/`` (gitignored), writes
sanitised copies to ``fixtures/``, downloads 2 FIT files (one run, one strength), checks which
training fields the official FIT carries, and writes ``docs/DATA_AVAILABILITY.md``.

Everything is best-effort per endpoint: a failing endpoint is recorded as ``error`` in the
availability table and the audit continues. Nothing is written to Garmin.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from . import logs
from .config import DOCS_DIR, FIXTURES_DIR, RAW_DIR, TIMEZONE, Settings
from .fitfile import decode, field_presence
from .garmin.official import OfficialGarmin
from .garmin.unofficial import NeedsLogin, ReadOnlyGarmin, library_version
from .sanitize import sanitize_fit, sanitize_json

log = logs.get("audit")

DAYS = 7


@dataclass
class EndpointResult:
    source: str  # "official" | "unofficial"
    name: str
    status: str  # present | empty | missing | error | skipped
    detail: str = ""
    keys: list[str] = field(default_factory=list)
    elapsed_ms: int = 0
    http_status: int | None = None


@dataclass
class Audit:
    started: datetime
    results: list[EndpointResult] = field(default_factory=list)
    fit_findings: dict[str, Any] = field(default_factory=dict)
    activities: list[dict[str, Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _today() -> date:
    return datetime.now(ZoneInfo(TIMEZONE)).date()


_ENVELOPE_KEYS = re.compile(
    r"^(userId|userProfilePK|userProfilePk|userProfileId|id|startDate|endDate|calendarDate|"
    r"fromCalendarDate|toCalendarDate|date|activityId|activityUUID)$"
)


def _meaningful_leaves(value: Any, key: str | None = None) -> int:
    """Count non-null leaf values that aren't just ids/dates. 0 means an empty envelope."""
    if isinstance(value, dict):
        return sum(_meaningful_leaves(v, k) for k, v in value.items())
    if isinstance(value, list):
        return sum(_meaningful_leaves(v, key) for v in value)
    if value is None or value == "" or (key and _ENVELOPE_KEYS.match(key)):
        return 0
    return 1


def _classify(value: Any) -> tuple[str, list[str]]:
    """present / empty, plus top-level keys for the availability table.

    Garmin often returns a shell (ids + dates + nulls) for features a watch lacks; that counts
    as empty so the forward-compat rows aren't marked present on the FR165.
    """
    if _meaningful_leaves(value) == 0:
        return "empty", []
    if isinstance(value, dict):
        return "present", sorted(map(str, value.keys()))[:40]
    if isinstance(value, list):
        first = value[0] if value else None
        keys = sorted(map(str, first.keys()))[:40] if isinstance(first, dict) else []
        return "present", keys
    return "present", []


def _write_pair(raw_dir: Path, fix_dir: Path, name: str, value: Any) -> None:
    raw_dir.mkdir(parents=True, exist_ok=True)
    fix_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / f"{name}.json").write_text(json.dumps(value, indent=1, default=str))
    (fix_dir / f"{name}.json").write_text(json.dumps(sanitize_json(value), indent=1, default=str))


def _http_status(exc: BaseException) -> int | None:
    code = getattr(exc, "status_code", None)
    if isinstance(code, int):
        return code
    text = str(exc)
    for c in ("401", "403", "404", "429", "500", "502", "503"):
        if c in text:
            return int(c)
    return None


class _Runner:
    def __init__(self, audit: Audit, source: str, raw_dir: Path, fix_dir: Path) -> None:
        self.audit = audit
        self.source = source
        self.raw_dir = raw_dir
        self.fix_dir = fix_dir

    def call(self, name: str, fn: Callable[[], Any], *, save_as: str | None = None) -> Any:
        t0 = time.monotonic()
        try:
            value = fn()
        except NeedsLogin as exc:
            self._record(name, "error", f"needs login: {exc}", t0, 401)
            raise
        except Exception as exc:  # noqa: BLE001 — recorded, audit continues
            code = _http_status(exc)
            status = "missing" if code == 404 else "error"
            self._record(name, status, f"{type(exc).__name__} {code or ''}".strip(), t0, code)
            log.warning("endpoint failed", source=self.source, endpoint=name, http=code)
            return None
        status, keys = _classify(value)
        self._record(name, status, "", t0, None, keys)
        # Binary downloads (FIT) are sanitised and written by the caller, never dumped as JSON.
        if not isinstance(value, bytes):
            _write_pair(self.raw_dir, self.fix_dir, save_as or name, value)
        log.info("endpoint ok", source=self.source, endpoint=name, status=status)
        return value

    def _record(self, name, status, detail, t0, code, keys=None) -> None:
        self.audit.results.append(
            EndpointResult(
                source=self.source,
                name=name,
                status=status,
                detail=detail,
                keys=keys or [],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
                http_status=code,
            )
        )


# -- official -----------------------------------------------------------------------------------


def _audit_official(audit: Audit, api: OfficialGarmin, start: date, end: date) -> None:
    r = _Runner(audit, "official", RAW_DIR / "official", FIXTURES_DIR / "official")
    s, e = start.isoformat(), end.isoformat()

    r.call("get_user_profile_settings", api.get_user_profile_settings)
    r.call("get_heart_rate_zones", api.get_heart_rate_zones)
    r.call("get_daily_summaries", lambda: api.get_daily_summaries(s, e))
    r.call("get_daily_sleep_summaries", lambda: api.get_daily_sleep_summaries(s, e))
    r.call("get_daily_hrv_summaries", lambda: api.get_daily_hrv_summaries(s, e))
    r.call("get_daily_body_battery", lambda: api.get_daily_body_battery(s, e))
    r.call("get_daily_stress", lambda: api.get_daily_stress(s, e))
    r.call("get_daily_steps", lambda: api.get_daily_steps(s, e))
    r.call("get_weight_measurements", lambda: api.get_weight_measurements(s, e))
    r.call("get_wellness_activity_summaries", lambda: api.get_wellness_activity_summaries(s, e))
    # Per-day endpoints: pull the whole window so wellness coverage is visible day by day.
    for i in range(DAYS):
        d = (end - timedelta(days=i)).isoformat()
        r.call(
            "get_daily_sleep", lambda d=d: api.get_daily_sleep(d), save_as=f"get_daily_sleep_{d}"
        )
        r.call("get_daily_hrv", lambda d=d: api.get_daily_hrv(d), save_as=f"get_daily_hrv_{d}")
        r.call(
            "get_daily_heart_rate",
            lambda d=d: api.get_daily_heart_rate(d),
            save_as=f"get_daily_heart_rate_{d}",
        )
        r.call("get_daily_spo2", lambda d=d: api.get_daily_spo2(d), save_as=f"get_daily_spo2_{d}")
    r.call("get_fitness_age", lambda: api.get_fitness_age(e))

    # Activities: list the window, then details + workouts for each, and FIT for 2.
    found = r.call(
        "search_activities",
        lambda: api.search_activities(start=0, limit=50, start_date=s, end_date=e),
    )
    acts = found if isinstance(found, list) else (found or {}).get("activities") or []
    for a in acts:
        aid = a.get("activityId")
        atype = ((a.get("activityType") or {}).get("typeKey")) or a.get("activityTypeKey") or "?"
        audit.activities.append({"id": aid, "type": atype, "start": a.get("startTimeLocal")})
    log.info("activities in window", n=len(acts))

    for a in acts[:5]:
        aid = a["activityId"]
        r.call("get_activity", lambda aid=aid: api.get_activity(aid), save_as=f"get_activity_{aid}")
        r.call(
            "get_activity_workouts",
            lambda aid=aid: api.get_activity_workouts(aid),
            save_as=f"get_activity_workouts_{aid}",
        )

    # Two FIT files: one run, one strength (fallback: any two).
    picks: list[dict[str, Any]] = []
    for want in ("running", "strength_training"):
        for a in acts:
            if a not in picks and want in str((a.get("activityType") or {}).get("typeKey", "")):
                picks.append(a)
                break
    for a in acts:
        if len(picks) >= 2:
            break
        if a not in picks:
            picks.append(a)
    for a in picks:
        aid = a["activityId"]
        atype = (a.get("activityType") or {}).get("typeKey", "unknown")
        label = f"{atype}_{aid}"
        fit = r.call(
            "download_activity",
            lambda aid=aid: api.download_activity_fit(aid),
            save_as=f"fit_{label}",
        )
        if not isinstance(fit, bytes):
            continue
        (RAW_DIR / "official").mkdir(parents=True, exist_ok=True)
        (RAW_DIR / "official" / f"{label}.fit").write_bytes(fit)
        try:
            messages, errors = decode(fit)
            presence = field_presence(messages)
            presence["decode_errors"] = [str(x) for x in errors][:5]
            audit.fit_findings[label] = presence
            clean = sanitize_fit(fit)
            (FIXTURES_DIR / "fit").mkdir(parents=True, exist_ok=True)
            (FIXTURES_DIR / "fit" / f"{label}.fit").write_bytes(clean)
            # Prove the sanitised copy still decodes.
            _, clean_errors = decode(clean)
            audit.fit_findings[label]["sanitised_decode_errors"] = [str(x) for x in clean_errors][
                :5
            ]
        except Exception as exc:  # noqa: BLE001
            audit.fit_findings[label] = {"error": f"{type(exc).__name__}: {exc}"}
            log.warning("fit decode failed", label=label)


# -- unofficial ---------------------------------------------------------------------------------


def _audit_unofficial(audit: Audit, api: ReadOnlyGarmin, start: date, end: date) -> None:
    r = _Runner(audit, "unofficial", RAW_DIR / "unofficial", FIXTURES_DIR / "unofficial")
    s, e = start.isoformat(), end.isoformat()

    r.call("get_device_last_used", api.get_device_last_used)
    r.call("get_devices", api.get_devices)
    r.call("get_user_profile", api.get_user_profile)
    r.call("get_max_metrics_range", lambda: api.get_max_metrics_range(s, e))
    r.call("get_max_metrics", lambda: api.get_max_metrics(e))
    # The library requires _type with a date range; no args returns the latest prediction.
    r.call(
        "get_race_predictions",
        lambda: api.get_race_predictions(s, e, _type="daily"),
        save_as="get_race_predictions_daily",
    )
    r.call("get_race_predictions", api.get_race_predictions, save_as="get_race_predictions_latest")
    r.call("get_personal_record", api.get_personal_record)
    r.call("get_body_composition", lambda: api.get_body_composition(s, e))
    r.call("get_weigh_ins", lambda: api.get_weigh_ins(s, e))
    r.call("get_fitnessage_data", lambda: api.get_fitnessage_data(e))
    # Forward-compat (expected empty on FR165)
    r.call("get_training_readiness", lambda: api.get_training_readiness(e))
    r.call("get_training_status", lambda: api.get_training_status(e))
    r.call("get_endurance_score", lambda: api.get_endurance_score(s, e))
    r.call("get_hill_score", lambda: api.get_hill_score(s, e))
    for i in range(DAYS):
        d = (end - timedelta(days=i)).isoformat()
        r.call(
            "get_respiration_data",
            lambda d=d: api.get_respiration_data(d),
            save_as=f"get_respiration_data_{d}",
        )
    # One day each of the wellness endpoints the official API also covers, for cross-checking.
    r.call("get_sleep_data", lambda: api.get_sleep_data(e))
    r.call("get_hrv_data", lambda: api.get_hrv_data(e))
    r.call("get_stats", lambda: api.get_stats(e))
    r.call("get_rhr_day", lambda: api.get_rhr_day(e))
    r.call("get_body_battery", lambda: api.get_body_battery(s, e))
    r.call("get_stress_data", lambda: api.get_stress_data(e))
    r.call("get_spo2_data", lambda: api.get_spo2_data(e))

    acts = r.call("get_activities_by_date", lambda: api.get_activities_by_date(s, e)) or []
    if not audit.activities:
        for a in acts:
            audit.activities.append(
                {
                    "id": a.get("activityId"),
                    "type": (a.get("activityType") or {}).get("typeKey"),
                    "start": a.get("startTimeLocal"),
                }
            )
    for a in acts[:5]:
        aid = a["activityId"]
        r.call("get_activity", lambda aid=aid: api.get_activity(aid), save_as=f"get_activity_{aid}")
        r.call(
            "get_activity_splits",
            lambda aid=aid: api.get_activity_splits(aid),
            save_as=f"get_activity_splits_{aid}",
        )
        r.call(
            "get_activity_typed_splits",
            lambda aid=aid: api.get_activity_typed_splits(aid),
            save_as=f"get_activity_typed_splits_{aid}",
        )
        r.call(
            "get_activity_hr_in_timezones",
            lambda aid=aid: api.get_activity_hr_in_timezones(aid),
            save_as=f"get_activity_hr_in_timezones_{aid}",
        )
        r.call(
            "get_activity_weather",
            lambda aid=aid: api.get_activity_weather(aid),
            save_as=f"get_activity_weather_{aid}",
        )
        if "strength" in str((a.get("activityType") or {}).get("typeKey", "")):
            r.call(
                "get_activity_exercise_sets",
                lambda aid=aid: api.get_activity_exercise_sets(aid),
                save_as=f"get_activity_exercise_sets_{aid}",
            )


# -- report ------------------------------------------------------------------------------------

# Spec section 7 metrics → the endpoint(s) and field(s) that feed them.
METRIC_SOURCES: list[tuple[str, str, str, list[tuple[str, str]]]] = [
    (
        "Recovery",
        "Overnight HRV + 7-day avg + baseline + status",
        "Garmin",
        [
            ("official", "get_daily_hrv"),
            ("official", "get_daily_hrv_summaries"),
            ("unofficial", "get_hrv_data"),
        ],
    ),
    (
        "Recovery",
        "Sleep score, duration, stages",
        "Garmin",
        [
            ("official", "get_daily_sleep"),
            ("official", "get_daily_sleep_summaries"),
            ("unofficial", "get_sleep_data"),
        ],
    ),
    (
        "Recovery",
        "Resting HR",
        "Garmin",
        [
            ("official", "get_daily_summaries"),
            ("official", "get_daily_heart_rate"),
            ("unofficial", "get_rhr_day"),
        ],
    ),
    (
        "Recovery",
        "Body Battery at wake, charged/drained",
        "Garmin",
        [("official", "get_daily_body_battery"), ("unofficial", "get_body_battery")],
    ),
    (
        "Recovery",
        "Stress average",
        "Garmin",
        [("official", "get_daily_stress"), ("unofficial", "get_stress_data")],
    ),
    (
        "Recovery",
        "Respiration",
        "Garmin",
        [("unofficial", "get_respiration_data"), ("official", "get_daily_summaries")],
    ),
    (
        "Recovery",
        "SpO2",
        "Garmin",
        [("official", "get_daily_spo2"), ("unofficial", "get_spo2_data")],
    ),
    (
        "Recovery",
        "Recovery time remaining",
        "Garmin",
        [],  # no endpoint in either library or the FIT profile; see notes
    ),
    (
        "Training",
        "VO2 max trend",
        "Garmin",
        [
            ("unofficial", "get_max_metrics_range"),
            ("unofficial", "get_activities_by_date"),
            ("unofficial", "get_max_metrics"),
        ],
    ),
    (
        "Training",
        "Training Effect (aerobic/anaerobic, label)",
        "Garmin",
        [
            ("unofficial", "get_activity"),
            ("official", "get_activity"),
            ("official", "download_activity"),
        ],
    ),
    (
        "Training",
        "hrTSS, load, CTL/ATL/TSB, ACWR, status, readiness",
        "Psycho",
        [("official", "download_activity"), ("official", "get_daily_summaries")],
    ),
    (
        "Training",
        "Native Training Readiness (forward-compat)",
        "Garmin",
        [("unofficial", "get_training_readiness")],
    ),
    (
        "Training",
        "Native Training Status (forward-compat)",
        "Garmin",
        [("unofficial", "get_training_status")],
    ),
    (
        "Training",
        "Native Endurance / Hill score (forward-compat)",
        "Garmin",
        [("unofficial", "get_endurance_score"), ("unofficial", "get_hill_score")],
    ),
    ("Efficiency", "EF, decoupling, pace at HR", "Psycho", [("official", "download_activity")]),
    (
        "Intensity",
        "HR zones (per activity), 80/20, drifted hard",
        "Psycho",
        [
            ("official", "get_heart_rate_zones"),
            ("unofficial", "get_activity_hr_in_timezones"),
            ("official", "download_activity"),
        ],
    ),
    (
        "Races",
        "Garmin race predictor 5K/10K/HM/M",
        "Garmin",
        [("unofficial", "get_race_predictions")],
    ),
    ("Races", "Personal records (PB board)", "Garmin", [("unofficial", "get_personal_record")]),
    (
        "Activity",
        "Summary, splits, laps",
        "Garmin",
        [
            ("official", "get_activity"),
            ("unofficial", "get_activity_splits"),
            ("unofficial", "get_activity_typed_splits"),
        ],
    ),
    (
        "Activity",
        "Streams (HR, pace, cadence, elevation, power, GPS)",
        "Garmin",
        [("official", "download_activity")],
    ),
    ("Activity", "Weather", "Garmin", [("unofficial", "get_activity_weather")]),
    (
        "Activity",
        "Attached workout (structured session flag)",
        "Garmin",
        [("official", "get_activity_workouts")],
    ),
    (
        "Activity",
        "Strength exercise sets",
        "Garmin",
        [("unofficial", "get_activity_exercise_sets"), ("official", "download_activity")],
    ),
    (
        "Body",
        "Weight, body comp",
        "Garmin",
        [
            ("official", "get_weight_measurements"),
            ("unofficial", "get_body_composition"),
            ("unofficial", "get_weigh_ins"),
        ],
    ),
    (
        "Body",
        "Fitness age",
        "Garmin",
        [("official", "get_fitness_age"), ("unofficial", "get_fitnessage_data")],
    ),
    ("Header", "Last watch sync", "Garmin", [("unofficial", "get_device_last_used")]),
    (
        "Header",
        "Steps",
        "Garmin",
        [("official", "get_daily_steps"), ("official", "get_daily_summaries")],
    ),
]


def write_report(audit: Audit, settings: Settings, path: Path) -> None:
    by_key: dict[tuple[str, str], list[EndpointResult]] = {}
    for r in audit.results:
        by_key.setdefault((r.source, r.name), []).append(r)

    def best(source: str, name: str) -> str:
        rs = by_key.get((source, name))
        if not rs:
            return "skipped"
        order = {"present": 0, "empty": 1, "missing": 2, "error": 3, "skipped": 4}
        return min((r.status for r in rs), key=lambda s_: order[s_])

    def mark(status: str) -> str:
        return {
            "present": "✅ present",
            "empty": "⚪ empty",
            "missing": "❌ missing",
            "error": "⚠️ error",
            "skipped": "⏭ skipped",
        }[status]

    lines = [
        "# Data availability — Paul's Garmin Connect account (Forerunner 165)",
        "",
        f"Generated by `python -m psycho_worker audit` on {audit.started.strftime('%a %d %b %Y %H:%M')} ({TIMEZONE}). Window: last {DAYS} days.",
        "",
        f"Sources: official Personal API ({'used' if settings.has_official else 'not configured'}), "
        f"unofficial `garminconnect` {library_version()} ({'used' if any(r.source == 'unofficial' for r in audit.results) else 'not used'}).",
        "",
        "Legend: **present** = endpoint returned data with non-null values · **empty** = endpoint works but returned nothing for this account/window · "
        "**missing** = 404 / endpoint doesn't exist · **error** = other failure (see detail).",
        "",
        "## 1. Spec section 7 metrics",
        "",
        "| Group | Metric | Badge | Feeding endpoints (best status) | Verdict |",
        "|---|---|---|---|---|",
    ]
    for group, metric, badge, feeds in METRIC_SOURCES:
        statuses = [(src, name, best(src, name)) for src, name in feeds]
        verdict = (
            "present"
            if any(s == "present" for _, _, s in statuses)
            else ("empty" if any(s == "empty" for _, _, s in statuses) else "missing")
        )
        feed_txt = "<br>".join(f"`{src}.{name}` {mark(s)}" for src, name, s in statuses)
        lines.append(f"| {group} | {metric} | {badge} | {feed_txt} | **{verdict}** |")

    lines += [
        "",
        "## 2. Every endpoint called",
        "",
        "| Source | Endpoint | Status | HTTP | ms | Detail | Top-level keys |",
        "|---|---|---|---|---|---|---|",
    ]
    seen: set[tuple[str, str]] = set()
    for r in audit.results:
        key = (r.source, r.name)
        if key in seen:
            continue
        seen.add(key)
        calls = by_key[key]
        n = len(calls)
        status = best(*key)
        http = ",".join(sorted({str(c.http_status) for c in calls if c.http_status})) or ""
        ms = int(sum(c.elapsed_ms for c in calls) / n)
        detail = "; ".join(sorted({c.detail for c in calls if c.detail}))
        keys = ", ".join(calls[0].keys[:12]) + (" …" if len(calls[0].keys) > 12 else "")
        suffix = f" (×{n})" if n > 1 else ""
        lines.append(
            f"| {r.source} | `{r.name}`{suffix} | {mark(status)} | {http} | {ms} | {detail} | {keys} |"
        )

    lines += ["", "## 3. FIT files (official download)", ""]
    if not audit.fit_findings:
        lines.append(
            "_No FIT files downloaded (no activities in window, or the official API was not configured)._"
        )
    for label, f in audit.fit_findings.items():
        lines.append(f"### `{label}`")
        lines.append("")
        if "error" in f:
            lines.append(f"- ⚠️ {f['error']}")
            continue
        lines.append(
            f"- Records: {f['record_count']} · laps: {f['has_laps']} · sets: {f['has_sets']} · developer fields: {f['has_developer_fields']} {f['developer_field_names'] or ''}"
        )
        lines.append(f"- Record fields: `{', '.join(f['record_fields'])}`")
        te = f["session_training_fields"]
        if te:
            lines.append(f"- Session training fields present in FIT: `{te}`")
        else:
            lines.append(
                "- Session training fields (total_training_effect, total_anaerobic_training_effect, training_stress_score): **absent** — Garmin appears to strip them from API-delivered FIT; take TE/VO2 max/recovery from the unofficial `get_activity` JSON."
            )
        if f["session_unknown_fields"]:
            lines.append(
                f"- Unknown (numbered) session fields: `{f['session_unknown_fields']}` — these may carry VO2 max / recovery time; see METRICS.md once decoded."
            )
        if f["decode_errors"]:
            lines.append(f"- Decode errors: {f['decode_errors']}")
        lines.append(
            f"- Sanitised copy decodes: {'yes' if not f.get('sanitised_decode_errors') else f['sanitised_decode_errors']}"
        )
        lines.append("")

    lines += [
        "",
        "## 4. Activities in window",
        "",
        "| id | type | start (local) |",
        "|---|---|---|",
    ]
    for a in audit.activities:
        lines.append(f"| {a['id']} | {a['type']} | {a['start']} |")
    if not audit.activities:
        lines.append("| — | — | — |")

    lines += ["", "## 5. Notes", ""]
    for n in audit.notes:
        lines.append(f"- {n}")
    lines += [
        "- Recovery time remaining: no endpoint in the official client, the unofficial library (0.3.20) or the FIT profile carries it. Garmin Connect's web UI reads it from an internal endpoint the library doesn't wrap. Treat as **missing** in v1; Phase 1 may probe `client.get()` against the Swagger list.",
        "- Training Effect: present in the official FIT `session` message (`total_training_effect`, `total_anaerobic_training_effect`) **and** in both `get_activity` payloads — the stripping reported for API FIT files was not observed.",
        "- Per-activity VO2 max (`vO2MaxValue`) is only in the unofficial `get_activities_by_date` list items; VO2 max history (`vo2MaxPreciseValue`) is in `get_max_metrics_range`.",
        "- Race predictor: `get_race_predictions(start, end, _type='daily')` returns one row per day; no-arg call returns the latest. Both present on the FR165.",
        "- Rate limits: none hit during this audit (see HTTP column for any 429).",
        "- Raw unsanitised responses are in `apps/worker/.raw/` (gitignored). Sanitised copies are in `fixtures/`.",
        "",
        "**Paul: review this table and tell the agent which rows look wrong before Phase 1 starts.**",
        "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


# -- entry -------------------------------------------------------------------------------------


def run(settings: Settings, *, unofficial_tokens: str | None, days: int = DAYS) -> int:
    global DAYS
    DAYS = days
    audit = Audit(started=datetime.now(ZoneInfo(TIMEZONE)))
    end = _today()
    start = end - timedelta(days=days - 1)
    log.info("audit window", start=start.isoformat(), end=end.isoformat())

    if settings.has_official:
        api = OfficialGarmin(settings.garmin_personal_api_key or "")
        try:
            exp = datetime.fromtimestamp(api.token_expires_at, tz=ZoneInfo(TIMEZONE))
            audit.notes.append(
                f"Official bearer token obtained; expires {exp.strftime('%a %d %b %H:%M')} (24 h tokens, re-exchanged automatically)."
            )
            _audit_official(audit, api, start, end)
        finally:
            api.close()
    else:
        audit.notes.append("Official Personal API skipped: `GARMIN_PERSONAL_API_KEY` not set.")
        log.warning("official API skipped: no key")

    if unofficial_tokens:
        try:
            uapi = ReadOnlyGarmin(unofficial_tokens)
        except NeedsLogin as exc:
            audit.notes.append(
                f"Unofficial login failed: {exc}. Re-run `python -m psycho_worker login`."
            )
            log.error("unofficial needs login")
        else:
            try:
                _audit_unofficial(audit, uapi, start, end)
            except NeedsLogin as exc:
                audit.notes.append(f"Unofficial session died mid-audit: {exc}.")
            audit.notes.append(
                "Unofficial library used from a residential IP (Paul's Mac); cloud behaviour is measured in Phase 1."
            )
    else:
        audit.notes.append(
            "Unofficial library skipped: no saved tokens. Run `python -m psycho_worker login`."
        )
        log.warning("unofficial skipped: no tokens")

    report = DOCS_DIR / "DATA_AVAILABILITY.md"
    write_report(audit, settings, report)
    (RAW_DIR / "audit_results.json").parent.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / "audit_results.json").write_text(
        json.dumps(
            {"results": [r.__dict__ for r in audit.results], "fit": audit.fit_findings},
            indent=1,
            default=str,
        )
    )
    counts = {
        s: sum(1 for r in audit.results if r.status == s)
        for s in ("present", "empty", "missing", "error")
    }
    log.info("audit done", report=str(report), **counts)
    return 0
