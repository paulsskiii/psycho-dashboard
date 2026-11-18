# PSYCHO — Build Specification

> Personal Garmin training dashboard for Paul. This document is the complete brief for an autonomous build agent (Claude Fable). Read it end to end before writing any code.
>
> Spec version 1.2 · written 16 Nov 2026 · owner: Paul (GitHub `paulsskiii`) · timezone `Asia/Manila`

---

## 0. How to use this spec (agent operating rules)

You are building a production-quality, single-user web app from this spec. Follow these rules for the whole build:

1. **Work phase by phase** (section 14). Don't start a phase until the previous phase's acceptance criteria pass. At the end of each phase, commit and append a short entry to `PROGRESS.md`: what was built, what was verified and how, and any open issues.
2. **Verify, don't assume.** Garmin endpoints, library versions and field names change. Before relying on any endpoint or library method named here, confirm it exists by calling it or reading the current docs or source. Section 3 lists what was true on 16 Nov 2026. Treat it as a map, not a guarantee.
3. **Stop and ask Paul** before:
   - anything that needs his credentials, MFA codes, API keys or a paid plan;
   - deleting or overwriting data in Garmin Connect (this app is **read-only** towards Garmin);
   - deviating from the design direction in section 9;
   - adding a dependency that costs money.
4. **Never commit secrets.** Use `.env.local` / platform secret stores, and keep `.env*` and token files in `.gitignore`. Garmin tokens are equivalent to a password.
5. **Look at your own UI.** After every UI step, take screenshots at 390×844 (mobile) and 1440×900 (desktop), critique them against sections 9 and 10, and fix what's wrong before moving on.
6. **If you have the `frontend-design` and `dataviz` skills available, load them** before building UI or charts. Appendix A and B condense their rules for when you don't.
7. **Run the palette validator** (Appendix B.4) whenever you touch chart colours.

---

## 1. Product summary

**Psycho** is Paul's private training dashboard. It shows everything Garmin Connect shows from his **Garmin Forerunner 165**, but with better visuals and with advanced metrics that Garmin Connect doesn't compute for this watch.

- **User:** one person (Paul), a hybrid athlete: running 3–4×/week, gym 5×/week, cycling starting in early 2027 for a duathlon.
- **Primary moment of use:** on his phone, after waking up ("how ready am I?") and after a workout ("how did that go?"). Desktop is for weekly review.
- **Primary job:** tell Paul at a glance whether he's fit, fatigued or fresh, and whether his training is on track for his races.
- **Freshness:** near-real-time. New data appears within about 30 minutes of the watch syncing to Garmin Connect, or within about 2 minutes of pressing **Sync now**.
- **Running cost: ₱0/month.** Every hosted piece must stay on a free tier (section 13). Ask Paul before anything that would cost money.

### 1.1 Current goals (seed values for `athlete_config.goals`; all editable in Settings)

| Goal | Value |
|---|---|
| Next race | Garmin Run Philippines 2026, 21.1 km, **13 Dec 2026**, goal **sub-2:00** (5:41 /km) |
| Half marathon best | 2:17:57 (HOKA Midnight Run 21K) |
| 10 km best | 56:04 (25 Oct 2026) |
| Following race | Duaman Duathlon 2027, Full Distance, Individual (Clark), date TBC |
| Longer-term | sub-4:00 full marathon |
| Body | target weight ~64 kg |

### 1.2 Non-goals (v1)

- No writing back to Garmin (no workouts, courses or weigh-ins pushed). The official Personal API is read-only anyway.
- No AI coach or LLM text generation. Paul declined it for v1. Verdict sentences are rule-based (section 8.7).
- No multi-user support, no social features, no Strava.
- No live in-workout streaming (see 3.4).

---

## 2. Watch capability reality check (Forerunner 165)

Design every panel around what the FR165 actually records. **The FR165 does not compute** Garmin's Training Readiness, Training Status, Acute/Training Load, Load Focus, Endurance Score or Hill Score. Psycho computes its own equivalents from raw data (section 8), and labels them as Psycho's estimates rather than Garmin's.

**The FR165 does record** (and Garmin Connect shows): VO2 max (running), recovery time, aerobic/anaerobic Training Effect, race predictor, HRV status (overnight HRV + baseline), sleep score and stages, Body Battery, stress, resting HR, respiration, Pulse Ox (if enabled), steps, wrist running power, wrist running dynamics, GPS, and per-second HR in activities.

**Forward-compatibility rule:** the sync worker must also *attempt* to fetch Garmin's native Training Readiness, Training Status and Endurance/Hill score. It should store them when present and silently skip them when empty. If Paul upgrades his watch, the UI should show Garmin's native value next to Psycho's estimate without code changes.

Phase 0 must produce `docs/DATA_AVAILABILITY.md`: a table of every field this spec uses, marked *present / empty / missing* for Paul's real account. Build the UI from that table, not from assumptions.

---

## 3. Data sources

### 3.1 Strategy: hybrid

| Layer | Source | Why |
|---|---|---|
| Primary | **Garmin Connect Personal API** (official) | Stable and supported. Read-only, pull-only. Activities (JSON + original FIT), health data (JSON). |
| Secondary | **`garminconnect` Python library** (unofficial, `cyberjunky/python-garminconnect`) | Fills gaps: VO2 max history, race predictions, personal records, splits, HR-in-zones, Training Effect fields, weather, and native readiness/status if the watch ever supports them. |
| Derived | **Psycho metrics engine** (our code) | Load, fitness/fatigue/form, readiness, efficiency, intensity distribution, all computed from FIT records + daily wellness. |

**Resilience requirement:** the derived metrics depend only on official data (FIT files + daily wellness). If the unofficial library breaks (Garmin changes login, 401/429), the dashboard keeps working. Panels fed only by unofficial data show a quiet "Last updated <time>" state. Nothing crashes.

### 3.2 Official Personal API (facts as of Nov 2026)

- **Key creation (Paul does this):** Garmin Connect web → Settings → Personal API token (`https://connect.garmin.com/app/settings/personalApiToken`; the menu name may differ slightly). Recommend the 1-year expiry. Keys expire after 30, 90, 180 or 365 days, and Garmin can revoke them.
- **Token exchange:** `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token` with header `Authorization: ApiKey <key>`. Returns a bearer access token valid for **24 h**. There are no refresh tokens, so request a new one when it expires or on a 401. **Cache the access token** (with its expiry) in Supabase Vault as `garmin_personal_access_token`, so the 30-min job doesn't exchange the key every run.
- **Official Python client:** `garmin-connect-personal-api-python` (repo `garmin/connect-personal-api-python`, Python ≥ 3.12). Use it.
- **Endpoint reference:** Swagger at `https://developer.garmin.com/gc-developer-program/personal/swagger-docs/`. Read it in phase 0, because it's the source of truth.
- **Client methods known to exist** (all GET):

