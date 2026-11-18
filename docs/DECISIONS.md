# Decisions

Dated record of choices the spec left open, and verified facts the build relies on.

## 2026-11-16 · Phase 0

### Verified library versions (pinned in `apps/worker/pyproject.toml`)

| Package | Version | Verified how |
|---|---|---|
| `garmin-connect-personal-api-python` | 1.0.0 (released 21 Oct 2026; module `garmin_personal_api`) | installed, read `client.py` / `auth.py` |
| `garminconnect` | 0.3.20 (Python ≥ 3.12) | installed, introspected every method in spec 3.3 — all present |
| `garmin-fit-sdk` | 21.221.0 (package name confirmed; `Decoder`, `Stream`, `Encoder`, `CrcCalculator`, `Profile`) | installed |
| `supabase` (supabase-py) | 2.34.x | PyPI |
| Python | 3.12 via `uv` (Mac has 3.13 system; both libs need ≥ 3.12) | `uv venv --python 3.12` |

### Official client facts (differ slightly from the spec's table)

- Auth is two objects: `PersonalApiAuthenticator.obtain_token(api_key)` → `BearerToken(access_token, expires_at)` (JWT `exp`, 24 h; the client refreshes when < 1 h left), then `GarminPersonalApiClient(bearer_token)`. It caches the token in a 0600 JSON file (`~/.config/garmin/...` by default; Psycho points it at `apps/worker/.secrets/`). Phase 1 mirrors that cache into Supabase Vault for the cloud job.
- `get_daily_sleep(date)` hits `/sleep-service/sleep/dailySleep?date=`, `get_daily_sleep_summaries` hits `/sleep-service/sleep/dailySleepSummariesByDate`, `get_daily_hrv_summaries` hits `/hrv-service/hrv/daily/{start}/{end}`. Extra methods not in the spec: `get_daily_steps`, `get_daily_hydration`, `get_wellness_activity_summaries`, `get_effective_weight_goals`, food logs, menstrual.
- `download_activity(id)` returns ZIP bytes; `OfficialGarmin.download_activity_fit` extracts the first `.fit`.
- The client has **no write methods at all**, so the official path needs no allowlist.

### Unofficial client facts

- `Garmin(email, password, return_on_mfa=True).login()` → `("needs_mfa", state)` → `resume_login(state, code)`. Tokens: `api.client.dumps()` → JSON `{di_token, di_refresh_token, di_client_id}`; `api.login(<json string>)` restores without touching disk, which is what the cloud uses. The library proactively refreshes the DI token when it is within 15 min of expiry.
- 60+ write methods exist (`upload_*`, `delete_*`, `set_*`, `update_*`, `add_*`, `create_*`). `ReadOnlyGarmin` exposes only the `READ_METHODS` allowlist; `tests/test_readonly.py` asserts every write method is blocked.
- Exceptions: `GarminConnectTooManyRequestsError` (429), `GarminConnectAuthenticationError` (401 → `NeedsLogin`), `GarminConnectConnectionError` (other HTTP).

### Fixture sanitisation

- JSON: null all lat/lon scalars, replace polylines with `"[stripped]"`, redact identity fields, genericise activity names. Health values kept (private repo; they are what the fixtures are for).
- FIT: binary-patched in place (not re-encoded) so the real file layout, developer fields and unknown fields survive. `record` positions within the first/last 300 m by `distance` are set to the FIT invalid value; all `lap`/`session`/`segment_lap`/`gps_metadata`/`course_point` positions and bounding boxes are blanked unconditionally; header and file CRCs recomputed. Covered by `tests/test_sanitize.py` using a FIT built with the SDK's `Encoder`.

### Audit findings from Paul's real account (16 Nov 2026, 7-day window)

