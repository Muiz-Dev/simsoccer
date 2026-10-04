# SimSoccer Product Readiness Checklist

**Purpose:** Record what is implemented, what remains, and the major release decisions for accounts, betting, and settlement.

## Product Understanding

SimSoccer is a persistent virtual football world first. Betting consumes the world’s fixtures and committed results; betting must not influence match simulation. The initial product scope is play-money. Real-money gambling, deposits, cash-out, and in-play betting are outside the current release scope.

The newer [Betting Space Architecture](./BETTING-SPACE-ARCHITECTURE.md) and [Autonomous World Runtime](./04-autonomous-world-runtime.md) describe the current direction. Some older implementation notes describe broader target capabilities than the code currently provides; use this checklist to distinguish implementation from intent.

## Implemented In The Repository

- [x] Backend API, PostgreSQL/Drizzle schema, Redis/BullMQ queues, WebSocket transport, and a supervised API/coordinator/worker runtime.
- [x] Seed data and fixture generation for three leagues, teams, players, seasons, and double round-robin schedules.
- [x] Seeded, event-by-event match simulation with persistence paths for events, snapshots, results, standings, and team evolution.
- [x] Coordinator paths for shared rounds, fixture scheduling, pre-match market preparation, round cutoffs, and world status.
- [x] Pre-match odds calculation and persisted markets: 1X2, double chance, goal totals, BTTS, correct score, corners, and cards.
- [x] Public betting page for market browsing, selections, and creating/loading booking codes. A booking code is not an accepted wager.
- [x] JWT verification middleware and database tables for users, virtual wallets, bets, bet selections, and wallet transactions.
- [x] A protected backend endpoint for placing a single-selection play-money bet.
- [x] A separate settlement queue/worker and coordinator path to enqueue settlement after a fixture finishes.
- [x] Frontend routes for world overview, live matches, fixtures, results, tables, betting, and administration.

## Remaining Before A Complete Play-Money Product

- [ ] **Accounts:** Implement registration/sign-in and the frontend auth experience. JWT verification exists, but no application signup flow or frontend auth integration was found.
- [ ] **Identity provisioning:** Define how a Supabase identity maps to a local user record and how that user receives a wallet. The seeded demo wallet does not provide onboarding for new users.
- [ ] **Betting UI:** Connect authenticated placement to the betting page, including wallet balance, placement result, accepted-ticket receipt, and private ticket history.
- [ ] **Bet type:** Decide whether the first release accepts singles only or a straight accumulator. The current placement endpoint accepts one selection; the multiple calculator is not connected to bet acceptance.
- [ ] **Acceptance-time validation:** Independently enforce the shared-round cutoff in the placement transaction. Booking creation checks the cutoff, but the placement service currently checks fixture/market status without independently checking the cutoff.
- [ ] **Placement hardening:** Add request/schema validation, race-safe balance updates, scoped and transactional idempotency, stake/payout limits, and clear odds/rounding rules.
- [ ] **Durable market settlement:** Persist market outcomes against a committed fixture result and a settlement-rules version; settle accepted tickets from those records.
- [ ] **Settlement policies:** Decide and test voids, postponed/abandoned fixtures, missing statistics, result corrections, and payout limits. Current settlement grades selections from fixture data directly, and corners/cards can use assumed values if statistics are absent.
- [ ] **Private account APIs:** Add authenticated ticket lookup/history and any account/profile or wallet-history endpoints required by the product.
- [ ] **End-to-end verification:** Test onboarding through wallet creation, cutoff/race behavior, settlement retries, and process restarts against isolated PostgreSQL and Redis.
- [ ] **Release operations:** Verify deployed commit, applied migrations, HTTPS/domain, backups, monitoring, and recovery procedures before launch.

## Deployment Handoff Findings

See the dated [Deployment Handoff](./DEPLOYMENT-HANDOFF.md). Its captured EC2 transcript is historical and does not establish the machine’s current state. It records that a deployment skipped migrations, PM2 then failed to start, the health check could not connect, and the admin credential/bootstrap status was not confirmed. A later report said the application was working, but the handoff contains no subsequent commit, health, migration, or admin-login verification.

- [ ] Verify the EC2 checkout SHA, PM2 status, `/api/health`, `/api/world/status`, applied migrations, and admin login before treating production as healthy.
- [ ] Confirm `MIGRATE_BEFORE_BUILD=true` and `ALLOW_PRODUCTION_MIGRATIONS=true` on EC2; deployment is incomplete if the build reports migrations skipped or failed.
- [ ] Verify the admin credential before attempting bootstrap. Keep `ADMIN_PIN_PEPPER` stable and private; changing it invalidates PIN verification.
- [ ] Rotate the database, Redis, and Supabase credentials previously reported as exposed, then update EC2 secrets without printing or committing them.
- [ ] On the 1-GiB EC2 instance, stop PM2 before building to reduce out-of-memory risk; restart and verify services afterward.
- [ ] Do not run the guarded world reset during deployment. The handoff says a reset was reported as done, but provides no completion output; do not repeat it without explicit confirmation.
- [ ] Keep unsafe database/reset flags disabled except for a specifically authorized operation. Restrict SSH/API access and keep the server environment file private.

## Server Deployment Decision

A second EC2 instance is a deployment choice, not a prerequisite for account management. The current runtime starts the API, world coordinator, simulation worker, and settlement worker together. Running the same full command on another machine would also start more workers; the coordinator has leadership locking, but there is no explicit betting-only process role yet.

Before splitting workloads, add explicit process roles so an additional machine can run only the account/betting API or settlement worker. Share the trusted database and Redis between roles, and ensure only one world coordinator is active. Complete identity provisioning and placement/settlement correctness before adding infrastructure solely to represent a new product phase.

## Release Boundary

- [ ] Confirm the initial launch is play-money only.
- [ ] Do not enable real-money deposits or payouts without separate legal, licensing, identity, fraud, payment, security, and jurisdictional review.
- [ ] Treat true in-play betting as a separate phase requiring event-triggered market suspension, repricing, stale-quote protection, and load/recovery testing.

## Verification Snapshot

The isolated betting cutoff and multiple tests passed, as did the backend TypeScript check during the checklist review. The comprehensive suite was not run because it checks the configured PostgreSQL and Redis, which may be production services. The local repository was clean at commit `2b8f5c5`; the live EC2 deployment was not verified as part of that review.