| Method | Path |
|---|---|
| `search_activities(start, limit, start_date, end_date, activity_type)` | `/activitylist-service/activities/search/activities` |
| `get_activity(id)` | `/activity-service/activity/{id}` |
| `get_activity_workouts(id)` | `/activity-service/activity/{id}/workouts` |
| `download_activity(id)` | `/download-service/files/activity/{id}` (ZIP containing the original FIT) |
| `get_daily_summaries(start, end)` | `/usersummary-service/v2/dailysummaries` |
| `get_daily_sleep(date)` / `get_daily_sleep_summaries(start, end)` | `/sleep-service/sleep/...` |
| `get_daily_hrv(date)` / `get_daily_hrv_summaries(start, end)` | `/hrv-service/hrv/...` |
| `get_daily_body_battery(start, end)` | `/wellness-service/wellness/bodyBattery/reports/daily` |
| `get_daily_stress(start, end)` | `/usersummary-service/stats/stress/daily/{start}/{end}` |
| `get_daily_heart_rate(date)` | `/wellness-service/wellness/dailyHeartRate` |
| `get_daily_spo2(date)` | `/wellness-service/wellness/daily/spo2acclimation/{date}` |
| `get_heart_rate_zones()` | `/biometric-service/heartRateZones/v2` |
| `get_weight_measurements(start, end)` | `/weight-service/weight/range/{start}/{end}` |
| `get_fitness_age(date)` | `/fitnessage-service/fitnessage/v2/{date}` |
| `get_user_profile_settings()` | `/userprofile-service/userprofile/settings` |
| `client.get(path, params)` | any other Swagger endpoint |

- **Unknowns to measure in phase 0:** rate limits (undocumented), how far back history goes, and whether the FIT files are complete. Garmin has been reported to strip undocumented fields such as VO2 max, Training Effect and recovery time from API-delivered files. If they're stripped, take those values from the unofficial JSON instead.
- **Terms:** personal, non-commercial use for your own data only. Psycho complies.

### 3.3 Unofficial `garminconnect` library

- Version on 16 Nov 2026: **0.3.20** (Python ≥ 3.12). Pin the version and verify method names against the installed source.
- **Auth:** mobile-app SSO → DI OAuth bearer + refresh token, auto-refreshed. Tokens are stored as `garmin_tokens.json`. MFA is supported through `return_on_mfa=True` → `resume_login(state, code)`.
- **Methods Psycho uses:**
  - `get_max_metrics_range(start, end)` / `get_max_metrics(date)`: VO2 max
  - `get_race_predictions(start, end)`
  - `get_personal_record()`
  - `get_activity(id)`: Training Effect, VO2 max per activity, recovery time
  - `get_activity_splits(id)`, `get_activity_typed_splits(id)`, `get_activity_hr_in_timezones(id)`
  - `get_activity_weather(id)` if present
  - `get_respiration_data(date)`
  - `get_body_composition(start, end)`
  - `get_device_last_used()`: last watch sync time
  - Forward-compat (expected empty on FR165): `get_training_readiness(date)`, `get_training_status(date)`, `get_endurance_score(...)`, `get_hill_score(...)`
- **Login policy:** never store Garmin's password in the cloud. Ship a local CLI (`python -m psycho_worker login`) that Paul runs on his Mac once. It handles MFA interactively and uploads the token JSON to the secret store (3.5). If the refresh token later dies, the UI shows "Garmin sign-in needed — run the login command" in Settings.
- **Cloud IP risk:** GitHub Actions runs on datacenter IPs, and Garmin sometimes rate-limits or blocks unofficial traffic from them. Mitigations, in order:
  1. The cloud never does a fresh login; it only refreshes tokens.
  2. In the 30-min `sync`, call unofficial endpoints only for **new activities** plus `get_device_last_used`. Everything else unofficial (VO2 max, predictions, PRs, body comp, respiration) runs once in `nightly`.
  3. If unofficial calls return 429/403 three nightly runs in a row, Settings suggests running `python -m psycho_worker nightly` on the Mac instead. Make that command work locally with the same code.
- **Write methods are forbidden.** The library can upload, edit and delete. Psycho must never call those methods. Enforce this by importing the client through a thin `ReadOnlyGarmin` wrapper that exposes only an allowlist of read methods.

### 3.4 "Real-time": what's actually possible

- No Garmin cloud API streams live data. Data exists in the cloud only after the watch syncs to Garmin Connect (via phone, roughly every few minutes when connected, and immediately after saving an activity).
- **Psycho's freshness model:** a GitHub Actions job syncs every **30 min**. A **Sync now** button triggers the same job on demand, and it finishes in about 1–2 min. **Supabase Realtime** pushes new rows to the open dashboard, so tiles update without a reload.
- GitHub's scheduled runs can start several minutes late. That's acceptable. Never shorten the interval to compensate (see 6.3).
- Live HR during a workout would need ANT+ (the FR165 broadcasts HR over ANT+, not Bluetooth), and a browser can't receive that. **Out of scope.** Show "Last watch sync" in the header so Paul always knows how fresh the data is.

### 3.5 Secrets

| Secret | Where it lives |
|---|---|
| Garmin Personal API key | GitHub Actions repository secret `GARMIN_PERSONAL_API_KEY` |
| Unofficial Garmin tokens | Supabase Vault secret `garmin_unofficial_tokens`, read/written by the worker via service role only |
| Supabase service role key | GitHub Actions secret `SUPABASE_SERVICE_ROLE_KEY` only. Never shipped to the browser, never in Vercel. |
| GitHub fine-grained token (Actions: write, this repo only) | Vercel server env `GITHUB_DISPATCH_TOKEN`. Used only by the Sync now server action. |
| Supabase anon key + URL | Next.js env (public) |

Settings page shows **Personal API key expiry** and **GitHub dispatch token expiry** as countdowns, with a warning 14 days before either expires. Paul enters both expiry dates in Settings when he creates them. `docs/SETUP.md` explains how to renew each one.

**Vault access:** expose Vault only through `security definer` SQL functions (`get_secret(name)`, `set_secret(name, value)`). Grant execute to `service_role` only, and revoke it from `anon` and `authenticated`.

**Logs:** GitHub Actions logs are kept and readable by anyone with repo access. The worker must never print tokens, keys, raw API responses, GPS coordinates or health values. Call `::add-mask::` on every secret loaded at runtime (including the tokens read from Vault). Log only counts, durations and status codes.

---

## 4. Architecture

```
 FR165 ──sync──▶ Garmin Connect cloud
                      │  (pull)
           ┌──────────┴───────────┐
           │  psycho-worker (Py)  │  GitHub Actions job (private repo)
           │  • cron every 30 min │  + nightly cron
           │  • workflow_dispatch │  ← Sync now button (via Vercel)
           │  • FIT parsing       │
           │  • metrics engine    │
           └──────────┬───────────┘
                      │ upsert (service role)
           ┌──────────▼───────────┐
           │  Supabase            │  Postgres + Storage(fit/) + Vault + Realtime + Auth
           └──────────┬───────────┘
                      │ RLS-protected reads + Realtime
           ┌──────────▼───────────┐
           │  psycho-web (Next.js)│  Vercel; App Router; PWA
           └──────────────────────┘
```

**Monorepo layout**

```
psycho/
  apps/web/            Next.js (TypeScript strict)
  apps/worker/         Python 3.12 package psycho_worker
  packages/tokens/     design tokens (JSON → CSS vars + TS)
  supabase/migrations/ SQL migrations
  docs/                DATA_AVAILABILITY.md, METRICS.md, DECISIONS.md
  fixtures/            sanitized sample Garmin JSON + 2 FIT files for tests
  PROGRESS.md
```