- **Training Effect is in the official FIT** (`session.total_training_effect`, `total_anaerobic_training_effect`) and in both `get_activity` payloads. The stripping the5krunner reported was not observed. Phase 1 reads TE from the FIT first, JSON second.
- **Per-activity VO2 max** (`vO2MaxValue`) exists only in the unofficial `get_activities_by_date` list rows, not in `get_activity`. **VO2 max history** is `get_max_metrics_range` → `generic.vo2MaxPreciseValue`. Not in the FIT.
- **Recovery time remaining** has no source in either library or the FIT profile. Marked missing for v1; the Today tile falls back to Psycho's TSB/readiness. Phase 1 may probe the Swagger list via `client.get()`.
- **Race predictor works on the FR165.** `get_race_predictions(start, end, _type="daily")` → one row/day (`time5K`, `time10K`, `timeHalfMarathon`, `timeMarathon`); no-arg call → latest.
- **Forward-compat endpoints** (`get_training_status`, `get_endurance_score`, `get_hill_score`) return id+date shells with every value null; `get_training_readiness` returns `[]`. The audit classifier treats id/date-only envelopes as empty so they don't read as present.
- **Official FIT record fields** on a run: `position_lat/long, distance, enhanced_speed, enhanced_altitude, heart_rate, cadence, fractional_cadence, power, accumulated_power, vertical_oscillation, vertical_ratio, stance_time, step_length, temperature`, plus numbered unknowns (107, 135, 136, 140, 143). Wrist power and running dynamics are therefore available for `/activity/[id]`. Strength FIT: `heart_rate, distance, temperature` records, `set` messages present.
- `get_activity_workouts` returns `[]` for activities without an attached workout and a list otherwise → usable as the "structured session" flag for the drifted-hard rule.
- No 429s across ~115 requests at 1 req/s from a residential IP. Official calls take ~0.7–1.2 s, FIT downloads ~3.6 s.
- Official bearer token: 24 h JWT confirmed (`exp` claim); the client refreshes when < 1 h remains.

### Process (Phase 0)

- The unofficial `login` CLI stores tokens locally in Phase 0 (`apps/worker/.secrets/garmin_tokens.json`, 0600). Vault upload (`login --upload`) lands in Phase 1 with the Vault migration, because the Supabase project doesn't exist yet.
- The Phase 0 audit writes unsanitised responses to `apps/worker/.raw/` (gitignored) and sanitised copies to `fixtures/`, so the raw data can be re-sanitised if the rules change without re-pulling from Garmin.
- Supabase CLI runs via `npx supabase` (not Homebrew), per Paul.

## 2026-11-16 · Phase 1 (data layer)

- **Recovery time remaining** (no Garmin source on this account): the Today tile uses Psycho's readiness/TSB instead. Column `activities.recovery_time_h` stays for forward-compat.
- **Worker ↔ DB transport:** PostgREST via `supabase-py` with the service role, not a direct Postgres connection. Reason: no DB password in GitHub Actions, and the free-tier pooler isn't needed for one writer. Atomicity (spec §6.2 "transaction per activity") comes from the `upsert_activity(jsonb, jsonb, jsonb)` SQL function, which writes `activities` + `activity_streams` + `activity_laps` in one call. Array columns arrive as JSON arrays and are cast with `jsonb_*_array` helpers so `null` samples survive.
- **Vault** is reached only through `get_secret(name)` / `set_secret(name, value)` (security definer, `service_role` only). Two secrets: `garmin_unofficial_tokens` (DI OAuth + refresh token JSON) and `garmin_personal_access_token` (the official 24 h bearer cache; the worker seeds the local cache file from it and writes back after rotation).
- **Owner lock:** `athlete_config.owner_email` + a `before insert on auth.users` trigger reject any other email and claim `owner_id` on the first sign-in. Set with `python -m psycho_worker set-owner`.
- **Extra table `device_status`** (last watch sync time + device name) for the header; the spec's model had no home for it.
- **Extra column `activities.has_workout`** (from `get_activity_workouts` → non-empty) for the "structured session" flag in the drifted-hard rule.
- **Cadence** is stored as steps/min for runs (Garmin records per-foot cadence + `fractional_cadence`; ×2) and rpm for rides.
- **Streams retention:** `trim_old_streams()` nulls full-resolution arrays older than 12 months nightly; `chart` (≤ 800 pts/channel via LTTB, plus a ≤ 800-point route polyline) is kept forever (spec §13).
- **Backfill checkpoint:** `sync_runs.counts.completed_through` on the latest backfill row; re-running skips completed months and already-fetched activities (by `fit_path`), so it is resumable and idempotent.
- **Wellness days with nothing from Garmin are not written**, so re-running a window never creates empty rows.
- **PR type ids** mapped from Paul's account (1 = 1 km … 7 = longest run, 12–18 = steps). Unknown ids are skipped, not guessed.
- **CI** runs only on pull requests and manual dispatch; the secret grep looks for Garmin key / JWT / Supabase key patterns outside Markdown.

## 2026-11-17 · Phase 1 backfill findings

