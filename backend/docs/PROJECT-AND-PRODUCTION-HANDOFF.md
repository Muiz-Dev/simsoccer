# SimSoccer Project and Production Handoff

**Snapshot date:** 2026-10-05  
**Repository:** `Muiz-Dev/simsoccer`  
**Local `main` revision checked:** `e7cf023`  
**EC2 checkout revision checked:** `aaea6a7`

This is an operational snapshot of the project and its production environment.
It supplements [DEPLOYMENT-HANDOFF.md](./DEPLOYMENT-HANDOFF.md), which contains
the more detailed custom-auth configuration, migration, and rollout procedure.
Production health can change after this snapshot; check the live endpoints
before acting.

## At a glance

SimSoccer runs a persistent, play-money football world. The backend owns the
fixtures, match state, results, league tables, betting markets, and settlement
work. The browser displays this data and provides account and betting screens;
it does not run or control the simulation.

The project has three main applications:

| Application | Location | Responsibility |
|---|---|---|
| Frontend | `frontend/` | Next.js website: live matches, fixtures, results, tables, betting UI, account/auth screens, and administration UI |
| World backend | `backend/` | Express API, PostgreSQL/Drizzle data, world coordinator, match simulation and background workers, betting and settlement |
| Accounts API | `accounts-api/` | Express API for first-party registration, verification, sessions, profile, and account endpoints |

The website is normally deployed automatically by Vercel from `main`.
Backend services are deployed manually to EC2. A frontend commit does not by
itself update the EC2 checkout, and an EC2 pull does not deploy the website.

## Production machine

The production backend runs on an AWS EC2 instance:

| Property | Observed value |
|---|---|
| Instance | `i-071f530b475f93dd3` (`simsoccer-backend`) |
| Region | `eu-north-1` |
| Operating system | Ubuntu |
| Instance type | `t3.micro` (2 vCPU, about 1 GiB RAM) |
| Public IPv4 at the time of the snapshot | `13.61.146.106` |
| Public DNS at the time of the snapshot | `ec2-13-61-146-106.eu-north-1.compute.amazonaws.com` |
| Private IPv4 | `172.31.16.84` |
| SSH account | `ubuntu` |
| Project checkout | `/home/ubuntu/simsoccer` |

The public address is auto-assigned and may change. The instance has no
Elastic IP recorded in the earlier EC2 console snapshot. Reconfirm the current
address and instance identity in AWS before using an old address.

At the live resource check for this snapshot, the root filesystem showed
approximately 6.7 GiB total with 2.5 GiB free. Linux reported about 908 MiB
memory total, with about 208 MiB available. These are point-in-time figures,
not capacity guarantees. This is a small host; large local builds can compete
with the always-running world service for memory.

### Connecting from the authorized Windows workstation

The authorized SSH key is stored locally at `C:\simsoccer\wesheild.pem`.
The key itself must remain private, excluded from Git, and outside this
document. Do not send it to another developer. A developer without authorized
access must obtain their own key/access through the owner.

From PowerShell:

```powershell
ssh -i C:\simsoccer\wesheild.pem `
  -o IdentitiesOnly=yes `
  -o BatchMode=yes `
  -o StrictHostKeyChecking=yes `
  ubuntu@13.61.146.106
```

Use the current AWS-confirmed IP or DNS name if it changes. Host-key checking
is intentionally enabled. If SSH reports a host-key change, stop and verify
the EC2 host identity through AWS/out-of-band information; do not bypass the
check or accept an unexplained new key.

The remote deployment tools used for safe, read-only checks include:

```bash
pm2 status
pm2 describe simsoccer-runtime
pm2 describe simsoccer-accounts
sudo nginx -t
curl -sS http://127.0.0.1:8080/api/health
curl -sS http://127.0.0.1:8080/api/world/status
curl -sS http://127.0.0.1:8090/api/health/live
curl -sS http://127.0.0.1:8090/api/health/ready
```

Do not print `.env` files, process environments, tokens, cookies, email codes,
database URLs, Redis URLs, or signing keys into terminals that may be logged
or copied. Use filtered checks that report only whether a variable is set.

## Services and request routing

Both applications are supervised by PM2:

| PM2 process | Working directory / entry point | Port | Responsibility |
|---|---|---:|---|
| `simsoccer-runtime` | `/home/ubuntu/simsoccer/backend`, `dist/start.js` | `8080` | World API, persistent simulation runtime, coordinator and backend workers, betting API |
| `simsoccer-accounts` | `/home/ubuntu/simsoccer/accounts-api`, `dist/server.js` | `8090` | Account, verification, session, and custom-auth API |

