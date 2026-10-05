# Admin Panel and User Management

**Reviewed:** 2026-10-05  
**Release reviewed:** `b8bcf7e`

This document records the existing production admin functions, the account
management implementation now present in the local worktree, and remaining
rollout requirements. The new work is **not deployed**.

## Admin panel today

The Next.js page at `/admin` includes football-world operations:

- Show world status, active season, current round, and league/team/fixture
  counts.
- Create or update leagues and teams, including active/inactive state and
  team ratings.
- Show the latest 20 recorded admin changes.
- Authenticate with the primary four-digit admin PIN and an HTTP-only
  `sim_admin_session` cookie.

Local changes add a **Customer accounts** area: paginated search by email,
name, or account ID; a minimized profile, wallet, and activity summary;
suspension/restoration; and typed-confirmation anonymization. Mutations close
sessions, revoke device recognition and pending challenges, and write audit
entries. This work is local only; it has not been migrated or deployed.

The world backend exposes admin login/logout/session, summary, league, team,
and customer-account routes in `backend/src/app.ts`. Writes require the
existing admin session and origin check. Admin sessions have a 30-minute idle
expiry and an eight-hour absolute expiry. PIN attempts are rate-limited.
Operator attribution remains the shared hard-coded `primary` identity;
distinct admin accounts and permissions are still absent.

## Important identity and data constraints

The current admin identity is a single shared credential: `admin_credentials`
has the primary record, login returns the hard-coded actor `primary`, and the
panel has no distinct operator identities or permissions. The application's
`users.role` values do not provide separate identities for admin-panel actions.
This prevents reliable per-operator attribution and safe delegation.

Customer identity is held by the Accounts API; world, wallet, betting and
settlement data are in the world backend database. Both services connect to
the shared PostgreSQL data. A customer-management feature therefore crosses
both service boundaries and must not be implemented as a direct UI-only update.

Hard-deleting a user row is not currently a safe operation:

- `wallets.user_id` and `bets.user_id` have non-cascading foreign keys to
  `users`.
- Bet selections, settlements, and wallet transactions are retained records
  whose ownership and ledger links depend on stable parent rows.
- Authentication challenges, sessions, and devices currently cascade with
  their user, but that does not make deleting the user safe while wallet/bet
  references remain.
- Local changes add account status and enforce it in Accounts API
  authentication/refresh/session flows and the world backend JWT middleware.
  Suspended and anonymized accounts cannot continue authenticated betting.

Do not solve this by cascading through bets or transactions: that would erase
ticket and play-money ledger history and could break settlement/audit
reconciliation.

## Account-management behavior

The local admin UI keeps football tools intact and adds a separate
**Customer accounts** area with:

1. **Account search:** paginated email, name, or stable account ID lookup.
2. **Account overview:** active/suspended/anonymized state, profile basics,
   join date, wallet balance, ticket and wallet-entry totals, and active
   session count. Never display password hashes, raw tokens,
   email codes, device cookies, ticket access codes, or full IP addresses.
3. **Security actions:** suspend or restore access; suspension closes sessions,
   revokes device recognition, consumes pending auth codes, and is audited.
4. **Privacy action:** anonymization is allowed only after suspension and
   requires typing `ANONYMIZE <email>` (also checked by the API). It removes
   direct identifiers, session/device/challenge credentials, and public ticket
   lookup hashes while retaining the user row, wallet balance, bets,
   settlements, and wallet ledger.
5. **Audit history:** account actions appear in the existing latest-20 audit
   list. A filterable, paginated audit browser is not implemented.

Use separate confirmations for reversible suspension and irreversible privacy
erasure. A typed email/confirmation phrase should be required for erasure, and
the confirmation should state which profile fields are removed and which
non-identifying betting/ledger records remain.

### Recommended deletion semantics