- **History starts 3 April 2026** (first wellness day) / 4 April 2026 (first activity): that is when Paul's Forerunner 165 started recording. The 18-month walk back to June 2025 therefore returns ~7.5 months of data; months before April 2026 are empty, not missing. `warming_up` (first 42 days) covers April–mid May 2026.
- Final state after backfill: 251 activities (all with FIT in Storage, full-resolution streams, laps, metrics), 229 wellness days, 228 daily_load days.
- Garmin's official range endpoints: steps rejects > 28 days; sleep/body battery/HRV/summaries accept 31. All wellness pulls use 28-day chunks.
- Network on Paul's Mac drops for seconds at a time; every layer that talks to the network now retries (official client backoff, DB transport retries, per-activity skip, per-month retry).
- `sync` recomputes `daily_load` on every run, not only when a new activity arrives, so morning readiness appears as soon as the night's HRV/sleep sync.

## 2026-11-17 · Phase 3 design plan (written before any UI code, per Appendix A.7)

### Stack (verified on npm 17 Nov 2026)
Next.js 16.4.6 (App Router) · React 19.3.1 · **TypeScript 5.9.3** (not 7.0: TS 7 is the native-compiler rewrite and Next declares no TS peer range; its type-check relies on the JS compiler API) · d3-scale 4.0.3 / d3-shape 3.2.1 / d3-array 3.2.5 · @supabase/ssr 0.12.7 · gsap 3.15.1 · maplibre-gl 6.19.0 (lazy, Phase 4) · @playwright/test 1.65.1 (local only). pnpm workspace: `apps/web`, `packages/tokens`.

### Tokens
`packages/tokens/tokens.json` is the single source → `build.mjs` emits `dist/tokens.css` (CSS custom properties) and `dist/tokens.ts` (typed constants for chart code). Values are exactly spec §9.3/§9.4; the palette validator (`packages/tokens/scripts/validate_palette.js`) passed all four spec commands on 17 Nov 2026 (categorical worst CVD ΔE 16.7, normal 19.8; ordinal monotone, light-end 2.14:1).

### Type
Big Shoulders Display (wordmark, page titles, countdown only) + Hanken Grotesk (everything else, including all figures). Both via `next/font/google`, self-hosted, `display: swap`, subset latin. `tabular-nums` only in tables and axis ticks; hero and stat figures proportional. Scale exactly §9.5, fluid between 390 and 1440 with `clamp()`.

### Layout
Page plane `page`; each section is a full-width run of `surface` separated by a 1 px `rule` and space from the 4 px scale. No cards. Radii: 2 px data ends on lines/dots, 4 px bar data-ends, 12 px bottom sheet + nav bar top, 999 px date-range pill — nothing else rounded. Left-aligned. Mobile: bottom nav (5 items). Desktop ≥ 1024: left rail, 12-column grid.

### Chart primitives (hand-built SVG + d3 scales; no chart kit)
- Every chart measures its container with `ResizeObserver` and owns a fixed **height** by role (sparkline 28, small multiple 120, standard 220, hero strip 64); width is fluid. Margins sized to the widest tick label so nothing clips.
- Marks: 2 px round-cap lines; bars ≤ 24 px with 4 px rounded data-end, square baseline (drawn as a path); 2 px `surface` gap between touching fills; dots ≥ 8 px with 2 px `surface` ring.
- Grid: solid 1 px `rule`; baselines/axes `axis`; tick labels `ink-3`, tabular.
- Identity: legend for ≥ 2 series + one direct label at the endpoint/extreme; text never wears series colour.
- Hover: line charts get a crosshair snapping to the nearest date; bars get per-mark tooltips. Hit targets ≥ 24 px (invisible wider rects/bands). Keyboard: each mark/date is focusable (roving tabindex, ←/→), focus shows the same tooltip; 2 px `brass` focus ring.
- Tooltip: value first (strong, `ink`), series name second (`ink-3`), inserted with `textContent`.
- Every chart has a Table view toggle rendering the same rows as an accessible `<table>`.
- Refetch keeps the previous render at 60 % opacity; no skeleton after first paint.
- SmallMultiples share one crosshair via React context keyed by x-value (time or distance).

### /lab
Hidden route (404 in production) rendering every primitive with **real data** from a local snapshot (`apps/web/.lab/snapshot.json`, gitignored) exported by `python -m psycho_worker lab-snapshot` using the service role on the Mac — so no service-role key ever reaches the web app, and screenshots don't depend on an OTP login.

