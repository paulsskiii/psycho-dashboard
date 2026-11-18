# Psycho metrics

What each Psycho number means, how it is computed, and what data it uses. Garmin-badged numbers are passed through from Garmin; Psycho-badged numbers are computed here (`apps/worker/psycho_worker/metrics/`). Every formula below has a test in `apps/worker/tests/test_metrics.py`.

## Constants (`metrics/constants.py`)

| Constant | Source | Default |
|---|---|---|
| HRmax | `athlete_config.max_hr`, seeded from Garmin's HR-zone profile (207) | never changed silently; Settings flags a higher recorded max for Paul to accept |
| HRrest | 7-day median of `daily_wellness.rhr`, unless `rest_hr_override` | Garmin's resting value if no wellness yet |
| LTHR | `athlete_config.lthr` | lower bound of Garmin zone 5 (186); else 0.89 × HRmax |
| Zone floors | `athlete_config.hr_zones.floors` from Garmin (104/124/145/166/186) | 50/60/70/80/90 % of HRmax |
| Z2 band | `athlete_config.z2_band` | upper half of Garmin zone 2: ⌈(Z2 floor + Z3 floor)/2⌉ … Z3 floor − 1 (135–144) |

## Load — hrTSS via Banister TRIMP (`metrics/load.py`, spec §8.1)

Per second of HR data (from the FIT `record` stream):

```
HRr_i  = clamp((hr_i − HRrest) / (HRmax − HRrest), 0, 1)
TRIMP  = Σ (dt_i / 60) · HRr_i · 0.64 · e^(1.92 · HRr_i)
HRr_LT = (LTHR − HRrest) / (HRmax − HRrest)
hrTSS  = 100 · TRIMP / (60 · HRr_LT · 0.64 · e^(1.92 · HRr_LT))
```

- `dt_i` is the gap since the previous sample; gaps longer than 10 s are not integrated.
- One hour at exactly LTHR = 100 hrTSS (tested to ±0.5).
- No HR: `hrTSS = minutes × 0.6`, `hrtss_estimated = true` (hollow marker in the UI).
- Rides and strength use the same HR model (the FR165 has no power meter). HR under-reads lifting; `/form` can toggle strength out.
- Walks and "other" never count towards load.

**Time in zones:** each second is assigned to the highest Garmin zone whose floor it reaches (below the Z1 floor counts as Z1). 3-zone model: low = Z1+Z2, moderate = Z3, high = Z4+Z5, as % of time with HR.

## Fitness, fatigue, form (`metrics/fitness.py`, §8.2)

```
k_ctl = 1 − e^(−1/42)   k_atl = 1 − e^(−1/7)
CTL_d = CTL_{d−1} + (TSS_d − CTL_{d−1}) · k_ctl
ATL_d = ATL_{d−1} + (TSS_d − ATL_{d−1}) · k_atl
TSB_d = CTL_{d−1} − ATL_{d−1}        # form going into day d
ramp_7d = CTL_d − CTL_{d−7}
```

Seeded at 0 on the first activity day; `warming_up = true` for the first 42 days (dimmed in the UI). Verified against an independently generated 100-day reference (`fixtures/metrics/ctl_atl_reference.json`) to 0.01.

## Acute:chronic ratio (§8.3)

`acute = EWMA(TSS, λ = 2/8)`, `chronic = EWMA(TSS, λ = 2/29)`, `ACWR = acute / chronic`, null while chronic < 5. Bands: < 0.8 under-loading · 0.8–1.3 sweet spot · 1.3–1.5 caution · > 1.5 spike. The research behind ACWR is contested; it is a guide, not a rule.

## Psycho training status (§8.4)

Evaluated daily; first match wins.

| Status | Rule |
|---|---|
| Overreaching | ACWR > 1.5 or TSB < −30 |
| Detraining | CTL < 85 % of CTL 28 days ago |
| Productive | ramp_7d > 0 and (VO2 max trend or EF trend) flat-or-rising |
| Unproductive | ramp_7d > 0 and VO2 max **and** EF both falling |
| Recovering | TSB > +10 and ramp_7d ≤ 0 |
| Maintaining | everything else |

"Trend" compares the mean of the last 14 days to the mean of the 14 before (tolerance 0.5 % for VO2 max, 2 % for EF). EF trend uses outdoor, non-hilly runs only. Unknown trends (no data) count as not-falling.

## Readiness 0–100 (`metrics/readiness.py`, §8.5)

Each input is z-scored against its own trailing 28 days (excluding today; needs ≥ 7 samples and non-zero spread), clipped to ±2:

| Input | Weight | Direction |
|---|---|---|
| Overnight HRV | 0.30 | higher is better |
| Resting HR | 0.20 | lower is better |
| Sleep score (duration if no score) | 0.20 | higher is better |
| Body Battery at wake | 0.15 | higher is better |
| TSB as clamp(TSB/10, −2, 2), not z-scored | 0.15 | higher is better |

`readiness = round(clamp(50 + 25 · Σ wᵢ·zᵢ, 0, 100))`, weights renormalised over the inputs present. Shown only with ≥ 14 days of history and ≥ 3 inputs. Bands: ≥ 70 Primed · 50–69 Steady · 35–49 Hold back · < 35 Recover. `daily_load.readiness_parts` stores each input's value, 28-day mean/SD, z, % vs normal and weight, plus `band` and `verdict`.

**Verdict sentence (§8.7):** `"{Band}. HRV {n} % above/below your normal, slept {h} h {mm}. {suggestion}"`, where the suggestion comes from a fixed table of band × today's `weekly_template` session; in race week (≤ 7 days to an A race) the taper phrase replaces it. No LLM.

## Efficiency (`metrics/efficiency.py`, §8.6)

- **Efficiency factor** (runs ≥ 30 min): mean speed (m/min) ÷ mean HR over moving samples (≥ 0.5 m/s) after the first 10 min.
- **Hilly:** elevation gain > 15 m/km. Hilly and indoor runs are excluded from the EF, decoupling and pace-at-HR trend lines (shown greyed, toggleable).
- **Steady:** coefficient of variation of 30-s rolling pace after warm-up < 10 %.
- **Aerobic decoupling** (steady runs ≥ 45 min): post-warm-up portion split into two equal-time halves; `(EF₁ − EF₂) / EF₁ × 100`. < 5 % = durable. A synthetic run with 8 % linear HR drift gives ≈ 3.8 % (tested).
- **Pace at fixed HR:** median pace (s/km) of moving samples with HR inside the Z2 band, requiring ≥ 8 min inside the band.
- **Drifted hard:** a run with no attached workout and not an interval type, with ≥ 30 % of time in Z3+.

## Races (`metrics/races.py`, §8.7)

- **Riegel:** `T₂ = T₁ · (D₂/D₁)^1.06`, from the best effort ≥ 5 km in the last 60 days (the effort giving the fastest prediction). Shown beside Garmin's predictor, never averaged.
- **Goal gap:** predicted − goal, in seconds and s/km.

## Where it runs

`metrics/engine.py` → `recompute(store, from_date)`: computes `activity_metrics` for activities on/after `from_date` whose streams are newer than their metrics (or all with `--all`), then rebuilds the whole `daily_load` series from the first activity to today (one row per day). Called by every `sync` (from the earliest changed day), by `nightly` (last 120 days) and by `python -m psycho_worker metrics [--since DATE] [--all]`. Changing HRmax, HRrest, LTHR or the Z2 band in Settings triggers `--all`.
