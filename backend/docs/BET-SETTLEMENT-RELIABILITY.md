# Bet Settlement: Ticket-Focused Design

## In simple terms

A ticket stays **Pending** while any match on it is still playing or has not started. When all its matches have final results, a settlement worker checks each pick, works out the ticket result, and records any payout or refund. A losing ticket gets no payout.

Pending does not automatically mean broken: it can mean the match has not finished. On 5 October 2026, the production database had **4 tickets from 2 users**, all pending:

- **3 tickets** had picks on live matches.
- **1 ticket** had picks on scheduled matches.
- There were **20 pending selections across 19 fixtures**.
- The tickets had **5,898 play-money credits staked**. There were no settlement records or payouts yet, so no result-based profit or loss had been determined.
- Their combined maximum potential return was **654,921.52 play-money credits** if every selection won; this is a possible return, not expected earnings.

The live matches were still in progress when checked. The settlement queue was empty because it only contains work for finished fixtures. This snapshot therefore did not show a finished ticket waiting for its settlement job.

## What the existing code did before this change

- Match completion stores the final score and result hash.
- Existing settlement code grades each fixture's market selections.
- Existing ticket settlement waits until all its picks have outcomes, then updates the ticket and wallet in a transaction. It locks the ticket row and uses a unique settlement record to protect against duplicate payout.
- Previously, the world coordinator found finished fixtures with pending picks and enqueued settlement jobs.

The existing world process contained settlement discovery and queue processing. This update removes that processing path from the world backend so the world runner and the new service cannot compete to settle the same tickets.

## Your proposed separation

The implemented shape is a **standalone settlement API and worker**, separate from the world runner and its supervisor. It lives in `settlement-api/`, has its own process lifecycle, and shares PostgreSQL with the world and accounts services. The shared database is intentional: accepted odds, ticket state, wallet balance, settlement records, and ledger entries must remain consistent in a single transaction.

The worker is **fixture-aware and ticket-focused**:

1. Find pending tickets and their picks.
2. Leave a ticket pending while any selected fixture has no final result and committed result hash.
3. Once all picks have final results, lock that ticket, confirm it has not already been settled, and grade every pick.
4. In one database transaction, record the settlement, update the ticket, and write any payout or refund to the wallet ledger.
5. Recheck finished fixtures and ready tickets every five seconds, so missed notifications or restarts do not strand work. A PostgreSQL advisory lock allows only one active worker to process settlements.

The database transaction, unique settlement record, unique wallet-ledger idempotency key, and per-leg records protect against duplicate processing and payouts. Failed fixture processing retries with increasing delays capped at five minutes. A changed final-result hash is marked for operator review; the service does not silently regrade a prior result. The worker never runs simulations or changes live match state.

The service reports tickets placed, distinct users, stakes, tickets won/lost/void/pending, payouts, settled net, pending potential returns, worker health, round/fixture history, ticket legs, and settlement activity. These are aggregate operational totals plus admin-only drill-downs, not public account details. Amounts are explicitly labeled virtual credits.

## What the complete settlement backbone should contain

This is more than a worker that flips a ticket from Pending to Won or Lost. It should be its own operational world with clear responsibilities.

### Independent settlement service

- Run as a separately supervised process, not as a child of the world runner.
- Read finalized fixtures, accepted selections and odds, and account/wallet references.
- Write settlement records and wallet-ledger entries in a single safe transaction.
- Have its own readiness, heartbeat, logs, retry queue, and health checks.
- Use a restricted database role where practical: read the world and bet records it needs, and write only settlement-owned records and authorized wallet settlement entries.

The service should share the existing PostgreSQL database even though it runs as a separate process. Bets, wallets, and results need relational constraints and atomic settlement transactions; copying them into an unrelated database makes consistency and duplicate-payment protection harder. Separate the service and give it ownership of settlement records rather than copying customer identity and bet data into another database.

### Ticket and fixture processing