### Review against the brief (defaults removed)
- "Near-black + single acid accent": avoided — espresso/walnut carry a brown undertone and brass is a warm, desaturated metal used once per view.
- "Broadsheet hairline-and-zero-radius": the closest risk with tone bands. Counter: sections step in **tone** (page → surface), not just hairlines; generous 48–72 px vertical rhythm; personality comes from the route line and Big Shoulders, not from rules.
- "Identical rounded cards with grey shadow", tracked all-caps eyebrows, mono labels, "A · B · C" meta strings, "→" on links: none used; lint for them in the self-critique.
- **One accessory removed:** film grain is **off** in v1 (spec marks it optional). Revisit after Phase 4 screenshots.
- **Fonts as built:** Google merged "Big Shoulders Display" into **Big Shoulders** (opsz + wght axes); `next/font` loads it with `axes: ["opsz"]` and CSS optical sizing picks the display cut at title sizes. It has no metric overrides in `next/font`, so `adjustFontFallback: false` with a condensed system fallback. **Hanken Grotesk** kept for UI and figures (tabular numerals verified rendering in axis ticks and tables on the /lab screenshots).
- **ESLint 9.39** (not 10): `eslint-config-next` 16.4's plugins cap at ESLint 9.

## 2026-11-17 · Phase 4 (pages) — auth and Today

- **Sign-in:** email OTP **code** (the project sends 8 digits — `otp_length = 8`) (not magic link), so it works inside an installed iOS PWA. Supabase's Magic Link email template must contain `{{ .Token }}`. Two server actions: `sendCode` refuses any email ≠ `OWNER_EMAIL` with a neutral message; `verifyCode` → session. The DB trigger is the hard lock; the server check avoids sending codes to strangers.
- **Next 16 Proxy** (renamed Middleware) refreshes the session on every request and redirects signed-out visitors; it also copies `@supabase/ssr`'s no-cache headers onto responses that set auth cookies. Every page re-verifies with `getClaims()` + owner email (`requireOwner`).
- **Today's sixth tile:** spec's "Recovery left" has no Garmin source on this account, so the slot shows **Sleep time**; readiness (hero) and form (strip) carry what recovery time would have said.
- **Stale overnight data is labelled, never passed off as today:** tiles say "Night to Mon 16 Nov" and readiness says "as of …" with a sync hint when last night hasn't synced.
- **Plan vs done strip:** 7 day cells; filled dots in sport colours for completed activities, a hollow ring when a planned day has nothing yet; full plan/done text is in each cell's accessible label, and "Today: Tempo, Prehab" is printed above the strip.
- **Email templates are locked on Supabase's built-in sender** (custom SMTP is required to edit them), so the default email may carry a link rather than a code. Sign-in accepts **both**: the code field, or the link — the proxy exchanges `?code=` (PKCE, verifier cookie set by the `sendCode` server action) for a session; a bad or used link lands on `/signin?link=expired`. **Phase 6 note:** an installed iOS PWA doesn't share Safari's cookies, so signing in *inside* the PWA needs the code; if the default email has no code, set up free custom SMTP (e.g. Gmail app password) then edit the template to include `{{ .Token }}`.
- **Today headlines the last *training* session:** walks are excluded from "Last activity" and from the hero route line (they're commutes/errands; a 1 km walk was replacing the interval session). Walks still count in the week strip.
- **Signed-in screenshot tests (local only):** with Paul's OK (17 Nov), `apps/web/tests/auth.setup.ts` mints a session for the owner via the admin `generateLink` API (no email sent) using the service key from `apps/worker/.env`, and stores Playwright state in `apps/web/.auth/state.json` (gitignored, 0600, refreshed every 6 h). Never runs in CI or ships with the app.
- **/runs list** reads the `activity_list` view (migration `20261118000001`, `security_invoker` so the base tables' owner-only RLS applies; no grant to `anon`). It joins load from `activity_metrics` and returns a ≤ ~48-point route thumbnail via `thin_route()`, so a 30-row page never ships full 800-point routes. Keyset pagination on `start_utc` (stable while a sync inserts); infinite scroll via a server action that re-verifies the owner.
- **Hydration rule:** any number computed with `Math.cos`/`Math.sin` that reaches server-rendered HTML must be rounded (`toFixed(6)`); Node and browsers disagree in the last bits.
- **MapLibre pinned to 6.16.0, not 6.19.0:** pnpm 11's minimum-release-age guard flagged 6.19.0 (published the day before) and the install auto-added an exception to `pnpm-workspace.yaml`. Removed the exception and chose a 23-day-old release instead. Rule: never add `minimumReleaseAgeExclude`; pick an older version.
- **Activity map:** custom warm-dark MapLibre style in `src/components/activity/mapStyle.ts` over MapTiler's free OpenMapTiles tiles; route as a parchment line over a brass glow, km markers (computed server-side from the full-resolution track, so only ~20 points ship), start/finish. Loaded with `next/dynamic` (`ssr: false`) only on `/activity/[id]`. Without `NEXT_PUBLIC_MAPTILER_KEY`, or if tiles fail auth, it draws the route alone.
