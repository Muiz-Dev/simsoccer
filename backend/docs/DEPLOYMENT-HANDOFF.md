# SimSoccer Deployment Handoff

**Updated:** 2026-10-05
**Repository:** `Muiz-Dev/simsoccer`
**Custom-auth branch:** `feature/custom-auth-jwks`

## Read this before deploying

This branch replaces Supabase Auth with first-party accounts. It changes the
authentication protocol used by the website, Accounts API, and world API, and
adds a database migration. Deploy it as one coordinated cutover; do not deploy
only the frontend or only one API. The migration preserves the unused legacy
`users.auth_subject` column for rollback compatibility; new code does not read
or write it.

The current environment is a small EC2 instance running the live simulation.
Stopping PM2 services pauses the world; stopping or terminating the EC2
instance is not required. Do not run world-reset commands as part of this
deployment. Never run the Accounts API tests against production data.

## Authentication behavior

- Registration creates a unique, normalized-email account and sends an
  eight-digit verification code.
- Passwords are 12–128 characters, allow passphrases, and are hashed with
  Argon2id (19 MiB memory, two iterations, one lane). Hash work is concurrency
  limited for the small production instance.
- Password sign-in requires both the password and a one-time email code.
- Passwordless sign-in uses an email code; it never creates a new account.
- Verification and recovery codes expire after 10 minutes and allow at most
  five attempts. Responses avoid confirming whether an address is registered.
- Password recovery changes the password and revokes every refresh-token
  session for that account.
- Access tokens are RS256 JWTs with a 10-minute lifetime, the configured issuer,
  audience `simsoccer-api`, local user UUID subject, and session-family ID.
  World API validates them using the Accounts API JWKS endpoint and checks
  that the session family remains active.
- Refresh credentials are random opaque values, stored as keyed hashes and
  rotated on use. Refresh-token reuse revokes the complete token family.
  Refresh lifetime is 30 days.
- The website keeps access tokens in memory. A same-origin Next.js route proxies
  auth requests so the refresh value can stay in a `Secure`, `HttpOnly`,
  `SameSite=Lax` cookie on the website's own host.
- Device recognition is a random first-party cookie, not a browser
  fingerprinting factor. The database stores only its keyed hash. User-agent
  and IP signals are also keyed hashes; raw values are not stored. Expired
  sessions/challenges and stale device records are purged during auth writes.

Existing users do not have passwords copied from the former identity provider.
Accounts whose old identity was verified are marked verified by the migration;
they can use the email-code flow or reset a password to establish a password.
Existing account IDs, wallets, bets, and the simulation world are retained.

Email codes are an additional verification step, not phishing-resistant MFA:
control of the email account can defeat both steps. Do not describe this as
NIST AAL2 or equivalent high-assurance MFA. Add WebAuthn/passkeys or TOTP as a
separate factor before making that claim.

## Required configuration

Keep secrets in the server's protected environment file/secret manager only.
Do not copy `.env` values into chat, commits, logs, or this document.

### Accounts API (`PORT=8090`)

Keep the existing `DATABASE_URL`, `REDIS_URL`, `RESEND_API_KEY`,
`EMAIL_FROM`, `APP_ALLOWED_ORIGINS`, and `TRUST_PROXY_HOPS` values. Add:

```env
AUTH_ISSUER=https://simapi.muizdev.xyz
AUTH_PRIVATE_JWK=<one-line RSA private JWK JSON; private>
AUTH_TOKEN_PEPPER=<stable random secret, at least 32 characters>
AUTH_ADDITIONAL_PUBLIC_JWKS=[]
```

Generate a fresh RSA signing key on the server using the installed `jose`
package or an approved secret-management process. Restrict the private value
to the Accounts API process and backups. Never publish it in JWKS. The pepper
must be stable: changing it invalidates refresh tokens, device recognition,
and outstanding verification codes. Do not reuse `ADMIN_PIN_PEPPER`.

