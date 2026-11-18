# Progress

## Phase 0 — Access and data audit (started 16 Nov 2026)

**Built**
- Monorepo scaffold (`apps/web`, `apps/worker`, `packages/tokens`, `supabase/migrations`, `docs`, `fixtures`, `.github/workflows`), `.gitignore` covering every secret/token path.
- `apps/worker` Python 3.12 package `psycho_worker` (uv-managed, deps pinned):
  - `python -m psycho_worker login` — interactive unofficial Garmin login with MFA; password used once, tokens stored 0600 locally.
  - `python -m psycho_worker audit` — pulls 7 days from every endpoint in spec §3 (both sources), saves raw → `.raw/` (gitignored) and sanitised → `fixtures/`, downloads 2 FIT files (run + strength), checks whether Training Effect / VO2 max fields survive in the official FIT, writes `docs/DATA_AVAILABILITY.md`.
  - `garmin/official.py` — rate-limited (1 req/s, +2 s between FIT downloads), backoff on 429/5xx, one re-exchange on 401.
  - `garmin/unofficial.py` — `ReadOnlyGarmin` allowlist proxy; every write method raises.
  - `sanitize.py` — JSON and binary FIT sanitiser (first/last 300 m GPS removed, bounding boxes blanked, CRCs fixed).
  - `logs.py` — structured JSON logs in Actions, `::add-mask::` for every secret.
- `docs/SETUP.md` (all 8 accounts, secret map, expiry calendar), `docs/DECISIONS.md`, `.env.example` for web and worker.

**Verified**
- Both Garmin libraries exist on PyPI at the spec's versions; every method the spec names was confirmed by introspecting installed source (see DECISIONS.md for the differences found).
- `pytest`: FIT sanitiser round-trips a synthetic run (positions blanked only near home, HR/TE intact, file decodes); JSON sanitiser; read-only allowlist blocks all 60+ write methods.

**Audit run (16 Nov 2026, 21:30–22:00)**
- Paul created the Personal API key and ran `login` (MFA). The key had been pasted into the tracked `.env.example`; it was moved to the gitignored `.env` before any commit, and HEAD was confirmed clean.
- `audit` ran three times (two bug fixes in between: `get_race_predictions` needs `_type`; id/date-only envelopes must count as empty; FIT bytes must not be JSON-dumped). Final run: 109 calls, 100 present, 9 empty, 0 missing, 0 errors, no 429s.
- Fixtures: 109 sanitised files (1.9 MB) + 2 sanitised FIT files. Leak scan after sanitising: 0 coordinates, 0 polylines, 0 identity strings, 0 API-key strings. One leak (`fullname`, lowercase) was found by the scan and fixed with a case-insensitive rule + regression test.
- Key findings are in `docs/DECISIONS.md` → "Audit findings". Headline: TE is in the official FIT; race predictor works; recovery time has no source; FR165 returns empty shells for Training Status / Endurance / Hill.

**Incident (16 Nov, 22:05):** commit `43fe4bc` included `apps/worker/.secrets/garmin_personal_bearer.json` (the official 24 h bearer JWT + a SHA-256 fingerprint of the API key; not the key itself) because `.gitignore` had `**/secrets/` but not `**/.secrets/`. The pre-commit check saw it but didn't halt. Fixed in `c5f54f6` (file removed from tree, `.secrets/` ignored explicitly). The token expires Tue 17 Nov 21:30. History rewrite (force-push) was left to Paul; see the chat for the command.

**Open / waiting on Paul**
- Review `docs/DATA_AVAILABILITY.md` (Phase 0 acceptance gate). Phase 1 starts after that.
- Decide whether to rewrite history to drop `43fe4bc`'s copy of the bearer token (optional: it expires within 24 h and the repo is private).
- Phase 1 needs the Supabase project (SETUP.md §5) before migrations can be pushed.

## Phase 1 — Data layer (started 16 Nov 2026)

**Built (offline, against the Phase 0 fixtures)**
- `supabase/migrations/20261116000001_schema.sql`: all spec §5 tables (+ `device_status`, `activities.has_workout`), RLS with `is_owner()`, explicit grants (`authenticated` select / config update / sync_requests insert; `service_role` all), owner-only auth trigger, `fit` + `config` storage buckets, Vault `get_secret`/`set_secret`, atomic `upsert_activity`, `trim_old_streams`, Realtime publication, seeded goals and weekly template.
- Worker: `db.py` (Store), `fitparse.py` (streams, laps, km splits, LTTB chart, route), `mappers/wellness.py`, `mappers/activity.py`, `loops.py` (`sync`, `nightly`, `backfill`, `push-tokens`, `set-owner`), CLI wiring, `login --upload`.
- Workflows: `sync.yml` (cron */30 + dispatch, 5 min timeout, shared concurrency group), `nightly.yml` (19:30 UTC), `ci.yml` (PR + dispatch only).
- Tests: 13 passing — FIT fixtures parse cleanly (19 laps, 17–18 km splits, cadence in spm, TE 3.8), wellness/activity mappers reproduce known values from the fixtures and are idempotent, LTTB keeps peaks and endpoints, read-only allowlist, sanitiser.

