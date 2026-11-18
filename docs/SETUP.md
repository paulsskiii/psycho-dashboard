# Psycho setup (for Paul)

Everything Psycho runs on is free-tier. This page lists every account, where every secret goes, and how to renew the ones that expire. Do the steps in order; each phase of the build tells you when a step becomes necessary.

| # | Account | Needed from | Cost |
|---|---|---|---|
| 1 | GitHub private repo `paulsskiii/psycho` | Phase 0 | Free (2,000 Actions min/month) |
| 2 | Python 3.12 on your Mac | Phase 0 | Free |
| 3 | Garmin Personal API key | Phase 0 | Free |
| 4 | Garmin Connect login (unofficial library) | Phase 0 | Free |
| 5 | Supabase project (Singapore) | Phase 1 | Free |
| 6 | GitHub fine-grained token (Sync now) | Phase 5 | Free |
| 7 | Vercel project | Phase 6 | Free (Hobby) |
| 8 | MapTiler key | Phase 4 | Free |

---

## 1. GitHub repo

Already done: `https://github.com/paulsskiii/psycho` is private. Keep it private forever: fixtures and Actions logs may contain personal data, and a public repo would also expose the workflow files.

**Repository secrets** (Settings → Secrets and variables → Actions → New repository secret). Add these when each phase asks for them:

| Secret | From | Phase |
|---|---|---|
| `GARMIN_PERSONAL_API_KEY` | step 3 | 1 |
| `SUPABASE_URL` | step 5 | 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | step 5 | 1 |

## 2. Python 3.12 on your Mac

You already have `uv` (Homebrew) and Python 3.13. The worker pins 3.12, and `uv` downloads it on its own:

```sh
cd "~/Coding Files/Pshyco/apps/worker"
uv venv --python 3.12 .venv
uv sync --extra dev
.venv/bin/python -m psycho_worker --help
```

Run every worker command from `apps/worker` as `.venv/bin/python -m psycho_worker <command>`.

## 3. Garmin Personal API key (official API)

1. Sign in to Garmin Connect on the web.
2. Open `https://connect.garmin.com/app/settings/personalApiToken` (the menu entry is under Settings; the name may read "Personal API token" or "Developer").
3. Create a key. **Choose the 1-year expiry** (options are 30, 90, 180, 365 days).
4. Copy the key once; Garmin won't show it again.
5. Put it in `apps/worker/.env` as `GARMIN_PERSONAL_API_KEY=...` (copy `.env.example` first).
6. Note the expiry date. In Phase 4 you enter it in Settings so Psycho warns you 14 days before.

The key only ever exchanges for a 24-hour bearer token; the worker does that automatically and caches the token in `apps/worker/.secrets/` locally (Phase 1: in Supabase Vault for the cloud).

**Renewal:** create a new key the same way, replace `GARMIN_PERSONAL_API_KEY` in `.env` and in the GitHub secret, update the expiry date in Settings. Garmin can also revoke keys; the symptom is the official source showing `degraded` with HTTP 401 in Settings → Sync health.

**Terms:** personal, non-commercial, your own data only. Psycho is exactly that.

## 4. Garmin Connect login (unofficial library)

The unofficial `garminconnect` library fills gaps the official API has (VO2 max history, race predictions, PRs, Training Effect, weather). It logs in like the Garmin mobile app and keeps a refresh token. **Your password is never stored anywhere.**

Run this once, in your own terminal (it asks for the password and an MFA code):

```sh
cd "~/Coding Files/Pshyco/apps/worker"
.venv/bin/python -m psycho_worker login
```

It saves `apps/worker/.secrets/garmin_tokens.json` (owner-only file permissions, gitignored). Phase 1 adds `--upload`, which copies the tokens to Supabase Vault so GitHub Actions can use them.

**When to re-run it:** when Settings shows "Garmin sign-in needed", or when any worker run logs `needs_login`. Refresh tokens usually last months.

## 5. Supabase (Phase 1)

1. `https://supabase.com` → New project. Organisation: your personal one. **Region: Southeast Asia (Singapore).** Free plan. Choose a strong database password and save it in your password manager (migrations need it).
2. Project Settings → API: copy **Project URL**, **anon public key** and **service_role key**.
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` → GitHub repository secrets (step 1) and `apps/worker/.env`.
   - `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `apps/web/.env.local` and Vercel.
   - The service role key must **never** be in Vercel or in the web app.
