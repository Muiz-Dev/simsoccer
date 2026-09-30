# Autonomous World Runtime and Recovery Design

**Status:** Target architecture and implementation plan  
**Related specifications:** [01.md](./01.md), [02.md](./02.md), [03.md](./03.md)  
**Purpose:** Define what it means for SIM SOCCER to be alive, time-synchronized, recoverable, and autonomous.

## 1. The Goal

SIM SOCCER is not a collection of commands that an operator runs for each match. It is a persistent football world that an operator starts once and that then manages its own seasons:

```text
Start runtime
  -> verify dependencies
  -> load and reconcile persisted world state
  -> prepare upcoming fixtures and markets
  -> start matches at their scheduled real-world times
  -> advance match state from elapsed time
  -> persist and broadcast events
  -> finish, settle, update tables and ratings
  -> wait the configured interval
  -> advance to the next round
  -> complete the season and prepare the next one
```

The frontend is a client of this world, not its clock or controller. A disconnected browser must not pause, restart, or alter a match. The database continues to represent the world while the API, worker, or frontend is offline.

## 2. Decisions That Resolve the Existing Specifications

The documents describe the same goal at different levels, but one older lifecycle proposal conflicts with the newer match model:

- `01.md` section 72 describes calculating a final result and timeline before kickoff.
- `03.md` requires the result to emerge from event-by-event state transitions; the future score and event sequence must not already be decided at kickoff.
- `02.md` describes the dynamic match state, player/team evolution, and shared state that influences all event types.

**Decision:** Use `03.md`'s event-by-event model as authoritative for match execution. Keep `01.md`'s lifecycle, persistence, security, and betting requirements, but adapt any pre-generation step to prepare inputs, lineups, ratings, and markets, not a hidden final score or complete future timeline. Persist checkpoints and events as they occur.

The season controller, not the API request or browser, decides what match is next. Betting consumes the published state and must never influence the football outcome.

## 3. Sources of Truth

### PostgreSQL: durable world truth

PostgreSQL owns:

- active season, round, round schedule, and season status;
- fixture kickoff timestamps and lifecycle status;
- match seed, simulation version, elapsed virtual time, current score, and current state;
- ordered match events and snapshots/checkpoints;
- team/player ratings, standings, markets, bets, settlements, and audit records;
- runtime heartbeat, last reconciliation, and coordinator ownership/lease.

A restart reconstructs the world from these records. Important progress must not exist only in process memory.

### Redis and BullMQ: recoverable coordination

Redis transports jobs and supports worker coordination. It is not the permanent record of which season or match exists. Jobs must be safe to enqueue more than once; on restart, reconciliation compares PostgreSQL state with queue state and recreates missing work.

### UTC wall clock: world time

Use one authoritative UTC clock for scheduling and reconciliation, preferably PostgreSQL's clock for decisions shared by multiple processes. Do not advance match time by counting `setInterval` callbacks. A delayed or offline process must calculate elapsed time from persisted timestamps.

## 4. Time and Round Scheduling

Persist an explicit `scheduled_at` for every fixture. The match clock derives from kickoff and elapsed real time, using the configured real match duration. For the current example configuration, 90 virtual minutes map to `MATCH_REAL_DURATION_SECONDS` (currently 180 seconds):

```text
targetVirtualSecond = clamp(
  floor((authoritativeNow - actualKickoffAt)
        * 5400 / MATCH_REAL_DURATION_SECONDS),
  0,
  5400
)
```

Persist the actual kickoff, last processed virtual second, last event sequence, and latest checkpoint. On recovery, advance deterministically from that checkpoint to the virtual time implied by the current clock. If downtime means events are overdue, persist and broadcast them in order as catch-up events; do not skip them or reset the match to zero.

Round scheduling is durable data, not a timer in RAM:

1. Assign and persist kickoff times for every fixture in the round.
2. Make the next fixtures discoverable before kickoff so markets can be prepared and users can place bets.
3. Start each fixture at its scheduled time, independent of a browser connection.
4. Mark a round complete only after all its fixtures have finished and required settlement/table updates have committed.
5. Set the next round's start to ten minutes after round completion by default. Store this interval as configuration; do not hard-code it into the worker.