- A completed fixture is a signal to grade its recorded outcomes and update the affected ticket legs. The supported markets are 1X2, double chance, total goals, BTTS, correct score, total corners, and total cards.
- A cancelled fixture voids its selections; a postponed fixture stays pending until it finishes or is explicitly cancelled. A void leg is removed from the multiple, and a ticket with no winning legs is refunded its stake.
- Missing corner/card statistics void those individual legs. Total cards use one point per yellow and two per red. An unrecognized market or malformed outcome is recorded as a processing error and retried; it is not silently treated as a void.
- A ticket is finalized only after every leg has a final result.
- A periodic reconciliation scan finds missed work after restarts. It does not depend on Redis or a queue.
- Retries, result hashes, unique settlement keys, row locks, and database transactions prevent duplicate processing and payouts.
- If a result is missing or contradictory, keep the ticket pending and surface the failure for inspection. Never guess a result or report success after an error.

This handles both cases: a round with no bets is recorded as having no ticket work and no betting result; a round with bets shows which tickets and legs are waiting, settled, voided, or blocked. A match must still have an authoritative final result before any selection can be graded.

### Durable operational book

Keep a linked, permanent record of:

- Each season and round being monitored and its lifecycle: waiting, in progress, settling, complete, no bets, or needs review.
- Every fixture result and result hash used for settlement.
- Every graded ticket leg, with its original selection, accepted odds, result, rules version, and timestamp.
- Each ticket decision: won, lost, or void; payout/refund amount; and settlement explanation.
- Every financial ledger entry linked to the ticket and settlement that caused it.
- Every successful fixture/ticket decision and result-hash conflict in an idempotent activity trail. Failed attempts are logged and stored on their fixture record with a retry time.

Completed records should be immutable. If a result is officially corrected, use a reviewed compensating entry with a new audit record; do not overwrite history or silently pay again.

### Operations and business reporting

The admin desk at `/admin/settlement` and admin-only API provide:

- Tickets placed, pending, won, lost, void, and needing review.
- Distinct users who placed tickets.
- Total stakes, payouts/refunds, and **settled net = settled stakes − settled payouts**.
- Potential payout exposure on pending tickets, separate from settled net.
- Pending stake and potential return on pending tickets.
- Round/fixture timeline, market outcomes, match events, ticket legs, last successful scan, worker errors, and settlement activity.

Potential returns indicate possible exposure: many tickets can lose, and selections can be correlated. They are not cash held, company revenue, or proof that a real-money reserve exists.

## Credits now and deposits later

The current wallet schema uses currency `VIRTUAL`; it does not model deposits, withdrawals, payment-provider confirmations, or a real-money treasury. Current reporting must say **play-money credits** and describe simulated betting outcomes only. Never label virtual balances as company cash, deposited funds, or a real financial reserve.

When real deposits and withdrawals are introduced, add an audited funding and double-entry accounting design. Customer funds held, payment clearing, withdrawable balance, operator revenue, and betting liabilities must be distinct accounts. Do not infer any of these real-money balances from virtual wallet totals or losing bets.

## Current implementation and production status

The standalone `settlement-api/` service, worker, rules, admin API, and `/admin/settlement` page are implemented. The world backend no longer starts the previous settlement worker or enqueues settlement jobs. Migrations `0010_graceful_james_howlett`, `0011_married_bill_hollister`, and `0012_settlement_retry_backoff` add settlement activity, fixture/round records, per-leg grading, wallet idempotency, and bounded retry scheduling.

### Production deployment — 5 October 2026

- Release `77739175483e3402786477c822d477ea12487e97` is on EC2 and `main`.
- Before migrating, created and verified `/home/ubuntu/simsoccer-backups/simsoccer-settlement-pre-migration-20261005T131945048Z.dump` (51,711,585 bytes; SHA-256 `ec984d73bfab7d957536d2b3396152d78044e342c0a07497a9ced19da80e7ef1`) with `pg_restore --list`, and restored it to the isolated `simsoccer_settlement_rehearsal_20261005` database. The production migrations were then applied with the normal migration command; entries 0010–0012 were verified in the database.
- EC2 builds passed for the world backend, Accounts API, and settlement API; settlement rule tests passed. Nginx was updated for `/api/settlement/`, its configuration test passed, and public settlement health returned successfully.
- PM2 `simsoccer-runtime`, `simsoccer-accounts`, and `simsoccer-settlement` are online. World and Accounts API readiness checks pass; the world reports Season 2 Round 20 as `RUNNING`. Do not infer coordinator leadership from the API process's `isCoordinatorLeader` field: coordinator is a separate supervised child process.
- The first settlement scan exposed an invalid SQL alias in the round summary. The fix is in release `7773917`; after rebuilding/restarting the settlement service, its readiness reports a successful scan, zero consecutive errors, and the active advisory-lock leader.
- Read-only ledger consistency check: the four previously pending tickets are now `LOST`; all four have settlement records, total payouts are 0.00 virtual credits, there are no settlement payout/refund ledger entries, and no ticket/settlement status mismatches were found. The fixture register contains 19 `SETTLED` and 1,721 `NO_BETS` records. No production test wager or world reset was performed.
- `https://simsoccer.vercel.app/admin/settlement` returns HTTP 200. Authenticated admin data rendering requires an authorized admin session and was not simulated.