**Live (16 Nov, 23:00–23:50 Manila)**
- Supabase project `<project-ref>` (region **ap-southeast-2 Sydney**, not Singapore; Paul's choice, kept). CLI linked; `npx supabase db push --remote` applied the migration. Verified from the DB: 13 tables, 15 policies, 6 functions, 2 buckets, 5 Realtime tables, auth trigger; `authenticated` select-only (+ column-level update on config, insert on sync_requests), `anon` nothing, Vault/upsert functions `service_role` only.
- Paul pasted secrets into the tracked `.env.example` twice; both times moved to `.env` before any commit. The first "service role" value was the publishable key; replaced with `sb_secret_…`.
- `set-owner <owner email>`, `push-tokens` → Vault. GitHub secrets set with `gh secret set` (3).
- Live `sync` #1 crashed: `jsonb_populate_record` bypasses defaults → `synced_at` null. Fixed. `sync` #2: 10 activities + FIT + streams + laps + 2 wellness days, 109 s cold. `sync` #3: 0 new, **9.3 s**. Cloud run `43898987401`: success, 38 s wall-clock, worker 10.7 s, unofficial worked from the datacenter IP.
- `nightly` #1 crashed on PR dates (epoch ms, not strings) → fixed; #2 ok in 41 s: 38 VO2 max days, 121 race-prediction days, 14 PRs, 0 weigh-ins (no scale), HR config 207/186 + zones, config export, both Vault secrets.
- Data sanity: latest race predictor HM 1:53:24, VO2 max 51.7, PRs 10K 55:54 / HM 2:18:44 (watch time). Garmin PR typeId 31 (value 124000) unmapped.
- 18-month `backfill` started on the Mac at ~23:48 (log in the session scratchpad).

**Remaining for Phase 1 acceptance**
- ✅ Backfill completes without errors; re-run changes nothing. Final run 17 Nov 09:40–10:03 Manila: 18 months, status ok, 0 warnings. Re-run (`--restart`, 6 min): 0 activities written, 0 metrics recomputed, identical counts — 251 activities / 251 streams / 1,826 laps / 251 metrics / 229 wellness days / 228 load days / 231 race-prediction days. History starts 3–4 Apr 2026 (watch purchase). (Earlier: three attempts died on the Mac's flaky network — a Supabase edge HTML error, then two `ReadTimeout`s while Garmin calls also timed out. Fixed in layers: DB write/read retries on transport errors and 5xx (`e97d1b2`), a failed activity is skipped not fatal (`d4e4624`), a whole month retries on transient network errors (`0c063e8`). 6 of 18 months done so far; resumes from the checkpoint.)
- A new watch activity appears within 30 min of sync (needs Paul's next workout).
- ✅ Scheduled workflow visible and green: first cron run `43982252968` at 23:47 UTC 16 Nov, success, worker 9.7 s. (GitHub's first cron fired ~8 h after the workflow landed on `main`; the dispatch run had been green all along.)

## Phase 2 — Metrics engine (started 17 Nov 2026, 00:00 Manila, while the backfill ran)

**Built**
- `psycho_worker/metrics/`: `constants` (HRmax/HRrest/LTHR/zones/Z2 band from `athlete_config` + 7-day RHR median), `load` (Banister TRIMP → hrTSS with the 10 s gap rule, time in zones, 3-zone %), `fitness` (CTL/ATL/TSB, ACWR EWMA, 7-day ramp, 28-day trends, status rules), `readiness` (28-day z-scores clipped ±2, renormalised weights, bands, fixed verdict phrase table with race-week taper), `efficiency` (EF, hilly, steady, decoupling, pace at HR), `races` (Riegel, goal gap), `engine` (activity_metrics for changed activities + full daily_load rebuild).
- Wired into `sync` (from earliest changed day), `nightly` (120 days) and `python -m psycho_worker metrics [--since] [--all]`.
- `docs/METRICS.md`. Tests: 32 passing, including every §8.8 requirement (hrTSS = 100 ± 0.5 for 60 min at LTHR; CTL/ATL/TSB against `fixtures/metrics/ctl_atl_reference.json`; decoupling on a synthetic 8 % drift ≈ 3.8 %; readiness renormalisation; real FIT through the engine).

**Open**
- Live `daily_load` for full history and the 3-run spot-check with Paul wait for the backfill to finish.
- Steps range limit is 28 days (measured); the in-flight backfill used 31, so a wellness-only re-pass (`backfill --restart`) follows it.

## Phase 3 — Design system (17 Nov 2026)

**Built**
- pnpm workspace; `packages/tokens` (tokens.json → `dist/tokens.css` + `dist/index.ts`; `pnpm palette` runs the spec's four validator commands from tokens.json — all PASS).
- `apps/web`: Next.js 16.4 / React 19.3 / TS 5.9, `next/font` Big Shoulders + Hanken Grotesk.
- Primitives: StatTile (+ source badge), Sparkline, LineChart (crosshair, band, wash, dimmed warm-up, gutter endpoint labels, robust domain, clip path), BarChart (stacked/grouped, 4 px data-ends, 2 px gaps, target line), DivergingBars, SegmentedBar, Meter, SmallMultiples (shared crosshair), Tooltip, ChartFrame (legend + Table toggle), DateRange, BottomSheet, Nav. Every chart is keyboard-readable (arrow keys → tooltip as a live region) and has a table twin.
- Hidden `/lab` (404 in production) on real data from `python -m psycho_worker lab-snapshot` (gitignored), so no privileged key reaches the web app.
- Playwright (local only): no horizontal scroll, no chart wider than its container, keyboard crosshair + table toggle — 4/4 pass at 390×844 and 1440×900.
- CI `web` job (PR + manual only): palette, typecheck, lint, build, secret grep over the client bundle.

**Self-critique (two passes, screenshots in `apps/web/screenshots/`, gitignored)**
- Pass 1 found and fixed: endpoint labels over the data → right gutter; pace axis blown to 20:00/km by stops → 2–98th percentile domain + clip path; negative cadence/power ticks → never pad non-negative data below 0, and 0 cadence/power = stopped; colliding date ticks → thin by width; "Sept" → "Sep"; 80 % target label overprinting bars → legend; "A · B · C" run title → plain name + date line; full-width date pill; Table toggle wrapping under titles.
- Pass 2 found and fixed: stat-tile values misaligned when labels wrap → four-row subgrid; Next dev badge over the Today tab → `devIndicators: false`.

**Open (Phase 4 must handle)**
- Readiness tile falls back to the last non-null day without saying which; Today needs an explicit "as of" or a "not enough data last night" state.
- The real data shows only ~20 % of run time in low zones (80/20 target missed most weeks) — the UI should make that obvious, not bury it.

## Phase 4 — Pages (17–18 Nov 2026)

**Built** (each page: RLS loader in `src/lib/data/<page>.ts`, scoped by `?range=`; server page; client charts)
- Today (owner OTP sign-in, readiness with an explicit "as of" when last night hasn't synced, verdict, overnight tiles, form strip, last session, race countdown, plan-vs-done week), `/form`, `/recovery`, `/runs` (sport filter, route thumbnails, infinite scroll), `/activity/[id]` (MapLibre warm-dark map, small multiples with a shared crosshair, km splits, zones, sets).
- `/intensity`: weekly 3-zone share or hours with the 80 % line; drifted-hard runs. The real data makes the gap obvious: 25 % low over 90 days, 0 of 14 weeks on 80/20.
- `/efficiency`: new `Scatter` primitive; EF per run coloured by air temperature (sequential legend), 28-day line, EF vs heat, decoupling with the 5 % line, weekly pace at fixed HR. Hilly/treadmill runs greyed, toggle to include.
- `/races`: countdown, goal gap in s and s/km, Garmin predictor 4-up small multiples (plotted in minutes so ticks are round), Riegel from the fastest outdoor ≥ 5 km run in 60 days (moving time) beside Garmin's, PB board, races and goals.
- `/body`: latest, 7-day average, target, trend once there are two weigh-in days. One weigh-in per Manila day, last wins (2 Apr has 88.45 then 68 kg, 19 s apart: a correction).
- `/sports`: Ride / Strength tabs; no rides yet, so it opens on Strength.
- `/settings`: sync health per source + last 20 runs, Actions-minutes estimate (from `sync_runs`, labelled as an estimate), key/token expiry dates, HR constants + pace-at-HR band, Recompute history, weekly template and goals editors, sign out. Saving unchanged values was round-tripped through the server actions and RLS; the config was byte-identical afterwards.
- `/more` (phones); the desktop rail lists every page.
- Migration `20261118000002_settings.sql` (pushed with Paul's OK): `athlete_config.z2_band`, `sync_requests.kind`. Recompute history runs in `nightly`, not `sync`: a forced full recompute took 4 min 15 s from the Mac.

**Verified**: `pnpm test:visual` 34/34 at 390×844 and 1440×900 (no horizontal scroll, no console errors), screenshots read for every page; typecheck, lint, `next build`; worker pytest 33/33, ruff clean.

**Open**
- GitHub's `*/30` cron fires roughly every 8–10 h (runs at 23:47, 05:47, 15:12 UTC 16–17 Nov). Phase 1's "new activity within 30 min" depends on Sync now (Phase 5) or an external trigger.
- `npx supabase` now resolves CLI 3.2.0, which lacks the darwin-arm64 binary; use `npx supabase@3.1.0 … --remote`.