3. Authentication → Providers: keep Email on. Authentication → Settings: turn **"Allow new users to sign up" off** after your first login (the migration also restricts sign-in to `OWNER_EMAIL`).
4. Also put the **database password** you chose at creation into `apps/worker/.env` as `SUPABASE_DB_PASSWORD=...` (the CLI needs it to push migrations; it is never used by the worker itself).
5. Log the Supabase CLI in and link the project (via `npx`, no Homebrew install). Run these yourself; `login` opens a browser:
   ```sh
   cd "/Users/paulsskiii/Coding Files/Pshyco"
   npx supabase login
   npx supabase link --project-ref <ref>     # the ref is the subdomain of your Project URL
   ```
   After that the agent runs `npx supabase db push` to apply `supabase/migrations/`.
6. Tell the database who you are (only this email will ever be able to sign in), and push your Garmin tokens into Vault:
   ```sh
   cd apps/worker
   .venv/bin/python -m psycho_worker set-owner you@example.com
   .venv/bin/python -m psycho_worker push-tokens
   ```
7. Free projects **pause after 7 days without database requests**. The 30-minute sync keeps it awake. If you ever pause the sync for a week, open the Supabase dashboard and press Restore.
8. Supabase's built-in email sender (for OTP sign-in codes) is rate-limited on the free plan (a few per hour). That's fine for one person.

### GitHub Actions secrets (same phase)

The cloud sync needs three repository secrets (Settings → Secrets and variables → Actions). The agent can set them from your `.env` with `gh secret set` so you never paste them anywhere:

| Secret | Value |
|---|---|
| `GARMIN_PERSONAL_API_KEY` | from `apps/worker/.env` |
| `SUPABASE_URL` | from `apps/worker/.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | from `apps/worker/.env` |

Workflows: `sync.yml` (every 30 min + the Sync now button), `nightly.yml` (03:30 Manila), `ci.yml` (pull requests only). GitHub disables scheduled workflows after 60 days without repo activity; Settings will warn you if no scheduled run has happened for 3 h.

## 6. MapTiler (Phase 4)

1. `https://cloud.maptiler.com` → free account → API keys → create a key named `psycho`.
2. **Allowed HTTP origins:** add your Vercel domain (e.g. `https://psycho-paulsskiii.vercel.app`) and `http://localhost:3000`. The key is public in the browser, so this restriction is what stops others using it.
3. `NEXT_PUBLIC_MAPTILER_KEY` → `apps/web/.env.local` and Vercel.

## 7. GitHub fine-grained token for "Sync now" (Phase 5)

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
2. Name `psycho-sync-dispatch`. Expiration: **1 year** (the maximum). Repository access: **Only select repositories → `paulsskiii/psycho`**. Permissions → Repository → **Actions: Read and write**. Nothing else.
3. `GITHUB_DISPATCH_TOKEN` → Vercel server env only (never `NEXT_PUBLIC_`). Note the expiry date for Settings.

**Renewal:** generate a new token, replace it in Vercel, redeploy, update the expiry date in Settings.

## 8. Vercel (Phase 6)

1. `https://vercel.com` → Add New Project → import `paulsskiii/psycho`. Root directory: `apps/web`. Framework: Next.js.
2. Environment variables: everything in `apps/web/.env.example`.
3. Deploy. Then open the URL on your phone → Share → Add to Home Screen to install the PWA.

---

## Secret map (where each secret lives, and only there)

| Secret | GitHub Actions secret | Supabase Vault | Vercel env | Your Mac (`.env` / `.secrets`) |
|---|---|---|---|---|
| Garmin Personal API key | ✅ | | | ✅ `.env` |
| Garmin unofficial tokens | | ✅ (`garmin_unofficial_tokens`) | | ✅ `.secrets/garmin_tokens.json` |
| Garmin 24 h bearer token (cache) | | ✅ (`garmin_personal_access_token`) | | ✅ `.secrets/` |
| Supabase service role key | ✅ | | ❌ never | ✅ `.env` |
| Supabase anon key + URL | | | ✅ public | ✅ `.env.local` |
| GitHub dispatch token | | | ✅ server-only | |
| MapTiler key | | | ✅ public, origin-restricted | ✅ `.env.local` |

## Expiry calendar

| What | Lifetime | Where you see the countdown |
|---|---|---|
| Garmin Personal API key | 1 year (your choice at creation) | Settings → warns 14 days before |
| GitHub dispatch token | 1 year | Settings → warns 14 days before |
| Garmin unofficial refresh token | months, not fixed | Settings → "Garmin sign-in needed" |
| Garmin 24 h bearer token | 24 h | automatic |