The backup restore and migration rehearsal database were created, but migrations were applied directly to production using the normal command rather than rehearsed on the restored copy first. The production backup is retained for recovery. No cash deposits, withdrawals, or real-money accounting were added; all reported amounts remain virtual credits.

Local verification passed: settlement rule tests and API TypeScript build, backend TypeScript check, and settlement admin page TypeScript/lint checks. EC2 builds also passed as recorded above.

### Service configuration and routing

The service defaults to port `8091` and reads `SETTLEMENT_DATABASE_URL`; if unset, it uses the existing `DATABASE_URL`. It also accepts:

```env
SETTLEMENT_PORT=8091
SETTLEMENT_POLL_INTERVAL_MS=5000
SETTLEMENT_ALLOWED_ORIGINS=https://simsoccer.vercel.app
```

Set every actual website origin used by admins in `SETTLEMENT_ALLOWED_ORIGINS`. Do not copy database credentials into this document. The worker can use the shared database URL initially; any separate database role must have only the required reads and settlement writes, including `admin_sessions` idle-expiry refresh.

Run it as its own PM2 process named `simsoccer-settlement`, with working directory `/home/ubuntu/simsoccer/settlement-api` and entry point `dist/server.js`. Health routes are available at `/health/live` and `/health/ready` locally, and `/api/settlement/health/live` and `/api/settlement/health/ready` through the public API prefix.

Add this Nginx location before the general world `/api/` location, preserving the request URI:

```nginx
location ^~ /api/settlement/ {
    proxy_pass http://127.0.0.1:8091;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

The admin browser calls `https://simapi.muizdev.xyz/api/settlement/...` with the existing admin cookie. Confirm the actual site origin is allowlisted before routing traffic.

## How to tell whether a ticket is actually delayed

- **Pending + match not started/live:** expected; it is waiting for a final result.
- **Pending + some ticket selections still live/scheduled:** expected for a multi-selection ticket.
- **Pending + every selected fixture finished:** settlement discovery should pick it up shortly. If it stays pending, inspect settlement-service logs and failed jobs; investigate a result-hash, market-data, database, or payout error rather than manually changing the ticket.
- **Lost:** at least one selection lost; no payout is due.
- **Won:** all selections won; payout is credited once.
- **Void:** applicable selections were voided; the resulting refund follows the settlement rules.

## Ongoing operational safeguards

Do not reset the world or create test bets in production. Keep settlement isolated in its own PM2 process; never restore fixture settlement as a child of the world supervisor.

For future schema releases:

1. Build and test the exact release revision. Restore a recent production backup into an isolated database and rehearse pending migrations there.
2. On EC2, make a fresh custom-format PostgreSQL backup; verify it with `pg_restore --list` and record its SHA-256 before migration. Retain the backup outside the application checkout.
3. Confirm the migration journal is at the expected prior version and no migrations are partially applied, then apply forward migrations while services are stopped if the schema requires it.
4. Deploy/build each service independently. Update Nginx only after checking for duplicate server blocks, run `sudo nginx -t`, and reload it.
5. Start settlement first and confirm readiness plus a recent successful scan; then start Accounts API and world runtime. Verify PM2, API health, and world progression without resetting the world.
6. Check any pending tickets and compare selections, settlement rows, wallet changes, and idempotent ledger entries. If integrity mismatches occur, stop only the settlement process and investigate before resuming it.

Migrations are additive and have no automated rollback. If application rollback is required, stop the new settlement worker first and roll back application code only; do not drop settlement data or reverse ledger entries. Any payout correction must be a reviewed compensating transaction, never a direct rewrite or repeated payout.