For key rotation, publish the next key as an additional public key before
switching the active private JWK. Wait longer than the Accounts API JWKS cache
max-age, switch the signer, keep the previous public key available for the
maximum access-token lifetime plus cache duration, then remove the old key.
Do not delete a signing key while valid tokens signed by it may still be used.

### World backend (`PORT=8080`)

Keep the existing database, Redis, admin, simulation, and migration settings.
Add:

```env
AUTH_ISSUER=https://simapi.muizdev.xyz
AUTH_JWKS_URL=https://simapi.muizdev.xyz/api/auth/.well-known/jwks.json
```

The issuer must exactly match the Accounts API issuer. Vercel must have
`ACCOUNTS_API_URL=https://simapi.muizdev.xyz` configured for the server-side
auth proxy. The existing `NEXT_PUBLIC_ACCOUNTS_API_URL` remains necessary for
authenticated account/wallet requests made by the browser.

Remove the old `SUPABASE_*` and `SEND_EMAIL_HOOK_SECRET` settings from the
Accounts API and backend environments after confirming no unrelated route
still uses them. Keep the configured Resend key and sender; they deliver the
new verification and recovery messages.

## EC2 access

The live backend is the Ubuntu EC2 instance `i-071f530b475f93dd3` in
`eu-north-1`, currently reachable at
`ec2-13-61-146-106.eu-north-1.compute.amazonaws.com` (public IPs can change).
SSH access requires the operator-provisioned private key. Keep it outside Git,
restrict its Windows ACL to the operator account, and do not copy it into
project documentation or send it to other developers. A developer without
that key must request their own authorized access; do not share private keys.

From PowerShell, connect as `ubuntu` using the authorized key:

```powershell
ssh -i $env:SIMSOCCER_SSH_KEY -o IdentitiesOnly=yes ubuntu@ec2-13-61-146-106.eu-north-1.compute.amazonaws.com
```

On a verified host-key change, confirm the EC2 host identity out of band and
use a temporary known-hosts file rather than disabling host-key checking.
Prefer stopping only the PM2 processes when pausing the simulation; stopping
the EC2 instance also stops the test host.

## Nginx routing

Route the Accounts API prefixes before the general `/api/` world-backend
location. Preserve the full request URI and forward the real client/proxy
headers. Example for the existing localhost ports:

```nginx
location ^~ /api/auth/ {
    proxy_pass http://127.0.0.1:8090;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location ^~ /api/account/ {
    proxy_pass http://127.0.0.1:8090;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Do not retain the old `/api/hooks/supabase/email` route. Validate the Nginx
configuration before reloading it. Confirm that
`https://simapi.muizdev.xyz/api/auth/.well-known/jwks.json` returns only public
RSA key fields and that `http://127.0.0.1:8090/api/health/ready` is ready.

## Preflight and non-production test

1. Confirm a recent database backup and verify that it can be restored to an
   isolated test database. Do not test migration rollback on the live database.
2. Before applying migration 0007, run this read-only check against the
   intended database. Resolve duplicates before deployment; the migration
   intentionally refuses to install case-insensitive email uniqueness if
   duplicate addresses exist:

   ```sql
   SELECT lower(email), count(*)
   FROM users
   GROUP BY lower(email)
   HAVING count(*) > 1;
   ```

3. Use a cloned/test PostgreSQL database and isolated Redis. Configure the
   Accounts API test environment to those endpoints, never the production
   database. The backend migration guard treats every non-local database as
   protected. After verifying that `DATABASE_URL` points to the isolated clone,
   temporarily set `ALLOW_PRODUCTION_MIGRATIONS=true` only in that test
   environment to apply migration 0007. Remove the override before running
   other commands. Never use this test override with production credentials.
   Then run:

   ```bash
   cd ~/simsoccer/backend
   npm ci
   ```

   After confirming the test environment points only at the restored clone:

   ```bash
   cd ~/simsoccer/backend
   npm run db:migrate
   npm test
   npm run build
   cd ~/simsoccer/accounts-api
   npm ci
   npm test
   npm run build
   ```

   Run the backend test with `DATABASE_URL` and `REDIS_URL` pointing to the
   isolated test services; it performs dependency/world-state checks when
   services are available. The Accounts API unit suite covers validation, OTP
   format, and JWT/JWKS behavior, but does not yet provide database-backed
   registration/session integration coverage. The full auth smoke matrix is a
   separate required staging check; never point tests at production.