Nginx terminates the public web/API traffic. Its configuration must route
`/api/auth/` and `/api/account/` to port `8090`, and the world API routes to
port `8080`. Keep the account routes ahead of the general `/api/` world route
so they are not swallowed by it. The Nginx configuration syntax check passed
in the recorded production session.

The public API hostname is `https://simapi.muizdev.xyz`. The signing public
keys are published at
`https://simapi.muizdev.xyz/api/auth/.well-known/jwks.json`; this endpoint
contains public verification keys, not the private signer.

PostgreSQL is the durable store for world and account data. Redis supports
queues, coordination, and distributed auth rate limits. Resend is configured
for account verification and recovery email. The exact database, Redis, and
email-provider values are secrets and are deliberately not recorded here.

## The persistent world

The world is designed to run independently of the website:

1. PostgreSQL stores seasons, league rounds, fixtures, match state/events,
   markets, standings, bets, and settlement records.
2. The backend coordinator schedules world rounds and match starts.
3. Background workers advance match events and process post-match work.
4. Redis/BullMQ coordinates work; it is not the permanent source of world
   state.
5. The frontend reads the world API and live transport. Closing a browser must
   not stop or reset the world.

The product is play-money only. The world generates its own football schedule
and match outcomes; betting consumes those results and must not influence
simulation. Real-money deposits, withdrawals, and payouts are outside the
current scope.

### World state observed on EC2

The latest recorded `/api/world/status` response showed:

- World status: `RUNNING`.
- Active season: `Season 2`, round 17 of 38.
- Three active leagues: Premier League, La Liga, and Serie A.
- 10 live fixtures per league (30 total), 160 completed per league (480 total),
  and 210 scheduled per league (630 total).
- PostgreSQL, Redis, and migration checks were reported as healthy by the
  world backend.
- The returned status reported `isCoordinatorLeader: false` and no coordinator
  node ID, despite a running status and heartbeat. This is included as an
  observation, not proof that the coordinator lease is healthy.

This is a timestamped snapshot, not a promise that the same round or fixture
counts remain current. Check `/api/world/status` before any operation that
could pause or modify the world. Never run a reset or destructive seed command
as a deployment shortcut.

## Custom accounts and authentication delivered

Supabase Auth was replaced in the repository by a first-party Accounts API.
The deployed design includes:

- Email/password registration and eight-digit email verification.
- Password sign-in followed by a one-time email code, plus a separate
  passwordless email-code flow.
- Password recovery and password change.
- Argon2id password hashing.
- RS256 access tokens, a public JWKS endpoint, and world-backend token
  verification.
- Rotating opaque refresh sessions in secure, HTTP-only cookies.
- Session revocation, email/IP/session rate limits, and account profile
  completion.
- Random first-party device-recognition cookies and keyed hashes for stored
  device, IP, and user-agent signals. This is not invasive canvas/audio
  fingerprinting.
- A database migration adding verification, challenge, session, and device
  records while preserving existing users and wallets.

The migration `0007_first_party_auth.sql` was previously applied to production
after a database backup was created and checked. The prior production rollout
record says the Accounts API tests (8/8), world tests (13/13), and both API
builds passed on EC2. Do not infer that these tests were run again merely
because the machine is currently online.

Existing users' legacy IDs and wallet data are retained. Old identity-provider
passwords are not imported. An unverified registration may leave an
unverified account record if email delivery or the browser flow fails;
retries should reuse the same email rather than create a different account.
Do not test signup against a real user's email without authorization.

Email codes are not phishing-resistant MFA. Control of the email account can
defeat the email-code step; do not market the flow as NIST AAL2 or equivalent.

## Frontend work recorded

The repository's `main` includes the recent frontend work:

- Goal timelines are expandable from the match row.
- Timeline events align with the team columns, group the minute and ball icon
  closely, and omit per-goal separator rules.
- The live goal ticker includes fixture matchup context alongside goal time
  and scoring team.
- The signup screen no longer repeats “Create your account.” below the
  identical heading.
- Authentication failures use simpler user-facing copy instead of developer
  configuration details.
- Profile completion uses a consistent completion label and an inline
  spinner while submitting.
- Account endpoints can be routed through the same-origin Next.js auth proxy.
- A GET request to the refresh endpoint is now explicitly rejected with
  `405`; refresh is a POST-only session operation and should not be opened as
  a page in a browser.

