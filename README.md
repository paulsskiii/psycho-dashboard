# Psycho

A personal training dashboard for a Garmin Forerunner 165. It pulls everything off the watch (runs, gym sessions, sleep, HRV, heart rate, Body Battery) and adds the analysis Garmin Connect doesn't do for this watch: training load (hrTSS), fitness / fatigue / form, readiness, 80/20 intensity checks, efficiency and heat, race predictions and goal gap.

Built phase by phase from [`PSYCHO_SPEC.md`](PSYCHO_SPEC.md); the build log is in [`PROGRESS.md`](PROGRESS.md).

## Pages

| | |
|---|---|
| **Today** | Readiness 0–100 with a one-line verdict, overnight HRV / sleep / resting HR against your normal, form, last session, race countdown |
| **Form** | Fitness vs fatigue, form, acute:chronic ratio, weekly load by sport, training status, VO2 max, Training Effect |
| **Recovery** | HRV with baseline band, sleep stages, resting HR, Body Battery, stress, respiration, SpO2 |
| **Runs / Activity** | Activity list with route thumbnails; per-activity map, synced pace / HR / cadence / elevation charts, splits, zones, sets |
| **Intensity** | Weekly easy / moderate / hard split against the 80 % target; easy runs that drifted hard |
| **Efficiency** | Efficiency factor coloured by air temperature, aerobic decoupling, pace at a fixed heart rate |
| **Races** | Countdown, goal gap, Garmin predictor trends, Riegel projection, personal bests |
| **Body, Sports, Settings** | Weight vs target; ride and strength analysis; sync health, heart-rate constants, goals and weekly plan |

## How it works

```
Garmin (official Personal API + garminconnect)  ──►  Python worker on GitHub Actions
                                                     (sync every 30 min, nightly, backfill;
                                                      FIT parsing; metrics engine)
                                                              │
                                                              ▼
                                       Supabase Postgres (RLS, owner-only) + Storage
                                                              │
                                                              ▼
                              Next.js app (server components, custom SVG charts, MapLibre)
```

```
apps/web/            Next.js 16 / React 19 dashboard
apps/worker/         Python 3.12 worker — python -m psycho_worker login|audit|sync|nightly|backfill|metrics
packages/tokens/     design tokens + palette validator
supabase/migrations/ schema, RLS, functions
docs/                SETUP, DECISIONS, DATA_AVAILABILITY, METRICS (every formula)
```

## This public copy

No API keys, tokens or personal data are included: `.env.example` files are blank, the owner's Garmin fixture data is left out (tests that need it skip), and the scheduled sync workflows are switched to manual-only. To run your own, follow [`docs/SETUP.md`](docs/SETUP.md) with your own Garmin, Supabase and MapTiler accounts.
