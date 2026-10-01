# SimSoccer Deployment Handoff

**Snapshot date:** 2026-10-01  
**Repository:** `Muiz-Dev/simsoccer`, branch `main`  
**Latest local commit checked:** `c0bb60b` (`Fix admin rate limiting behind nginx`)  
**Local worktree at that check:** clean

## Product and Timing Goal

- Three active leagues, 20 clubs per league, 38 rounds per season.
- Intended match simulation: 90 real minutes (`MATCH_REAL_DURATION_SECONDS=5400`).
- Intended interval after the final match of a shared round: 10 minutes (`ROUND_BREAK_SECONDS=600`).
- Kickoff stagger is configurable. `FIXTURE_KICKOFF_STAGGER_SECONDS=60` means the ten matches within a league start across a nine-minute span; zero starts them together. Confirm the intended setting before changing production.
- Frontend match clocks are per fixture, not a shared league clock. Different kickoff times naturally produce different displayed minutes.

## Root Cause and Code Changes

The live API overview on 2026-10-01 showed all 30 Round 1 fixtures finished, yet Round 2 was scheduled for 2026-10-02, around 43h53m after the latest Round 1 finish. The problem was persisted future kickoff timestamps combined with coordinator round derivation, not a missing `.env` timing setting.

Committed changes in the current local `main` include:

- `backend/src/football/coordinator.ts`: preserve the previous shared round through the configured break; repair stale future kickoffs once the break is over; prepare next-round markets during the final market-preparation window so that window does not extend the break.
- `backend/src/simulation/match-engine.ts` and `backend/src/workers/simulation.worker.ts`: map elapsed wall time to virtual match time; set `startedAt` to actual worker pickup rather than the scheduled kickoff.
- `backend/src/app.ts`: trust exactly one proxy hop for Nginx, fixing `express-rate-limit`'s `X-Forwarded-For` validation failure.
- `backend/src/db/reset-world.ts` and `world:reset` npm script: guarded interactive reset that clears world/betting data and queues, resets virtual wallets to 10,000, preserves users and admin access, and reseeds Season 1. It requires `ALLOW_WORLD_RESET=true` and the exact confirmation `RESET SIMSOCCER WORLD`.
- Startup/build migration path: `npm run build` has a `prebuild` hook controlled by `MIGRATE_BEFORE_BUILD`; `start.ts` also migrates before launching services. Remote migrations require `ALLOW_PRODUCTION_MIGRATIONS=true`.

## Validation Performed

- `npx tsc --noEmit` passed after the Nginx trust-proxy change.
- `npx tsx src/tests/comprehensive-test.ts` passed, including tests for the round-break boundary and mapping 45/90 real minutes to 2700/5400 virtual seconds.
- A backend build passed when local `MIGRATE_BEFORE_BUILD=false`; it logged that migrations were skipped.
- Warning: the comprehensive suite checks configured PostgreSQL/Redis health and world status. Do not run it against production casually; use an isolated test database/Redis for tests.

## Production State: Verify, Do Not Assume

- The EC2 deployment transcript shows it pulled through `2e252b6`, built successfully but logged `MIGRATE_BEFORE_BUILD=false`, then PM2 startup repeatedly failed because `ALLOW_PRODUCTION_MIGRATIONS` was false. The localhost health curl immediately after restart failed to connect.
- That transcript also showed the admin login error `relation "admin_credentials" does not exist` and the Nginx forwarded-header rate-limit error. The schema migration created the admin tables, but the transcript does not show a successful post-failure migration or PIN bootstrap.
- Later the user reported the app was working. No subsequent EC2 commit/status/health output was provided in the handoff context. Verify the current PM2 process, live health endpoint, applied migrations, and admin login before making further changes.
- The latest local commit `c0bb60b` contains the proxy fix; it had not been shown pulled by EC2 in the captured terminal output.
- The user stated the world reset was done. No reset-completion output was provided. **Do not run `world:reset` again unless the user explicitly confirms another reset is needed.**

## Admin Setup

- `npm run admin:bootstrap` prompts for `CREATE ADMIN`, then a four-digit PIN twice. It refuses to replace an existing credential.
- `ADMIN_PIN_PEPPER` is required and must be at least 32 characters. It must stay stable after creating the PIN; changing it invalidates PIN verification.
- The last explicit bootstrap attempt failed with `ADMIN_PIN_PEPPER must be configured with at least 32 characters`. No successful bootstrap confirmation appears in the captured history; verify whether the credential was later created before rerunning bootstrap.

## EC2 Environment Requirements

Required connection settings:

- `DATABASE_URL`
- `REDIS_URL`

Relevant production settings:

```env
PORT=8080
NODE_ENV=production
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_JWKS_URL=https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
ADMIN_PIN_PEPPER=<private stable value of at least 32 characters>
ADMIN_ALLOWED_ORIGINS=https://simsoccer.vercel.app
MATCH_REAL_DURATION_SECONDS=5400
ROUND_BREAK_SECONDS=600
FIXTURE_KICKOFF_STAGGER_SECONDS=<0 or 60, per intended kickoff behavior>
MARKET_PREPARATION_BUFFER_SECONDS=120
SIMULATION_WORKER_CONCURRENCY=30
MIGRATE_BEFORE_BUILD=true
ALLOW_PRODUCTION_MIGRATIONS=true
```

Do not put real credentials in this document. The user pasted database, Redis, and Supabase private credentials into chat; treat them as exposed and rotate them with the providers, then update EC2 `.env`. Keep `.env` mode `600`. Never echo, commit, or request replacement values.

`ALLOW_UNSAFE_DB` broadly bypasses a database safety guard and should not be left enabled. `ALLOW_UNSAFE_SEEDS` is currently parsed but unused. `ALLOW_WORLD_RESET` should only be temporarily enabled for an explicitly confirmed reset, then removed. `TICK_RATE_MS` is not used by the live match clock. Do not duplicate `.env` keys.

## Safe Deployment Sequence

After ensuring the intended code is pushed to `main`, and after verifying EC2 `.env` has valid rotated connection credentials, a stable pepper, and both migration flags set to `true`:

```bash
pm2 stop simsoccer-runtime
cd ~/simsoccer
git pull --ff-only origin main
cd backend
npm ci
npm run build
```

The build must say migrations are being applied, not skipped. If it skips or fails, do not treat the deployment as complete. If the admin credential is confirmed absent, run `npm run admin:bootstrap` interactively after migration. Then:

```bash
pm2 restart simsoccer-runtime --update-env
pm2 save
curl -fsS http://127.0.0.1:8080/api/health
curl -fsS http://127.0.0.1:8080/api/world/status
pm2 status
pm2 logs simsoccer-runtime --lines 50
```

Stop tailing logs with Ctrl+C; that does not stop PM2. Do not rerun the world reset as part of deployment.

## Local Build Caution

The local `backend/.env` has contained production connection credentials. A local `npm run build` once applied Drizzle migrations to the configured Aiven database because `MIGRATE_BEFORE_BUILD=true`; it did not reset world data. The local `.env` was subsequently cleaned and a build confirmed migration skip, but its current values were not re-read when this handoff was written. Check flags without printing secrets before future builds. Use `npx tsc --noEmit` for a compile-only local check that bypasses the `prebuild` migration hook.
