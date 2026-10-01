# SIM SOCCER — Implementation & Developer Architecture Guide

**System Name:** SIM SOCCER Virtual Football Engine
**Version:** 1.0.0
**Target Environment:** Node.js + TypeScript + Express 5 + PostgreSQL + Redis + BullMQ + WebSockets

---

## 1. Executive Summary & Core Architectural Principle

SIM SOCCER is a living, deterministic, stateful virtual football engine with an integrated play-money betting and real-time broadcasting system.

### Central Principle
> **The football universe is the source of truth; betting markets are downstream consumers.**

The match simulation is executed as an event-by-event stochastic process. Outcomes emerge tick-by-tick from current match state (possession, pressure, momentum, fatigue, card state, scoreline feedback). The engine does **not** precompute a final score or fixed timeline at kickoff.

### Season Model
The simulation uses a virtual season model rather than real-world calendar years. Seasons are named in a simple progression such as `Season 1`, `Season 2`, `Season 3`, and the runtime treats them as numbered world states rather than historical year labels. Legacy year strings remain supported as compatibility aliases, but the operational model is sequential and virtual.

---

## 2. Directory Structure

```text
backend/
├── src/
│   ├── app.ts                  # Express Application setup & HTTP routes
│   ├── index.ts                # App bootstrapper & HTTP/WebSocket server
│   ├── auth/
│   │   └── jwt.ts              # Supabase JWT authentication & role enforcement
│   ├── config/
│   │   └── env.ts              # Zod environment variable validation
│   ├── db/
│   │   ├── index.ts            # Drizzle ORM PostgreSQL connection setup
│   │   ├── guard.ts            # Fail-closed safety guard for DB operations
│   │   ├── migrate.ts          # DDL migration execution script
│   │   └── schema/
│   │       └── index.ts        # Database schema definitions
│   ├── football/
│   │   ├── fixture-generator.ts # Double round-robin (38 rounds / 380 fixtures)
│   │   ├── seed.ts             # Idempotent selectable season seed command
│   │   └── data/
│   │       └── competitions.ts # Provenance-tracked roster data for 3 leagues
│   ├── simulation/
│   │   ├── types.ts            # Match state, hazards, and event interfaces
│   │   ├── match-engine.ts     # Stateful deterministic PRNG match engine
│   │   └── evolution.ts        # Post-match dynamic rating & form updates
│   ├── markets/
│   │   └── probability-engine.ts # Market probability & overround odds pricing
│   ├── betting/
│   │   ├── bet-service.ts      # Ledger-backed bet placement with ACID transactions
│   │   └── settlement.ts       # Idempotent bet settlement worker
│   ├── workers/
│   │   ├── queues.ts           # BullMQ Redis queue definitions
│   │   └── simulation.worker.ts# Match simulation background job processor
│   ├── realtime/
│   │   └── websocket.ts        # WebSocket server with live sequence ticks
│   └── tests/
│       └── comprehensive-test.ts # PRNG, invariant, and Monte Carlo test suite
├── docs/
│   └── implementation/
│       └── README.md           # This document
├── drizzle.config.ts           # Drizzle Kit configuration
├── package.json
└── tsconfig.json
```

---

## 3. Database Schema Overview

PostgreSQL serves as the authoritative source of permanent state:

- `leagues`: Competition records (Premier League, La Liga, Serie A).
- `seasons`: Selectable season records (e.g. `2025-2026`, `2026-2027`).
- `teams` & `team_ratings`: 20 teams per league, tracking attack/defense strength and form.
- `players` & `player_rating_history`: Roster players, attributes, and rating history.
- `fixtures`: Scheduled double round-robin fixtures (380 per 20-team league).
- `matches`, `match_events`, `match_statistics`: Authoritative tick events, statistics, and result hashes.
- `markets` & `market_outcomes`: Betting markets (1X2, Double Chance, O/U 2.5, BTTS, Correct Score, Corners, Cards) and decimal odds.
- `users`, `wallets`, `wallet_transactions`: User profiles, virtual credit wallets, and ACID transactions ledger.
- `bets`, `bet_selections`, `settlements`: Placed bets, odds snapshots, and single-payout settlement records.

---

## 4. Setup, Migration & Seeding Instructions

### Environment Setup
Create a `.env` file in `backend/`:

```env
PORT=8080
NODE_ENV=development
DATABASE_URL=postgres://postgres:postgres@localhost:5432/sim_soccer
REDIS_URL=redis://localhost:6379
SUPABASE_URL=https://your_project_ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_key
SUPABASE_JWKS_URL=https://your_project_ref.supabase.co/auth/v1/.well-known/jwks.json
TICK_RATE_MS=1000
MATCH_REAL_DURATION_SECONDS=180
SIMULATION_VERSION=1.0.0
```

### Database Migration
Generate versioned Drizzle schema migration files:
```bash
npm run db:generate
```

Run versioned Drizzle schema migrations:
```bash
npm run migrate
# or: npm run db:migrate
```