The user selected **suspend first, then anonymize personal details while
preserving betting and wallet-ledger history**. The local implementation does
not hard-delete accounts or change financial/bet ownership. Legal retention
periods and jurisdiction-specific requirements still need review before
production use.

## Implementation prerequisites

Before deploying customer controls:

- Replace the shared PIN-only operator identity with individually attributable
  admin accounts, strong authentication, and explicit roles/permissions.
- Apply and test migration `0009_account_management.sql` on a staging copy.
- Review cross-service account status enforcement, mutation transactions,
  ticket-code revocation, and ledger retention against database-backed tests.
- Replace the shared PIN-only operator identity with individually attributable
  admin accounts, strong authentication, and explicit roles/permissions.
- Add database-backed tests for permissions, self-protection, active sessions,
  pending tickets, ledger preservation, retries, and rollback/recovery.
- Require recent authentication for high-impact admin actions. Keep action
  responses and logs free of raw personal data and credentials.
- Use staged migration and restore testing before production. Do not test
  mutations against production accounts.

## Customer account experience findings

Before the local refactor, `/account` combined profile display, wallet,
ticket-history shortcut, wallet transactions labelled “Recent activity,”
session/device actions, and a password-change form on one page.
The current session API reports session family, timestamps, whether a session
is current, and a boolean device-recognition signal; it does not provide a
reliable device name or browser/location description. Labeling every row as a
known device would overstate what the backend knows.

The local customer-facing structure now uses:

- **Account overview:** name/email, wallet balance, and clear links to My bets,
  transaction history, and Settings. Keep security forms off this page.
- **Settings:** profile details and a distinct Security section for password,
  signed-in sessions, and sign-out controls.
- **Transactions:** a dedicated ledger/history view with date, activity, and
  credit change; use “Transaction history,” not a generic “Recent activity.”
- **Session controls:** say “Signed-in sessions” unless actual device/browser
  labels are collected. Clearly distinguish “This session,” offer revoke-one
  and sign-out-everywhere actions, and show a concise success/failure notice.
- **Password change:** request an authenticated, purpose-bound email code,
  then submit the code and new password. Codes expire, are single-use, and are
  limited to five attempts. A successful change revokes old sessions and
  creates a fresh session for the current browser.
- **Loading and failure states:** reserve visible text for errors and next
  steps; use content-shaped skeletons for account, tables, markets, and lists.
  Use a small accessible progress indicator for an action in progress, with
  `aria-label`/status text for assistive technology. Do not show both a
  redundant “Loading…” sentence and a loader.

## Online references

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
  recommends reauthentication for sensitive features and risk events; it
  supports step-up verification for password/security changes.
- [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html) describes
  step-up authentication when a session needs a higher assurance level.
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
  treats a session token as equivalent to the authentication strength and
  emphasizes server-enforced session lifecycle and revocation.
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
  recommends least privilege and permission checks on every request; hiding
  admin controls in the UI is not authorization.
- [Google Account: Review devices](https://support.google.com/accounts/answer/3067630?hl=en)
  and [Apple: Check your Apple Account device list](https://support.apple.com/en-us/102649)
  show the value of reviewing sessions/devices with direct sign-out controls.
  SimSoccer's current API exposes less device detail and should label that
  limitation honestly.
- [Apple App Store Review Guidelines, 5.1.1(v)](https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage)
  requires in-app account deletion for apps that support account creation.
  This is an app-store rule, not general legal advice for this web application.
- [MUI Skeleton](https://mui.com/material-ui/react-skeleton/) recommends
  placeholders that resemble the content to come; skeletons are not focusable
  and have no ARIA attributes, so pair them with accessible status semantics.
- [WCAG 2.2: Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
  explains that status changes need to be programmatically available without
  forcing a focus change.
- [GOV.UK Design System: Notification banner](https://design-system.service.gov.uk/components/notification-banner/)
  distinguishes important page-level feedback from inline page content. Keep
  feedback brief and tied to the action rather than repeating explanatory
  text around every control.