4. Run the full auth smoke matrix on a staging deployment with a dedicated
   test inbox: new signup/verify, duplicate signup, password + code sign-in,
   wrong/expired/replayed code, passwordless sign-in, refresh rotation and
   replay, sign-out/current-session revocation, sign out everywhere, password
   reset, profile completion, wallet read, and authenticated bet placement.
   Check that unverified/invalid users cannot access account, wallet, or bet
   APIs and that no duplicate wallet/account is created after retries.

## Coordinated production cutover

Do this only after the staged migration and smoke matrix pass and the new
commit is available on the server. The world simulation is paused while its
PM2 services are stopped; no world reset or data truncation is part of this
procedure.

1. Confirm environment values exist without printing them, check free disk and
   memory, and ensure the rotated email/API credentials work.
2. Stop both services (not the EC2 instance):

   ```bash
   pm2 stop simsoccer-runtime simsoccer-accounts
   ```

3. Fetch and check out the approved branch/commit, then install packages and
   build each API. Ensure the backend migration gate is explicitly enabled for
   the single migration run; do not let `prebuild` unexpectedly migrate:

   ```bash
   cd ~/simsoccer
   git fetch origin feature/custom-auth-jwks
   git checkout --detach origin/feature/custom-auth-jwks
   cd accounts-api
   npm ci
   npm run build
   cd ../backend
   npm ci
   ```

   Run `npm run build` in the backend with migration-on-build disabled in its
   protected environment file. The migration has already been applied in the
   isolated database.

4. With the confirmed production backup and preflight checks in place, set
   `ALLOW_PRODUCTION_MIGRATIONS=true` temporarily in the protected backend
   environment file and run this once:

   ```bash
   cd ~/simsoccer/backend
   npm run db:migrate
   ```

   Verify migration 0007 is recorded. Set `MIGRATE_BEFORE_BUILD=false` in the
   protected environment before building, to avoid an implicit second run:

   ```bash
   npm run build
   ```

   The new code no longer depends on `auth_subject`; the legacy column remains
   untouched for safer rollback.
5. Validate/reload Nginx and start both PM2 services with updated environment:

   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   pm2 restart simsoccer-accounts --update-env
   pm2 restart simsoccer-runtime --update-env
   pm2 save
   ```

6. Check both local health endpoints, external JWKS, world status, and PM2 logs.
   Do not log tokens, code values, cookies, or environment contents. Run a
   controlled sign-in using a known test account, then verify betting and
   wallet requests. Check that the simulation coordinator resumes and that its
   persisted round/fixtures did not change unexpectedly.
7. Remove temporary migration flags and stale identity-provider auth/hook
   secrets from EC2 and Vercel only after the new auth flow and backend token
   validation are confirmed. Retain old provider credentials only if another
   non-auth feature still explicitly requires them.

If the migration preflight or either API health check fails, keep user-facing
auth closed and report the sanitized error. Do not run world reset, truncate
tables, or restore a whole production database after new betting writes. Prefer
a forward migration/fix; full restore requires an explicit recovery decision.

## Research references

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — Argon2id, salts, and the implemented 19 MiB / 2 iteration / 1 lane baseline.
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) — generic authentication errors, password policy, and abuse controls.
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) — session protection, expiry, rotation, and revocation.
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) — current digital-authenticator guidance; email codes should not be represented as phishing-resistant MFA.
- [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie) — `HttpOnly`, `Secure`, `SameSite`, and cookie-scope behavior.

## Local validation and current limitation

The developer workstation is intentionally not used for builds, tests, or
linting for this task. Remote tests must use a dedicated test DB/Redis before
any production migration. EC2 access is available to the authorized operator,
but no custom-auth test, migration, or deployment has been run yet. Do not
claim validation or deployment completed until the staged commands have
actually succeeded.