If fixtures within a round are staggered, the next-round delay begins after the last fixture completes. If they share a kickoff, the round completion time is the completion of its final match.

## 5. Startup and Reconciliation Contract

`npm start` should eventually launch the API, world coordinator/scheduler, and workers as one supervised runtime. It must not silently run migrations or seed a remote database. Schema deployment and initial season setup remain explicit, guarded operations.

Startup proceeds in these phases:

1. **Configuration:** validate required environment variables without logging credentials.
2. **Dependency preflight:** verify PostgreSQL with a read-only query and Redis with `PING`. Do not start world mutations until the world dependencies are healthy.
3. **Ownership:** acquire a database-backed lease or advisory lock for the singleton world coordinator. API and worker processes may be replicated, but only one active coordinator should schedule rounds.
4. **Load:** read the active season, current round, fixtures, matches, checkpoints, pending settlements, and runtime record from PostgreSQL.
5. **Reconcile:** compare persisted state to authoritative UTC time; find overdue kickoffs, stale `LIVE` matches, missing simulation/settlement jobs, incomplete rounds, and pending next-round transitions. Apply only idempotent repairs.
6. **Run:** start the coordinator loop and workers, publish readiness, and continuously update the runtime heartbeat.

If there is no active seeded season, report `WAITING_FOR_SEASON` and remain healthy for API/admin work; do not invent a season. If PostgreSQL is unavailable, do not mutate football or betting state. If Redis is unavailable, report the world as degraded and retry/reconcile; do not claim jobs were queued.

## 6. Match Execution and Recovery

The current-state simulation follows `03.md`:

```text
load checkpoint
  -> calculate hazards from current state
  -> sample the next event using the persisted deterministic stream
  -> apply event and state changes
  -> persist event, state, sequence and virtual time
  -> broadcast the committed event
  -> repeat until target virtual time or full time
```

Before a match starts, persist its immutable inputs: team/player snapshot, simulation version, seed, and match configuration. During play, persist checkpoints frequently enough that recovery is bounded. A checkpoint includes the entire dynamic match state and random-generator state, not just the score. Use unique database constraints such as `(fixture_id, sequence)` so a retry cannot insert duplicate events.

The commit-before-broadcast rule is mandatory: persist an event first, then broadcast it. Use an outbox or an equivalent replayable broadcast cursor so a crash between commit and WebSocket delivery does not lose the event. Reconnecting clients provide their last sequence and receive all later persisted events in order.

When a worker restarts:

- `SCHEDULED` with future kickoff: leave it scheduled and ensure its job exists.
- `SCHEDULED` with elapsed kickoff: claim it idempotently and begin/reconcile it at the correct virtual time.
- `LIVE` with a checkpoint: restore it and catch up from persisted time to current time.
- `FINISHED` with missing settlement/evolution work: enqueue only the missing idempotent follow-up work.
- `FINISHED` with complete follow-up: do nothing.

Never rerun a finished match from kickoff just because a queue job is retried. Do not turn a partially persisted run into a second score or a second payout.

## 7. Live Operator Feedback

The terminal should show state transitions and periodic summaries, not just "started successfully" and not one log line per simulated second. Use structured logs with timestamps and identifiers, for example:

```text
BOOT database=connected redis=connected
WORLD status=RECOVERING season=2026-2027 round=1 overdue=2
WORLD status=RUNNING season=2026-2027 round=1 active=6 next_round_at=...
MATCH status=LIVE league=Premier-League home=... away=... score=1-0 minute=34 events=18
ROUND status=COMPLETE season=2026-2027 round=1 next_round_at=...
WORLD status=DEGRADED dependency=redis retry_in=5s
```

Emit a heartbeat/status summary at a modest interval (for example, every 15 seconds) and on lifecycle changes. Include active season/round, live and completed fixtures, next kickoff, queue depth/failures, database/Redis health, and last reconciliation time. Do not log tokens, connection strings, or user secrets.

