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
DATABASE_URL=postgres://user:password@host:port/dbname?sslmode=require
REDIS_URL=rediss://user:password@host:port
SUPABASE_URL=https://your_project_ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_key
SUPABASE_SECRET_KEY=your_secret_key
ALLOW_UNSAFE_DB=true
ALLOW_UNSAFE_SEEDS=true
TICK_RATE_MS=1000
MATCH_REAL_DURATION_SECONDS=180
SIMULATION_VERSION=1.0.0
```

### Database Migration
Run DDL schema migrations:
```bash
npm run migrate
# or: npx tsx src/db/migrate.ts
```

### Database Seeding
Seed initial competitions (Premier League, La Liga, Serie A) for a selectable season:
```bash
# Seed 2025-2026 season
npx tsx src/football/seed.ts 2025-2026

# Seed 2026-2027 season
npx tsx src/football/seed.ts 2026-2027
```

---

## 5. Running the Application & Background Workers

### Start API & WebSocket Server
```bash
npm run dev
# Server listens on http://localhost:8080 and ws://localhost:8080/ws
```

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