The runtime supervisor applies pending migrations before starting the API, simulation worker, and coordinator. For a remote production database, configure `ALLOW_PRODUCTION_MIGRATIONS=true` in the backend environment. This flag authorizes versioned migrations only; it does not enable seed operations.

To also apply pending migrations visibly before TypeScript compilation on the deployment machine, configure `MIGRATE_BEFORE_BUILD=true`. Then `npm run build` reports the migration step, compiler step, and successful completion. Leave this unset for local builds unless you intentionally want them to migrate their configured database. `npm run db:generate` creates migration files; `npm run db:migrate` applies the existing SQL files and does not create new ones.

### Admin PIN Bootstrap
Admin credentials are not created automatically. Configure a private `ADMIN_PIN_PEPPER` of at least 32 characters and the browser origins allowed to use the admin session:

```env
ADMIN_PIN_PEPPER=<private random secret>
ADMIN_ALLOWED_ORIGINS=https://your-frontend-domain.example
```

After the admin-table migration has been applied to the database selected by `DATABASE_URL`, run `npm run admin:bootstrap` from a trusted interactive terminal. Confirm the operation and enter the four-digit PIN twice; input is hidden and only its keyed hash is stored. The command refuses to overwrite an existing credential. Keep the pepper in the backend secret store and configure the same value for the API process.

A four-digit PIN is not sufficient as the only barrier for a public admin endpoint. Restrict admin access with a VPN, private network, or equivalent access policy in addition to the PIN and rate limits.

### Database Seeding
Seed initial competitions (Premier League, La Liga, Serie A) for a selectable season:
```bash
# Seed 2025-2026 season
npx tsx src/football/seed.ts 2025-2026

# Seed 2026-2027 season
npx tsx src/football/seed.ts 2026-2027
```

### Reset the Simulation World
To clear world and play-money activity while keeping user accounts and admin access, first back up the database and stop the PM2 runtime. Set `ALLOW_WORLD_RESET=true` in the backend environment, then run `npm run world:reset` from an interactive terminal and type `RESET SIMSOCCER WORLD`. The command clears simulation/settlement queues, truncates league/season/match/market/bet data, resets virtual wallets to 10,000, and seeds a fresh Season 1. It does not delete admin credentials, sessions, or audit records. Remove `ALLOW_WORLD_RESET` after completion, then restart the runtime.

---

## 5. Running the Application & Background Workers

### Start the API and Simulation Worker
With `DATABASE_URL` and `REDIS_URL` configured and reachable, start both implemented services together. `npm start` builds first, verifies database and Redis connectivity without writing data, then starts the API and worker:
```bash
npm start
# npm start builds first, then starts the API/WebSocket server and simulation worker.
# Server listens on http://localhost:8080 and ws://localhost:8080/ws
# Press Ctrl+C to stop both processes.
```

The worker can process up to `SIMULATION_WORKER_CONCURRENCY` matches concurrently (default `30`); tune this to the database capacity. For API-only development with automatic reload, use `npm run dev`; start the worker separately with:
```bash
npm run worker
```

### Queue One Fixture
With the worker running, enqueue one scheduled fixture by ID. This uses the season ratings and player rosters already in the database. The worker will write match events/results and update ratings, so use an isolated development database:
```bash
EXPLICIT_TEST_DB_CONFIRMED=true npm run simulate:fixture -- <fixture-id>
```

With a seeded active season, the coordinator schedules fixtures and advances rounds automatically. Season membership is based on the configured virtual club data; promotion/relegation rules are not modeled yet.

---

## 6. Running the Test Suite

Execute unit, invariant, and 1,000-match Monte Carlo statistical tests:
```bash
npx tsx src/tests/comprehensive-test.ts
```

**Verified Test Outputs:**
- 100% PRNG Deterministic hash matching.
- Exact goal event vs scoreline invariant verification.
- 1,000-match Monte Carlo simulation:
  - Average Goals: 2.97 per match (Home 1.79 - 1.18 Away)
  - Home Wins: 50.7% | Draws: 25.7% | Away Wins: 23.6%
  - Over 2.5 Goals: 56.0%

---

## 7. Data Provenance & Authoritative Seed Data

Initial competition rosters for Premier League, La Liga, and Serie A were configured from official league roster standings with explicit provenance metadata:
- **Premier League**: 20 teams (Arsenal, Man City, Liverpool, etc.), season `2025-2026` / `2026-2027`, retrieved 2026-09-29.
- **La Liga**: 20 teams (Real Madrid, Barcelona, Atletico Madrid, etc.), season `2025-2026` / `2026-2027`, retrieved 2026-09-29.
- **Serie A**: 20 teams (Inter, AC Milan, Juventus, Napoli, etc.), season `2025-2026` / `2026-2027`, retrieved 2026-09-29.

Double round-robin schedule generates exactly 38 rounds and 380 fixtures per league season.