Expose separate endpoints:

- `/api/health/live`: the process can respond.
- `/api/health/ready`: critical dependencies are usable for the advertised service.
- `/api/world/status`: world state, last heartbeat/reconciliation, season/round, active fixtures, and degraded reason.

An API process being alive is not proof that the world coordinator is running. The status endpoint and heartbeat make that difference visible.

## 8. Current Implementation vs Target

| Capability | Current state | Target |
| --- | --- | --- |
| `npm start` | Builds, checks PostgreSQL/Redis, starts API and simulation worker | Also starts coordinator, reconciler, and schedulers |
| Database/Redis | Connection checks exist; health routes exist | Continuous health, readiness, heartbeat, and degraded recovery |
| Fixtures | Seed creates scheduled fixtures | Coordinator assigns/uses durable kickoff times and enqueues them automatically |
| Simulation | Worker simulates the full match immediately when a job arrives | Event-by-event progression tied to UTC and persisted checkpoints |
| Recovery | No world reconciliation or snapshot restore in the worker | Restart resumes/catches up without duplicate events or results |
| Round progression | No automatic round controller | Complete, wait ten minutes, then start the next round |
| Markets | API can generate markets when requested | Coordinator prepares markets before kickoff and closes them at kickoff |
| Observability | Startup and worker messages | Periodic world heartbeat/status and actionable dependency/queue health |

The existing `match_snapshots` table is not yet a working recovery mechanism: the current simulation worker does not save or restore snapshots. The current worker also defaults to fast simulation and does not derive match time from elapsed UTC time. These are implementation gaps, not behaviours provided by `npm start` today.

## 9. Implementation Sequence

Build and verify the world in these increments:

1. **World runtime state:** add durable runtime/season coordination state, heartbeat, ownership lease, and status API/logs.
2. **Time model:** persist kickoff and match clock fields; derive virtual time from UTC and the configured time scale.
3. **Checkpointed simulation:** save complete match/RNG state and event sequence; make worker retries idempotent; add restart/catch-up tests.
4. **Scheduler/reconciler:** scan PostgreSQL, prepare upcoming fixtures/markets, and enqueue missing jobs with stable job IDs; test duplicate coordinators and Redis restart.
5. **Round controller:** wait until every fixture and required post-match transaction is complete, then schedule the next round after the configured ten-minute interval.
6. **Season lifecycle:** finalize standings, mark the season complete, and create/schedule the next season only under explicit configured policy.
7. **Failure testing:** kill the API, coordinator, and worker during matches; interrupt Redis; simulate temporary PostgreSQL failure; restart and verify no lost/duplicate events, results, or payouts.

Each phase should be deployable and observable before adding the next. Do not label the system autonomous until the final end-to-end test passes.

## 10. Definition of Done

The autonomous world is ready only when these tests pass against an isolated development environment:

- One command starts the API, coordinator, and workers after dependency checks; logs show which services became ready.
- With a seeded active season, the coordinator schedules fixtures and prepares markets without a manual enqueue command.
- Match virtual time follows persisted kickoff time and configured real-time scale, not the number of process ticks.
- Stopping the frontend or disconnecting all clients does not pause the world.
- Stopping the runtime during a match and restarting it reconciles to current UTC time, resumes from a checkpoint, and preserves ordered events without duplicates.
- Redis loss/restart does not erase season, match, result, bet, or wallet truth; jobs are reconstructed from PostgreSQL.
- PostgreSQL loss prevents unsafe writes and produces a visible degraded state.
- Match completion, settlement, ratings/standings, round delay, and next-round scheduling are idempotent.
- After round one completes, the next round begins after the configured ten-minute interval; the season eventually completes without manual `simulate`, `settle`, or `next round` commands.
- Logs and `/api/world/status` agree with the persisted database state.

Until these are true, `npm start` means "start the currently implemented API and worker," not "run the autonomous football world."