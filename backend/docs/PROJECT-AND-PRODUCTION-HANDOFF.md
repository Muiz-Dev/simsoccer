# SimSoccer Project and Production Handoff

- **Snapshot date:** 2026-10-05
- **Repository:** `Muiz-Dev/simsoccer`
- **Local `main` revision checked:** `e7cf023`
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

At the start of the investigation, `/api/world/status` showed Season 2, Round
17 of 38, with 30 live, 480 completed, and 630 scheduled fixtures across
Premier League, La Liga, and Serie A. After the Accounts API update was
activated, the world remained `RUNNING` and had advanced to Round 18, with 30
live, 510 completed, and 600 scheduled fixtures total. This confirms the
simulation continued while the Accounts API was built and restarted.

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

For the follow-up Accounts API reliability update, the 8 Accounts API tests
passed again on EC2 and the updated API compiled successfully. The first
compile attempt was killed (exit 137) while the old Accounts API was still
running; the retry stopped only that API, built into a separate output
directory, then activated the result. The world runtime stayed online.

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

The frontend auth-copy commit `e7cf023` is followed by the same-origin account
proxy and betting profile-check changes in `d7a308d`. Vercel is configured for
automatic frontend deployment from `main`; the deployment was verified by
checking the live refresh and account proxy routes after the update.

## Production verification and remaining limits

Initial checks found the issue below. After the fix was deployed, production
was rechecked:

- PM2 showed both `simsoccer-runtime` and `simsoccer-accounts` as `online`.
- World API `/api/health` returned `status: ok`.
- World API `/api/health/ready` returned `ready`; `/api/world/status` remained
  `RUNNING`.
- `sudo nginx -t` passed.
- The Accounts API `/api/health/live` returned `status: live`.
- Accounts API `/api/health/ready` returned
  `{"status":"ready","dependencies":{"postgres":true,"redis":true}}` on five
  consecutive public checks after deployment.
- A correctly formatted sign-in request using a nonexistent test address
  returned `401`, as expected for invalid credentials. No real account was
  used. This does not validate email delivery, signup completion, or profile
  completion.
- `GET /api/auth/refresh` returned `405` from the website and API; `POST
  /api/auth/refresh` without a refresh cookie returned `401`. Refresh is a
  session operation, not a browser page.
- The same-origin account profile endpoint returned the expected `401` when
  called without a session.
- The public betting markets endpoint returned `200` with fixture market
  data.

**Resolved production reliability defect:** Accounts API readiness had
repeatedly returned `not_ready` while the world backend was ready. Account
sign-in requests also returned `500`; the old logs recorded only a generic
`Error`, not enough to prove the immediate failure cause.

One concrete reliability difference was found in source: the Accounts API's
shared Redis client used `retryStrategy: () => null`. Once that client
encountered a connection failure, it stopped reconnecting, while the world
runtime's BullMQ Redis connection uses the normal reconnecting client policy.
This can leave the account process online but unable to use Redis-backed
rate limits until it is restarted. Commit `d7a308d` now retries Redis
connections with a capped delay, logs sanitized Redis connection metadata,
exposes separate PostgreSQL/Redis readiness booleans, and returns a
service-unavailable response when Redis is disconnected. Account profile
lookups in the betting UI now use the same-origin auth proxy instead of
requiring a separate browser-side Accounts API URL. The new account code was
built and activated on EC2 without stopping the world runtime.

Readiness and safe unauthenticated route checks pass after deployment. A PM2
`online` state by itself is still not a dependency health check. Signup email
delivery and a real account's end-to-end sign-in/profile flow have not been
tested.

Previously observed browser requests produced 500s on sign-in/signup. The
server logs from before the fix did not reveal the underlying exception for
those requests. Malformed JSON requests produced parser errors, but that is
separate from a correctly formatted request. A valid-format synthetic sign-in
after the fix returned the expected 401; the actual user account flow remains
unverified.

## Source and deployed revision relationship

At the start of this investigation, local `main` was `e7cf023`, while the EC2
checkout reported `aaea6a7`. The updated EC2 checkout is now `279f55f`, which
includes the Accounts API fix from `d7a308d`. The website and EC2 APIs deploy
separately. The EC2 machine should not be pulled to the latest `main` just to
publish a frontend-only change.
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
