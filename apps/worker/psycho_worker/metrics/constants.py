"""Athlete constants (spec §8 preamble).

HRmax: Garmin's profile value (``athlete_config.max_hr``); never changed silently.
HRrest: 7-day median of ``daily_wellness.rhr`` unless ``rest_hr_override`` is set.
LTHR: ``athlete_config.lthr``; default lower bound of Garmin zone 5, else 0.89 × HRmax.
Zone floors: Garmin's 5 floors from ``athlete_config.hr_zones.floors``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import median


@dataclass(frozen=True)
class Constants:
    hr_max: int
    hr_rest: int
    lthr: int
    zone_floors: tuple[int, int, int, int, int]
    z2_band: tuple[int, int]  # inclusive HR band for "pace at fixed HR"

    @property
    def hrr_lt(self) -> float:
        return (self.lthr - self.hr_rest) / (self.hr_max - self.hr_rest)


def derive_constants(config: dict, recent_rhr: list[int | None]) -> Constants:
    hr_max = int(config.get("max_hr") or 0)
    zones = config.get("hr_zones") or {}
    floors = [f for f in (zones.get("floors") or []) if isinstance(f, int)]
    if hr_max <= 0:
        hr_max = int(zones.get("max_hr") or 0)
    if hr_max <= 0:
        raise ValueError("HRmax is not set; nightly pulls it from Garmin's HR zones")

    if config.get("rest_hr_override"):
        hr_rest = int(config["rest_hr_override"])
    else:
        vals = [v for v in recent_rhr if isinstance(v, int) and v > 0]
        hr_rest = int(round(median(vals))) if vals else int(zones.get("rest_hr") or 50)

    lthr = config.get("lthr")
    if not lthr:
        lthr = floors[4] if len(floors) == 5 else int(round(0.89 * hr_max))

    if len(floors) != 5:
        # Garmin's default %HRmax zone floors as a fallback (50/60/70/80/90 %).
        floors = [int(round(hr_max * p)) for p in (0.5, 0.6, 0.7, 0.8, 0.9)]

    z2_band = config.get("z2_band")
    if not (isinstance(z2_band, list) and len(z2_band) == 2):
        # Default: upper half of Garmin zone 2.
        z2_band = [math.ceil((floors[1] + floors[2]) / 2), floors[2] - 1]

    return Constants(
        hr_max=hr_max,
        hr_rest=hr_rest,
        lthr=int(lthr),
        zone_floors=tuple(floors),  # type: ignore[arg-type]
        z2_band=(int(z2_band[0]), int(z2_band[1])),
    )