The frontend auth-copy commit `e7cf023` is followed by changes in this
investigation to the same-origin account proxy and betting profile check.
Vercel is configured for automatic frontend deployment from `main`; pushing
code triggers that deployment, but a push alone does not prove the deployment
finished. Verify the Vercel deployment and deployed behavior before saying a
UI change is live.

## Production verification and current open issue

At the captured check:

- PM2 showed both `simsoccer-runtime` and `simsoccer-accounts` as `online`.
- World API `/api/health` returned `status: ok`.
- World status returned `RUNNING`.
- `sudo nginx -t` passed.
- The Accounts API `/api/health/live` returned `status: live`.
- Accounts API `/api/health/ready` was intermittent: it had returned `ready`
  after restarting only the Accounts API, but later returned
  `{"status":"not_ready"}` again. A direct dependency probe at an earlier
  point successfully connected to PostgreSQL, found the required auth tables,
  and received Redis `PONG`; that does not explain the later failed readiness
  check.
- A correctly formatted sign-in request using a nonexistent test address
  returned `401`, as expected for invalid credentials. No real account was
  used. This does not validate email delivery, signup completion, or profile
  completion.
- The public betting market endpoint returned `200` with market data during
  the check. This proves that endpoint responded at that moment; it does not
  verify every betting flow or the frontend's configured API URL.

**Open production issue:** Accounts API readiness returned `not_ready`
repeatedly while the world backend's readiness returned `ready`. The previous
readiness route did not identify which dependency failed. Account sign-in
requests also returned `500`; their old logs recorded only a generic `Error`,
not enough to prove the immediate failure cause.

One concrete reliability difference was found in source: the Accounts API's
shared Redis client used `retryStrategy: () => null`. Once that client
encountered a connection failure, it stopped reconnecting, while the world
runtime's BullMQ Redis connection uses the normal reconnecting client policy.
This can leave the account process online but unable to use Redis-backed
rate limits until it is restarted. The Accounts API is being changed to retry
Redis connections with a capped delay, report Redis connection errors without
logging secrets, expose separate PostgreSQL/Redis readiness booleans, and
return a service-unavailable response when Redis is disconnected. Account
profile lookups in the betting UI are also being routed through the
same-origin auth proxy rather than requiring a separate browser-side Accounts
API URL. These are source changes, not yet confirmed as deployed or effective
in production.

Do not claim the account service is healthy until the revised changes are
deployed, readiness remains `ready`, and authorized end-to-end account checks
pass. A PM2 `online` state means the process exists; it is not a dependency
health check and does not prove the API can serve auth requests.

Previously observed browser requests produced 500s on sign-in/signup. The
server logs available during investigation did not reveal the underlying
exception for those requests. Malformed JSON requests produced parser errors,
but that is separate from a correctly formatted request. A valid-format
synthetic sign-in after the API restart returned the expected 401; the actual
user account flow remains unverified.

## Source and deployed revision relationship

At the start of this investigation, local `main` was `e7cf023`, while the EC2
checkout reported `aaea6a7`. The website and EC2 APIs deploy separately. The
EC2 machine should not be pulled to the latest `main` just to publish a
frontend-only change.
Before a backend deployment, compare the planned commit's changed paths,
review database migration requirements, take/verify a backup when needed,
and follow the coordinated procedure in
[DEPLOYMENT-HANDOFF.md](./DEPLOYMENT-HANDOFF.md).

The existing deployment handoff contains older planning and validation
snapshots. Use this document's dated observations for the state recorded
above, and recheck production before making operational decisions.

## Operator guardrails

- Do not commit or share `wesheild.pem`, `.env` files, database credentials,
  Redis credentials, Resend secrets, private signing keys, session tokens, or
  email codes.
- Do not stop the EC2 instance or stop `simsoccer-runtime` to troubleshoot the
  website. Stopping the runtime pauses the live simulation.
- If only the Accounts API needs a restart and an authorized operator approves
  it, restart only `simsoccer-accounts`, then verify its readiness and the
  world API status. A restart is not a substitute for finding the cause of a
  recurring readiness failure.
- Do not rerun migrations, reset the world, truncate data, or seed production
  without an explicit reviewed procedure and verified backup.
- Never run automated test suites against production user/world data. Use an
  isolated database, Redis instance, and test inbox.
- After any deployment, record the Git SHA, migration result, PM2 state,
  health/readiness results, Nginx validation, and world status. Do not record
  secrets or personal account data.