**Stack** (use the current stable versions and record them in `DECISIONS.md`):

- **Web:** Next.js App Router, React Server Components for reads, `@supabase/ssr`, D3 (`d3-scale`, `d3-shape`, `d3-array`) with hand-built React SVG charts (no chart kit, so the specs in Appendix B can be followed exactly), MapLibre GL JS for activity maps, GSAP for the single orchestrated intro (section 9.6), `next/font` for self-hosted fonts.
- **Worker:** `garmin-connect-personal-api-python`, `garminconnect` (pinned), `garmin-fit-sdk` (Garmin's official FIT SDK for Python; verify the package name), `numpy`, `pandas`, `psycopg` or `supabase-py`, `tenacity` (backoff), `pytest`. No scheduler library: GitHub Actions does the scheduling. The worker is a CLI: `python -m psycho_worker sync|nightly|backfill|login`.
- **Auth:** Supabase Auth, email OTP. Sign-up disabled; only Paul's email is allowed (owner email set in env `OWNER_EMAIL`, never hard-coded in the client bundle). Use long-lived sessions (refresh token rotation on, default long expiry) so Paul rarely signs in again. Supabase's built-in email sender is rate-limited on the free plan, which is fine for one user, but say so in `docs/SETUP.md`.

---

## 5. Data model (Postgres)

Every table has RLS enabled. Policy: `select` allowed when `auth.uid() = (select owner_id from athlete_config)`. Writes happen only through the service role (worker) or server actions validated as the owner.

The Supabase project was created with **"Automatically expose new tables" off** and **automatic RLS on**. So every migration must explicitly `GRANT SELECT` to `authenticated` on the tables the web app reads (plus `UPDATE` on `athlete_config` and `INSERT` on `sync_requests` for owner server actions). Grant nothing to `anon`. Writes from the worker use `service_role`.

```sql
athlete_config (id int pk default 1 check (id=1), owner_id uuid, timezone text default 'Asia/Manila',
  max_hr int, rest_hr_override int, lthr int, hr_zones jsonb,           -- zones from Garmin, overridable
  goals jsonb, weekly_template jsonb, personal_api_key_expires_at timestamptz,
  github_token_expires_at timestamptz, updated_at timestamptz)

activities (id bigint pk,                      -- Garmin activityId
  start_utc timestamptz, start_local timestamp, sport text check (sport in ('run','ride','strength','walk','other')),
  garmin_type text, name text, duration_s int, moving_s int, distance_m real, elev_gain_m real,
  avg_hr int, max_hr int, avg_speed_mps real, avg_cadence real, avg_power real, calories int,
  aerobic_te real, anaerobic_te real, te_label text, vo2max real, recovery_time_h real,
  weather jsonb, has_gps bool, fit_path text, raw_official jsonb, raw_unofficial jsonb,
  synced_at timestamptz)

activity_streams (activity_id bigint pk references activities,
  t int[], dist real[], hr int[], speed real[], cadence real[], power real[], alt real[],
  lat double precision[], lon double precision[],     -- full-resolution
  chart jsonb)                                          -- downsampled ≤ 800 pts/channel for the UI

activity_laps (activity_id bigint, idx int, kind text check (kind in ('lap','km','mile')),
  start_s int, duration_s int, distance_m real, avg_hr int, max_hr int, avg_speed_mps real,
  avg_cadence real, elev_gain_m real, primary key (activity_id, kind, idx))

activity_metrics (activity_id bigint pk, trimp real, hrtss real, hrtss_estimated bool,
  zone_s int[5], low_pct real, mod_pct real, high_pct real, ef real, decoupling_pct real,
  pace_at_hr_s_per_km real, steady bool, drifted_hard bool, hilly bool, computed_at timestamptz)

daily_wellness (date date pk, rhr int, hrv_night_avg real, hrv_7d_avg real, hrv_baseline_low real,
  hrv_baseline_high real, hrv_status text, sleep_score int, sleep_s int, deep_s int, light_s int,
  rem_s int, awake_s int, bb_wake int, bb_high int, bb_low int, bb_charged int, bb_drained int,
  stress_avg int, respiration_avg real, spo2_avg real, steps int, vo2max real, fitness_age real,
  native_readiness int, native_training_status text, raw jsonb, synced_at timestamptz)

daily_load (date date pk, tss_total real, tss_run real, tss_ride real, tss_strength real,
  ctl real, atl real, tsb real, acwr real, ramp_7d real, psycho_status text,
  readiness int, readiness_parts jsonb, warming_up bool)

race_predictions (date date pk, k5_s int, k10_s int, hm_s int, m_s int)
personal_records (type text pk, value real, activity_id bigint, achieved_on date)
weigh_ins (ts timestamptz pk, weight_kg real, body_fat_pct real, muscle_kg real, bone_kg real, water_pct real)
sync_runs (id bigserial pk, started_at timestamptz, finished_at timestamptz, trigger text,
  status text, source_status jsonb, counts jsonb, error text)
sync_requests (id bigserial pk, requested_at timestamptz default now(), handled_at timestamptz)
```

Raw FIT files go to the Supabase Storage bucket `fit/` (private) as `fit/{activity_id}.fit`.

Add an `indoor bool` column to `activities` (treadmill, indoor bike, gym). Set it from Garmin's activity type and the absence of GPS.

**`goals` shape (seed from 1.1):**

```json
{
  "races": [
    {"name": "Garmin Run Philippines", "date": "2026-12-13", "sport": "run", "distance_m": 21097, "goal_s": 7200, "priority": "A"},
    {"name": "Duaman Duathlon", "date": null, "sport": "duathlon", "distance_m": null, "goal_s": null, "priority": "A"}
  ],
  "bests": {"hm_s": 8277, "k10_s": 3364},
  "long_term": [{"label": "Full marathon", "goal_s": 14400}],
  "target_weight_kg": 64
}
```

**`weekly_template` shape** (Paul's current split, editable in Settings; feeds the Today verdict and a plan-vs-done strip):

```json
{"mon": ["easy_run", "gym_upper"], "tue": ["intervals", "gym_legs"], "wed": ["gym_upper"],
 "thu": ["tempo", "prehab"], "fri": ["gym_upper"], "sat": ["long_run_or_rest"], "sun": ["long_run_or_rest"]}
```

**Dates and time zones:** all daily rollups (`daily_load`, weekly totals, "today") use the **Asia/Manila** calendar day. An activity belongs to the local date of its start. Cron expressions are in UTC; convert carefully.

Enable Realtime on `activities`, `daily_wellness`, `daily_load` and `sync_runs`.

---

## 6. Sync worker

### 6.1 Loops

| Loop | Cadence | Work |
|---|---|---|
| Incremental (`sync`) | cron `*/30 * * * *` (UTC) + `workflow_dispatch` | Re-pull wellness for **today and yesterday** (Garmin revises them). Search activities since the newest stored `start_utc` minus 2 days. For each new or changed activity: summary → FIT download → parse → streams + laps → unofficial enrichments → metrics → recompute `daily_load` from the earliest affected date forward. |
| Sync now | on demand | The web app's server action first verifies the caller is the signed-in owner, then checks `sync_requests`. If the last request is < 2 min old, it returns "Already syncing". Otherwise it inserts a row and calls `POST /repos/{owner}/{repo}/actions/workflows/sync.yml/dispatches`. The job marks the row handled. Use a workflow `concurrency` group so two syncs never overlap. |
| Nightly (`nightly`) | cron `30 19 * * *` UTC (= 03:30 Asia/Manila) | Pull VO2 max, race predictions, PRs, weigh-ins and HR zones. Re-run the 3-day wellness window. Full `daily_load` recompute for the last 120 days. |
| Backfill (`backfill`) | once, **run on Paul's Mac**, resumable | Walk back month by month to the earliest data (target ≥ 18 months), checkpointing in `sync_runs.counts`. Run slowly. It runs locally so it doesn't spend GitHub minutes. |

### 6.2 Politeness and errors

- Global rate limiter: **≤ 1 request/s** per source, with an extra 2 s pause between FIT downloads.
- On 429 or 5xx: exponential backoff with jitter (2, 4, 8 … max 300 s), max 5 tries, then mark that source `degraded` in `sync_runs.source_status` and move on.
- On 401 (official): fetch a new token once, then retry. On 401 (unofficial): try a refresh once. If that fails, mark `needs_login` and stop calling unofficial until Paul re-runs the login CLI.
- Every run writes one `sync_runs` row. A run must never partially write an activity: use a transaction per activity.
- Idempotent: re-running any window yields identical rows.

### 6.3 GitHub Actions budget (keeps it free)

The repo is **private**, so it gets **2,000 free Actions minutes/month** (GitHub Free plan). GitHub bills each job rounded up to the whole minute.

| Use | Estimate |
|---|---|
| `sync` every 30 min (48/day × 31 days, ~1 min each) | ~1,490 min |
| `nightly` (31 × ~2 min) | ~60 min |
| Sync now presses (~5/day) | ~155 min |
| **Total** | **~1,700 min**, leaving ~300 min of headroom |

Rules:
- Keep each `sync` job **under 60 s**: cache pip with `actions/setup-python` cache, and skip work when nothing changed.
- Put `timeout-minutes: 5` on `sync` and `10` on `nightly`.
- `sync` and `nightly` share **one** `concurrency` group (`psycho-garmin`, `cancel-in-progress: false`), so two jobs never refresh Garmin tokens at the same time.
- A job exits non-zero **only** on a real failure (DB unreachable, official API down after retries, code error). A degraded unofficial source is not a failure. That way GitHub's automatic failure emails stay meaningful and work as Paul's alert.
- **CI must not eat the budget.** Run lint, typecheck and pytest only on pull requests and manual dispatch, never on every push. Run Playwright and Lighthouse locally, not in Actions.
- Add a monthly usage check to Settings: read the Actions billing API if the token allows it, otherwise show the count of `sync_runs` this month × the average duration. Warn above 1,800 min.
- If the budget is ever exceeded, fall back to a 60-min cron. **Never** make the repo public to get unlimited minutes, because fixtures and logs may contain personal data.
- GitHub can disable scheduled workflows in repos with no activity. If `sync_runs` shows no scheduled run for 3 h, Settings shows "Scheduled sync is paused. Open GitHub Actions and re-enable it."

### 6.4 FIT parsing

- Parse the `record` messages into the arrays in `activity_streams` (convert semicircles to degrees, m/s, bpm).
- Parse `lap` messages into `activity_laps(kind='lap')`. Compute `kind='km'` splits from distance.
- Keep developer fields (wrist running dynamics, power) when present. Don't fail on unknown fields.
- Downsample `chart` with Largest-Triangle-Three-Buckets to ≤ 800 points per channel. Keep peaks.
- Strength activities: if Garmin logged exercise sets (`set` messages / unofficial `get_activity_exercise_sets` if available), store them in `raw_unofficial`.

---

## 7. Metric glossary: what Paul sees

Every metric shows a source badge: **Garmin** (measured or computed by Garmin) or **Psycho** (computed here, an estimate). Tapping a metric opens a sheet with a one-paragraph plain-English definition, the formula and the data it used.

| Group | Metric | Source |
|---|---|---|
| Recovery | Overnight HRV (+ 7-day avg, baseline band, status) | Garmin |
| Recovery | Sleep score, duration, stages | Garmin |
| Recovery | Resting HR | Garmin |
| Recovery | Body Battery at wake, charged/drained | Garmin |
| Recovery | Stress average, respiration, SpO2 | Garmin |
| Recovery | Recovery time remaining | Garmin |
| Training | VO2 max trend | Garmin |
| Training | Training Effect (aerobic/anaerobic, label) | Garmin |
| Training | hrTSS per activity, daily load by sport | Psycho |
| Training | Fitness (CTL), Fatigue (ATL), Form (TSB) | Psycho |
| Training | Acute:chronic ratio, 7-day ramp | Psycho |
| Training | Training status (Productive / Maintaining / Recovering / Overreaching / Detraining / Unproductive) | Psycho |
| Training | Readiness 0–100 | Psycho |
| Efficiency | Efficiency factor (speed per heartbeat) | Psycho |
| Efficiency | Aerobic decoupling % | Psycho |
| Efficiency | Pace at fixed HR | Psycho |
| Intensity | Weekly low / moderate / high time, 80/20 check | Psycho (zones from Garmin) |
| Intensity | "Drifted hard" easy runs | Psycho |
| Races | Garmin race predictor 5K / 10K / HM / M | Garmin |
| Races | Riegel prediction from recent bests | Psycho |
| Races | Goal pace gap, countdown, PB board | Psycho |
| Activity | Map, splits, pace/HR/cadence/elevation/power, HR zones, weather | Garmin data |
| Body | Weight + 7-day average vs target, body comp | Garmin |

---

## 8. Metrics engine: formulas (implement in `psycho_worker/metrics/`, document in `docs/METRICS.md`)

Constants come from `athlete_config`: `HRmax` (Garmin profile/zones value; if a recorded activity max is higher, flag it in Settings for Paul to accept, but never change it silently) and `HRrest` (resting HR = 7-day median `rhr` unless overridden), `LTHR` (default: the lower bound of Garmin zone 5, or 0.89 × HRmax if zones are missing; editable).

### 8.1 Load: hrTSS via Banister TRIMP (per second, from FIT `hr`)

```
HRr_i  = clamp((hr_i − HRrest) / (HRmax − HRrest), 0, 1)
TRIMP  = Σ (dt_i / 60) · HRr_i · 0.64 · e^(1.92 · HRr_i)
HRr_LT = (LTHR − HRrest) / (HRmax − HRrest)
hrTSS  = 100 · TRIMP / (60 · HRr_LT · 0.64 · e^(1.92 · HRr_LT))
```

- Gaps longer than 10 s in HR: don't integrate across them.
- No HR data: `hrTSS = duration_min × 0.6` and `hrtss_estimated = true`, shown with a hollow marker.
- Rides use the same HR model (the FR165 doesn't support power meters).
- Strength sessions also use the HR model. HR-based load under-reads lifting, so the info sheet says so, and `/form` can toggle strength out of the load chart.

### 8.2 Fitness, fatigue, form

```
k_ctl = 1 − e^(−1/42),  k_atl = 1 − e^(−1/7)
CTL_d = CTL_{d−1} + (TSS_d − CTL_{d−1}) · k_ctl
ATL_d = ATL_{d−1} + (TSS_d − ATL_{d−1}) · k_atl
TSB_d = CTL_{d−1} − ATL_{d−1}            # form going into day d
ramp_7d = CTL_d − CTL_{d−7}
```

Days without activities have TSS 0. Seed both at 0 at the start of history and set `warming_up = true` for the first 42 days. The UI dims those days and says why.

### 8.3 Acute:chronic ratio (EWMA)

`acute = EWMA(TSS, λ = 2/(7+1))`, `chronic = EWMA(TSS, λ = 2/(28+1))`, `ACWR = acute / chronic` (null if chronic < 5). Guide bands: < 0.8 under-loading, 0.8–1.3 sweet spot, 1.3–1.5 caution, > 1.5 high spike. The info sheet must say that the research on ACWR is contested and that it's a guide, not a rule.

### 8.4 Psycho training status (evaluated daily, first matching rule wins)

| Status | Rule |
|---|---|
| Overreaching | ACWR > 1.5 **or** TSB < −30 |
| Detraining | CTL fell > 15 % over 28 days |
| Productive | ramp_7d > 0 and VO2 max (or EF 28-day trend) flat-or-rising |
| Unproductive | ramp_7d > 0 and VO2 max **and** EF both falling over 28 days |
| Recovering | TSB > +10 and ramp_7d ≤ 0 |
| Maintaining | everything else |

### 8.5 Readiness (0–100)

Each input becomes a z-score against its own trailing 28-day mean and standard deviation (excluding today), clipped to ±2:

| Input | Weight | Direction |
|---|---|---|
| Overnight HRV avg | 0.30 | higher is better |
| Resting HR | 0.20 | lower is better |
| Sleep score (or duration if score missing) | 0.20 | higher is better |
| Body Battery at wake | 0.15 | higher is better |
| TSB, mapped as clamp(TSB/10, −2, 2) (not z-scored) | 0.15 | higher is better |

`readiness = round(clamp(50 + 25 · Σ wᵢ·zᵢ, 0, 100))`. Renormalise the weights over the inputs that are present. Show it only when ≥ 14 days of history exist and ≥ 3 inputs are present today.

Bands: **≥ 70 Primed · 50–69 Steady · 35–49 Hold back · < 35 Recover**. Store each component in `readiness_parts` so the UI can explain the score ("HRV 12 % above your normal, sleep short").

### 8.6 Efficiency and intensity

- **Efficiency factor (runs ≥ 30 min):** `EF = mean speed (m/min) / mean HR` over moving samples after the first 10 min. Mark the run `hilly` if elevation gain > 15 m/km. Exclude hilly runs and **indoor/treadmill runs** (wrist-estimated pace is unreliable) from the EF, decoupling and pace-at-HR trend lines. Show them greyed, with a toggle to include them. Plot EF against air temperature when weather exists, because heat drives HR in Manila.
- **Aerobic decoupling (runs ≥ 45 min that are `steady`):** a run is `steady` if, after warm-up, the coefficient of variation of 30-s rolling pace is < 10 %. Split the post-warm-up portion into two equal-time halves: `decoupling % = (EF₁ − EF₂) / EF₁ × 100`. < 5 % = durable.
- **Pace at fixed HR:** the median pace of moving samples with HR inside a fixed band (default: the upper half of Garmin zone 2; editable), for runs with ≥ 8 min inside the band. Plot it weekly.
- **Zones:** time in Garmin's 5 HR zones per activity. 3-zone model: low = Z1+Z2, moderate = Z3, high = Z4+Z5. **80/20 check:** the weekly low share across runs and rides ≥ 80 % is "on target".
- **Drifted hard:** a run not tagged as a structured workout (no workout attached, and not an interval-type activity) with ≥ 30 % of its time in Z3+.

### 8.7 Races

- **Riegel:** `T₂ = T₁ · (D₂/D₁)^1.06`, using the best effort in the last 60 days at ≥ 5 km. Show it alongside Garmin's race predictor. Never average the two.
- **Goal gap:** the predicted HM time vs the goal, in seconds and in s/km, with the trend since the last 4 weeks.
- **Verdict sentence (Today hero), rule-based.** Example template: `"{band}. HRV {vs normal}, {sleep phrase}. {suggestion}."`. Suggestions come from readiness band × today's session in `weekly_template` (for example Primed + tempo → "Good day for the tempo."; Hold back + intervals → "Swap the intervals for an easy run."). If no session is planned, use the readiness band alone. In race week (≤ 7 days to an A race), use taper phrasing. Keep a fixed phrase table in code. No LLM.

### 8.8 Tests (pytest, required)

- Hand-computed TRIMP and hrTSS for a synthetic 60-min constant-HR session at LTHR (hrTSS = 100 ± 0.5).
- CTL/ATL/TSB on a synthetic 100-day series against reference values computed in a notebook and saved as a fixture.
- Decoupling on a synthetic run with known drift.
- Readiness renormalisation when inputs are missing.
- Real FIT fixtures parse with no exceptions.

---

## 9. Design direction

### 9.1 Brief

Paul chose **warm dark luxury**, in the manner of the studio The First The Last (Jesko Jets, Son Daven, DaVincii on Awwwards). Those sites share:

- two-colour palettes of dark warm brown or charcoal with cream or khaki (#312726 / #FFF8ED, #2C2824 / #A89474, #1D1D1D / #918B7E);
- a cinematic preloader;
- one strong homepage animation;
- unhurried scroll storytelling;
- GSAP / WebGL craft.

Psycho borrows that **material and restraint**, not their marketing-site behaviour. It's a tool used daily on a phone: fast, legible and calm, with exactly one cinematic moment.

### 9.2 The one memorable thing

**The route line.** The Today hero draws the GPS line of Paul's most recent outdoor activity as a single continuous parchment stroke across the dark page. It's drawn once on load (section 9.6) and sits behind the readiness figure and verdict. If the latest activity has no GPS (gym, treadmill), use that day's **heart-rate trace** as the line instead. Everything else on the page stays quiet so this can be loud.

### 9.3 Colour tokens (validated on 16 Nov 2026; contrast measured against `surface`)

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `page` | `#1C1613` | Page plane (espresso) | — |
| `surface` | `#231C18` | Chart and content surface (walnut) | — |
| `raised` | `#2B231E` | Sheets, nav bar, hover wash | — |
| `rule` | `#3A302A` | Gridlines, hairline dividers | 1.31 (recessive by design) |
| `axis` | `#4F443C` | Baselines and axes | 1.78 |
| `ink` | `#F2E8D8` | Primary text (parchment) | 13.8:1 |
| `ink-2` | `#C9BBA5` | Secondary text (oat) | 8.9:1 |
| `ink-3` | `#A89474` | Muted text, labels (khaki, from Son Daven) | 5.7:1 |
| `ink-4` | `#8C7B66` | Disabled, tertiary only | 4.1:1 |
| `brass` | `#CDA448` | Interactive accent: focus ring, selected state, route line glow | — |

Rules:

- No pure black and no cool greys. Everything carries the brown undertone.
- No terracotta or clay accent. The brass accent is used sparingly: selection, focus, one highlight per view.
- No gradients as decoration, and no drop shadows. Depth comes only from the `page → surface → raised` tone steps.
- Optional film grain: an SVG `feTurbulence` overlay at 3–4 % opacity on `page` only, disabled under `prefers-reduced-motion` and on low-end devices.

### 9.4 Data colours (run through the dataviz validator; see Appendix B.4 to re-run)

**Categorical** (sports and sleep stages). Fixed order, never cycled:

| Slot | Name | Hex | Used for |
|---|---|---|---|
| 1 | brass | `#B18827` | Run |
| 2 | slate | `#4F91E2` | Ride |
| 3 | sage | `#007E68` | Strength |
| 4 | lavender | `#9A7FD6` | Other / walk |

Validator result (dark, surface `#231C18`): 4 slots, adjacent pairs → PASS. Worst CVD ΔE 16.7, worst normal-vision ΔE 19.8, all ≥ 3:1. The first 3 slots also pass `--pairs all` (CVD 12.0, normal 19.7), so scatter plots may use at most 3 categories.

Sleep stages use the same four slots in the order deep = slate, light = brass, REM = lavender, awake = sage, with a 2 px surface gap between stacked segments.

**Ordinal: HR zones Z1→Z5** (single brass hue, gets lighter as intensity rises on the dark surface): `#644F20, #876A29, #AB8632, #CDA448, #EBC573`. Validator `--ordinal`: monotone, all ΔL ≥ 0.06, light-end 2.14:1 → PASS. The 3-zone model uses Z1, Z3 and Z5 of this ramp.

**Diverging: Form (TSB) and readiness deltas.** Fatigued ← → fresh:
`#FA9FB4, #D88095, #B66277, #96455B | mid #4A403A | #3464A0, #5182C1, #6EA1E2, #8DC1FF`.
The midpoint is a neutral warm grey that reads as "nothing". The arms brighten towards the extremes.

**Status** (fixed, always icon + label): good `#0CA30C` (5.0:1), warning `#FAB219` (9.2:1), serious `#EC835A` (6.4:1), critical `#D03B3B` (3.5:1). Readiness bands map Primed → good, Steady → no status colour (ink), Hold back → warning, Recover → serious.

### 9.5 Typography

- **Display:** *Big Shoulders Display* (Google Fonts, variable). Use it for the wordmark **PSYCHO**, page titles and the countdown. Tall, condensed and loud, it's the name's personality. Never use it for numbers inside charts or stat tiles.
- **UI and data:** *Hanken Grotesk* (Google Fonts, variable). Use it for everything else, including all figures. Verify it supports the `tnum` feature. If it doesn't, use *Instrument Sans*. Record the choice in `DECISIONS.md`.
- **Scale** (mobile → desktop): wordmark 64 → 160 · page title 40 → 64 · section title 26 → 34 · hero figure 56 → 88 (Hanken, semibold, proportional figures) · stat value 28 → 32 · body 16 → 17 (line-height 1.5) · small 13 → 14 · micro 12.
- Sentence case everywhere except the wordmark. **No** tracked-out all-caps eyebrow labels, **no** monospace labels, **no** "A · B · C" meta strings, and **no** "→" glued onto buttons.
- `tabular-nums` only in tables and axis ticks. Big standalone numbers use proportional figures.
- Pace is shown as `m:ss /km`, durations as `h:mm:ss`, dates as `Mon 16 Nov`.

### 9.6 Motion

- **One orchestrated moment.** On the first visit per session: the wordmark resolves → the route line draws (stroke-dashoffset, ~1.2 s, ease-out) → the readiness figure counts up → done. Total ≤ 1.8 s, skippable by tap, and never blocking data. Later navigations show the line static.
- **Coming back to the app:** on `visibilitychange` to visible (iOS suspends background PWAs), resubscribe to Realtime and refetch Today quietly.
- **Motion that answers Paul:** when Realtime delivers new data, the changed tile's value cross-fades and a 1 px brass rule sweeps under it once. Sheets slide up from the bottom on mobile.
- **No** fade-and-slide-up on every section, **no** scroll-jacking or smooth-scroll libraries, and **no** parallax. Native scroll.
- `prefers-reduced-motion`: everything instant, line drawn statically, no count-up, no grain.

### 9.7 Layout

Content sits in **tone bands**, not a grid of identical rounded cards. A section is a run of `surface` on the `page` plane, separated by hairline `rule`s and generous space. Radius hierarchy: 2 px on data ends (4 px on bar data-ends per dataviz), 12 px on bottom sheets and the nav bar, 999 px on the date-range pill. Nothing else is rounded. Left-aligned throughout. Spacing scale on a 4 px base: 4, 8, 12, 16, 24, 32, 48, 72, 112.

**Today, mobile (390 wide)**

```
┌──────────────────────────────┐
│ PSYCHO          ⟳ 6 min ago  │  wordmark + last watch sync / Sync now
│                              │
│   ╭─╮     route line ~~~     │
│ ~~╯ ╰~~~~~~~~~~~╮            │  hero: route line full-bleed
│      72                      │  readiness (Hanken 56) + "Primed"
│  Primed. HRV above your      │  verdict sentence (2 lines max)
│  normal, slept 7 h 40.       │
├──────────────────────────────┤
│ Overnight                    │  stat tiles 2×3: HRV · RHR · Sleep
│ HRV 58  RHR 51  Sleep 82     │  Body Battery · Recovery left · Stress
│ BB 88   Rec 0 h Stress 24    │  each with 14-day sparkline
├──────────────────────────────┤
│ Form  +6   Fitness 41  …     │  mini TSB strip (diverging, 28 d)
├──────────────────────────────┤
│ Last activity                │  name, sport, distance, time, pace,
│ Tempo · 8.2 km · 46:10       │  hrTSS, TE; tap → deep-dive
├──────────────────────────────┤
│ Garmin Run PH  27 days       │  countdown (Big Shoulders) + goal gap
│ Predicted 2:04:40 (+4:40)    │
└──────────────────────────────┘
[ Today | Form | Runs | Recovery | More ]   bottom nav, 12 px top radius
```

**Today, desktop (1440 wide):** a 12-column grid. Hero spans all 12 columns (route line full-bleed, figure + verdict in columns 1–5). Below it, Overnight (cols 1–7) sits beside Form + Race (cols 8–12), then Last activity full width. The left rail replaces the bottom nav.

### 9.8 Copy voice

Plain, direct, sentence case, written from Paul's side ("You slept 7 h 40"), never system-speak. Errors say what happened and what to do ("Garmin sign-in expired. Run the login command on your Mac to reconnect."). Empty states invite action ("No rides yet. Your first ride will show up here after it syncs.").

---

## 10. Pages

Global header: wordmark, **last watch sync** (from `get_device_last_used`), **Sync now**. One **date-range control** sits at the top of every analysis page (presets 7 d / 30 d / 90 d / 6 m / 1 y / custom), scoping every chart beneath it.

| Route | Contents |
|---|---|
| `/` Today | Section 9.7, plus a thin plan-vs-done strip for this week from `weekly_template`. |
| `/form` | **Fitness and fatigue** (CTL and ATL as 2 lines, 1 axis); **Form** (TSB diverging bars, separate chart, no dual axis); ACWR meter with guide bands; 7-day ramp; weekly load stacked by sport; Psycho training status timeline; VO2 max trend; Training Effect distribution (aerobic vs anaerobic dumbbell per week). |
| `/runs` | Activity list (filter by sport): date, name, distance, time, pace, avg HR, hrTSS, TE, small route thumbnail. Infinite scroll. |
| `/activity/[id]` | MapLibre map in the warm-dark style (route in parchment, km ticks, start/finish). Summary stats. **Small multiples** with a synchronised crosshair: pace, HR (zone-tinted background bands), cadence, elevation, power (if present). Km splits table with an inline pace bar. HR zone time as a tall segmented bar. EF, decoupling and drifted-hard flag. Weather. Training Effect + VO2 max from Garmin. |
| `/efficiency` | EF trend (temperature-coloured points sit in a separate sequential legend, so no extra categorical colours), decoupling per long run, pace-at-HR weekly trend. |
| `/intensity` | Weekly 3-zone distribution (stacked, ordinal ramp) with an 80 % target line; list of drifted-hard runs. |
| `/recovery` | HRV nightly with baseline band (area wash) + 7-day avg line; sleep stages per night (stacked) + score; RHR trend; Body Battery wake / high / low; stress; respiration; SpO2. |
| `/races` | Countdown hero for the next race; goal gap; Garmin predictor trends 5K/10K/HM/M (4 small multiples); Riegel; PB board; race list from `goals`. |
| `/body` | Weight with 7-day average line and target line; body comp table if present. |
| `/sports` | Tabs for **Ride** (distance, speed, HR, hrTSS, weekly volume) and **Strength** (sessions, duration, HR, load contribution, sets if available). |
| `/settings` | Sync health per source (OK / degraded / needs login) with the last 20 `sync_runs`; Personal API key expiry; HR constants (HRmax, HRrest, LTHR, Z2 band) with "recompute history"; goals editor; weekly template editor; key/token expiry dates; Actions minutes this month; sign out. Dark theme only in v1. |

Every chart has a **table view** toggle and keyboard-focusable marks.

---

## 11. Data viz rules (summary; full version in Appendix B)

- Pick the form first (Appendix B.1), colour last.
- One y-axis per chart, always. Two measures means two charts.
- Lines 2 px with round caps. Bars ≤ 24 px thick with 4 px rounded data-ends and square baselines. 2 px surface gap between touching fills. Dots ≥ 8 px with a 2 px surface ring.
- Gridlines are solid 1 px `rule`, never dashed. Axes use `axis`.
- Use a legend for ≥ 2 series, plus selective direct labels (endpoint or extreme). Never a number on every point.
- Text never wears a series colour. Labels use `ink`, `ink-2` or `ink-3`.
- Hover: a crosshair snapping to the nearest date on line charts, and per-mark tooltips on bars. Tooltip shows the value first (strong) and the series name second. Hit targets ≥ 24 px. Keyboard focus shows the same tooltip.
- Refetch keeps the previous render at 60 % opacity. No skeleton flash after first load.
- Insert labels with `textContent`, never `innerHTML`.

---

## 12. Quality floor

- **Performance:** LCP < 2.0 s on mid-range Android over 4G for `/`. Initial JS for `/` < 200 KB gzipped. MapLibre and chart bundles are lazy-loaded below the fold. Server components fetch only the range shown.
- **Accessibility:** WCAG 2.2 AA text contrast (the tokens in 9.3 meet it), visible 2 px brass focus ring, every chart has a table twin, `prefers-reduced-motion` respected, full keyboard navigation, and screen reader labels on figures ("Readiness 72, Primed").
- **PWA:** manifest, icons (wordmark monogram on espresso), standalone display, theme colour `#1C1613`, and an offline shell that shows the last cached Today page with a "You're offline" note.
- **Security:** RLS on every table, service role only in the worker, OTP login restricted to the owner email, security headers (CSP, frame-ancestors none), no secrets in the client bundle (check with a build grep in CI).
- **Observability:** `sync_runs` + Settings view. Worker logs as structured JSON.

---

## 13. Deployment

| Piece | Platform | Notes |
|---|---|---|
| Web | Vercel (Hobby, free) | env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OWNER_EMAIL`, `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO` |
| Worker | GitHub Actions, private repo (free, 2,000 min/month; see 6.3) | repo secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GARMIN_PERSONAL_API_KEY`; env `TZ=Asia/Manila` |
| DB, storage, auth, realtime | Supabase (Free; Singapore region) | migrations in repo; `supabase db push`. Free projects pause after 7 days with no database requests. The 30-min sync prevents that. Keep the DB under 500 MB: store full-resolution streams only for the last 12 months, and only the downsampled `chart` series for older activities (the FIT files in Storage keep everything). |
| Map tiles | MapTiler or Protomaps free tier | custom warm-dark style JSON in repo; the MapTiler key is public in the browser, so **restrict it to the Vercel domain and localhost** in MapTiler's settings; ask Paul before any paid plan |
| Backups | none needed beyond Garmin | Supabase Free has no backups, but every row can be rebuilt from Garmin + FIT files with `backfill`. `nightly` exports `athlete_config` (goals, template, HR constants; no secrets) to Storage as `config/athlete_config.json`. |

CI (GitHub Actions, **pull requests and manual dispatch only**): lint, typecheck, pytest, Next build, palette validator, secret grep. Playwright screenshot tests and Lighthouse run locally (`pnpm test:visual`) so they don't spend Actions minutes.

Workflows in `.github/workflows/`: `sync.yml` (cron + `workflow_dispatch`), `nightly.yml`, `ci.yml`.

---

## 14. Build phases and acceptance criteria

**Phase 0: Access and data audit** (no UI)
- Write `docs/SETUP.md` for Paul: plain step-by-step for each account (GitHub private repo, Supabase Singapore project, Vercel, MapTiler, Garmin Personal API key, Python 3.12 on his Mac), where every secret goes, and how to renew each expiring key/token. Add `.env.example` files for `apps/web` and `apps/worker`.
- Paul creates the Personal API key and runs the unofficial login CLI on his Mac. You prepare both scripts and instructions, then **ask him**.
- Pull 7 days of every endpoint in section 3 into `fixtures/` (sanitised: strip GPS near home, i.e. the first and last 300 m, before committing).
- Download 2 FIT files (one run, one strength) and confirm whether Training Effect / VO2 max fields are present in the official FIT.
- Write `docs/DATA_AVAILABILITY.md`. ✅ *Done when* every metric in section 7 is marked present / empty / missing, and Paul has reviewed it.

**Phase 1: Data layer**
- Migrations, RLS, storage bucket, Vault secret, worker loops, rate limiter, FIT parsing, 18-month backfill.
- ✅ *Done when* a backfill completes without errors, re-running it changes nothing, and a new watch activity appears in the DB within 30 min of sync (or about 2 min after pressing Sync now). The scheduled workflow is visible and green in GitHub Actions.

**Phase 2: Metrics engine**
- Section 8 formulas, pytest suite, `docs/METRICS.md`.
- ✅ *Done when* all tests pass and `daily_load` is populated for full history with plausible values. Spot-check 3 known runs with Paul.

**Phase 3: Design system**
- Tokens package, fonts, primitives: StatTile, Sparkline, LineChart, BarChart (stacked/grouped), DivergingBars, SegmentedBar, Meter, SmallMultiples with a shared crosshair, Tooltip, TableView toggle, DateRange control, BottomSheet, Nav. Build a hidden `/lab` route showing every primitive with real data.
- ✅ *Done when* `/lab` screenshots pass a self-critique against sections 9 and 11, and the palette validator passes.

**Phase 4: Pages**
- All routes in section 10, mobile first.
- ✅ *Done when* every page renders with real data at 390 and 1440 widths, and has no layout overflow, clipped labels or nested scrollbars.

**Phase 5: Live layer**
- Supabase Realtime, Sync now, intro animation, PWA.
- ✅ *Done when* pressing Sync now after a fresh watch sync updates Today without a reload, the update animation plays once, and reduced-motion mode is static.

**Phase 6: Deploy and harden**
- Vercel + GitHub Actions + Supabase production, CI (pull requests only), local Lighthouse. Confirm the projected Actions minutes for the month are under 1,800.
- ✅ *Done when* Lighthouse mobile scores Performance ≥ 90, Accessibility ≥ 95 and Best Practices ≥ 95 on `/`, and Paul can sign in on his phone and install the PWA.

### Definition of done (whole project)

Paul opens Psycho on his phone at 6 am and, within 3 seconds, sees last night's HRV, sleep and resting HR against his normal, a readiness score with a one-line reason, his form, and his race countdown with the predicted gap. Every number is traceable to its source and formula in one tap.

---

## Appendix A: Frontend design rules (from the `frontend-design` skill, adapted)

1. **Ground the design in the subject.** This is a runner's instrument. Route lines, heart-rate traces, splits and race bibs are the native material. Use them before reaching for abstract decoration.
2. **Open with the most characteristic thing** (here, the route line), not a generic "big number + small label + gradient" hero.
3. **Typography carries the personality.** Use two families, clearly distinct (9.5). Set a deliberate scale.
4. **Visual structure is information.** Borders, numbering and dividers must encode something. Don't use numbered markers (01/02/03) unless the content is a sequence.
5. **Motion: one orchestrated moment** beats scattered effects. Don't put entrance animations on every section or hover lifts on every card.
6. **Avoid the generated-design tells:** a cream background with serif + terracotta accent; near-black with a single acid accent; broadsheet hairline-and-zero-radius layouts; identical rounded cards with the same grey shadow; tracked all-caps eyebrow labels; "A · B · C" meta strings; "WORD — fragment" labels; `#0B0B0B`-style near-black; monospace data labels; "→" appended to links.
7. **Plan, then review the plan against the brief, then build, then critique.** Before coding the UI, write a short design plan in `DECISIONS.md` (tokens, type, layout sketch, principles). Check it for defaults and revise, then build. Screenshot, critique, and remove one accessory.
8. **Quality floor without announcing it:** responsive to 360 px, visible focus, reduced motion respected, accessible contrast.
9. **Copy:** user-side language, active voice, specific CTAs ("Sync now", toast "Synced"), errors that say what happened and how to fix it, empty states that invite action.
10. **CSS hygiene:** keep selector specificity flat (tokens + component classes or CSS modules). Avoid type selectors fighting class selectors over spacing.

## Appendix B: Data visualization rules (from the `dataviz` skill, adapted)

**B.1 Procedure:** form → colour job → validate → mark specs → hover layer → accessibility pass → render and look.

**B.2 Choosing a form**

| Data | Form |
|---|---|
| One current value + trend | Stat tile (label, value, delta vs named period, 14-pt sparkline) |
| The one number a view leads with | Hero figure, ≥ 48 px, UI sans, exactly one per view |
| Ratio against a limit | Meter (track is a lighter step of the same ramp) |
| One whole in ≤ 6 parts, at a glance | Tall segmented bar (28 px, parts labelled inside where they fit) |
| Trend over time | Line; area wash at ~10 % for a single series |
| One series matters, rest context | Emphasis: one hue, the rest `ink-4` grey |
| Above/below a baseline | Diverging bars |
| Change of parts over time | Stacked bars |
| Two measures with different units | Two charts or small multiples, never a dual axis |

**B.3 Colour jobs:** categorical = identity (fixed order, never cycled; a 5th category folds into "Other"). Ordinal = ordered buckets (one hue, monotone). Sequential = magnitude (one hue). Diverging = polarity (two opposite hues + neutral midpoint). Status = state (reserved, always icon + label, never reused as a series colour). Colour follows the entity: filtering never repaints the survivors.

**B.4 Validator:** copy `validate_palette.js` from the dataviz skill into `packages/tokens/scripts/`. If it's unavailable, re-implement the checks: OKLCH L band 0.48–0.67 (dark), chroma ≥ 0.10, Machado-2009 protan/deutan CVD ΔE (OKLab×100) ≥ 8 target / 6 floor, normal-vision ΔE ≥ 15, contrast ≥ 3:1 vs surface. Commands:

```
node validate_palette.js "#B18827,#4F91E2,#007E68,#9A7FD6" --mode dark --surface "#231C18"
node validate_palette.js "#4F91E2,#B18827,#9A7FD6,#007E68" --mode dark --surface "#231C18"   # sleep-stage stack order (PASS, worst CVD 16.7)
node validate_palette.js "#B18827,#4F91E2,#007E68" --mode dark --surface "#231C18" --pairs all
node validate_palette.js "#644F20,#876A29,#AB8632,#CDA448,#EBC573" --ordinal --mode dark --surface "#231C18"
```

**B.5 Anti-patterns (if a chart matches one, it's wrong):** dual axes; recolour-on-filter; > 8 hues; eyeballed colourblind safety; a value-ramp on nominal categories; rainbow sequential; a hue at the diverging midpoint; thick saturated blocks; dashed gridlines; a number on every point; borders around marks; clipped labels; fixed-height containers that cut the x-axis; a display face on hero figures; `tabular-nums` on big numbers; texture on by default; tooltip as the only way to read a value; pinpoint hover targets; per-chart filters; skeleton flash on refetch; no table view.

## Appendix C: Research notes and sources (16 Nov 2026)

- Garmin Developer Program overview (Personal tier: pull-only, Activity JSON+FIT, Health JSON): https://developer.garmin.com/gc-developer-program/overview
- Personal API FAQ (token endpoint, 24 h tokens, no refresh, key expiry, personal use only): https://developer.garmin.com/gc-developer-program/personal/personal-faq/
- Official Python client + endpoint table: https://github.com/garmin/connect-personal-api-python
- the5krunner on the Personal API (no Training API; possible stripping of VO2 max/TE/recovery from API FIT files): https://the5krunner.com/2026/10/22/garmin-personal-api/
- Unofficial library (v0.3.20, mobile SSO, method reference): https://github.com/cyberjunky/python-garminconnect · https://pypi.org/project/garminconnect/
- FR165 lacks Training Readiness / Training Status / Training Load / Endurance & Hill Score: https://dcrainmaker.com/2024/02/forerunner-differences-comparison.html · https://www.wareable.com/garmin/garmin-forerunner-165-review
- FR165 HR broadcast is over ANT+: https://www.builtinpro.hk/010-02863-b2
- Design references: https://www.awwwards.com/thefirstthelast/ · https://www.awwwards.com/sites/jesko-jets · https://www.awwwards.com/sites/son-daven · https://www.awwwards.com/sites/davincii · https://www.awwwards.com/sites/hapi · https://www.awwwards.com/sites/surya-aditya-2
