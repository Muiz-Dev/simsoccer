# Authentication email quality and deliverability

**Reviewed:** 2026-10-05
**Scope:** Transactional account emails sent by the Accounts API through Resend.

## Assessment

The Accounts API has one shared React Email template, used for email
verification, sign-in codes, password recovery, password-change confirmation,
and password-change notices. Updating that shared template updates every
current account email.

The previous template had a pale gray page around a white, bordered panel, a
second tinted panel behind the code, and a divider. It repeated the same
generic account-action/security sentence for messages that were not all
verification messages. Subjects and preheaders were duplicated from headings,
and the password-change message included a support instruction without a
configured support destination. The template sent React-rendered HTML without
an explicit plain-text body.

The revised template uses a pure-white page and one centered, fluid column. It
removes panels, decorative borders, and dividers; centers the content
consistently; uses compact but readable type with regular body weight; and
gives each email a distinct subject, heading, and preheader. One-time-code
messages get a short, accurate safety note. Password-change notices no longer
show irrelevant code language. Resend receives both HTML and plain text.

| Message | Subject | Main heading | Preheader |
| --- | --- | --- | --- |
| Email verification | Verify your SimSoccer email | Verify your email | Your email verification code |
| Sign-in code | Your SimSoccer sign-in code | Sign in to SimSoccer | Your one-time sign-in code |
| Password recovery | Reset your SimSoccer password | Reset your password | Your password reset code |
| Password-change confirmation | Password change confirmation | Confirm your password change | Your password change code |
| Password-changed notice | A security change to your account | Password changed | If this wasn't you, reset your password now. |

## Design and rendering rules

- Use a single-column layout with a centered outer container and consistent
  centered content. Avoid offset panels, card backgrounds, and decorative
  alignment that makes content appear to lean to one side.
- Keep the canvas white, with high-contrast dark text and the SimSoccer green
  used sparingly for identity and the one-time code.
- Use system fonts and simple inline CSS. Do not rely on web fonts, CSS grid,
  flexbox, background images, or external assets for essential content.
- Preserve a semantic heading, visible code text (not an image), meaningful
  preview text, and an explicit text/plain equivalent.
- Keep the code easy to select and copy. Never rely on color alone to convey
  instructions or security state.
- Keep body copy readable on narrow screens. The current 15px body and 13px
  note are intentionally not made smaller or very light; low contrast and
  thin lettering reduce legibility. WCAG's minimum contrast guidance is a
  useful baseline even where an email is not formally assessed as a web page.
- Authentication and password-change emails are transactional. Do not add a
  marketing unsubscribe link to security messages. If marketing or other
  subscription email is added, implement its consent/preference model and
  provider-supported RFC 8058 one-click List-Unsubscribe separately.

  ## Sign-in and trusted devices

  Password sign-in now sends an email code when the device has no active,
  recognized device record. After code verification, the existing random
  `ss_device` cookie is associated with the account in `auth_devices`. On a
  later password sign-in, the server hashes that HttpOnly cookie and checks for
  an active record belonging to the same account; if found, it creates a
  session without sending another code. Passwordless sign-in continues to
  require its one-time email code.

  Device recognition expires after 180 days without activity, matching the
  existing device cleanup policy and cookie lifetime. Password recovery,
  password changes, and “sign out on all devices” revoke device recognition as
  well as active sessions. The next password sign-in on those devices will
  therefore require an email code. A device cookie alone cannot authenticate an
  account: the password is still required for this sign-in path.

  This behavior reuses the existing `auth_devices` table from migration 0007;
  it does not require a database migration. The account settings UI and
  passwordless flow are unchanged.

Gmail documents support for inline styles and standard CSS, while noting that
unsupported selectors and properties can be ignored. Therefore, the template
sticks to simple inline typography, spacing, and text alignment rather than
depending on advanced layout features. Email rendering still varies by client;
the source template and automated rendering test are not substitutes for
sending visual test messages to Gmail web/mobile, Apple Mail, and Outlook.

## Deliverability and Gmail recognition

No HTML/CSS treatment can guarantee Gmail inbox placement or a special
"recognized" appearance. Gmail evaluates sender authentication, domain/IP
reputation, recipient engagement, complaints, message quality, and policy
compliance. A plain-text alternative and clean content improve robustness,
not reputation by themselves.

Google's sender guidance requires at least SPF or DKIM for all senders to
personal Gmail accounts. Bulk senders (more than 5,000 messages per day to
Gmail) must use SPF and DKIM, publish DMARC, and align the From domain with
SPF or DKIM. Google also calls for valid forward/reverse DNS, TLS, RFC 5322
formatting, and a spam rate below 0.3%. Google requires one-click unsubscribe
for marketing/subscription messages at the bulk-sender threshold; this
requirement is not a reason to put unsubscribe controls into authentication
messages.

Yahoo's sender guidance likewise emphasizes authentication, low complaints,
valid DNS, and one-click unsubscribe for marketing/subscription mail. Resend
recommends verified sending domains and describes separating transactional
traffic onto a subdomain to isolate reputation.

### Public DNS spot-check

The production From address was observed as `no-reply@email.muizdev.xyz`.
Public DNS lookups on 2026-10-05 found:

- `send.email.muizdev.xyz` publishes an SPF record authorizing Amazon SES and
  has the SES feedback MX record.
- `resend._domainkey.email.muizdev.xyz` publishes a DKIM public-key TXT
  record.
- `_dmarc.muizdev.xyz` publishes `p=quarantine` and `sp=quarantine`, with
  relaxed DKIM alignment (`adkim=r`) and strict SPF alignment (`aspf=s`).
- `_dmarc.email.muizdev.xyz` has no direct TXT record. The parent DMARC
  subdomain policy (`sp=quarantine`) therefore applies.

These DNS records are encouraging, but the DNS lookup cannot prove that a
delivered message passed SPF, DKIM, and DMARC or that it reached Inbox. In
particular, strict SPF alignment can fail if the message's authenticated
MAIL FROM domain is `send.email.muizdev.xyz` while its visible From domain is
`email.muizdev.xyz`. An aligned DKIM signature may still satisfy DMARC, but
the only reliable confirmation is the `Authentication-Results` header from a
real received test message. Do not change DNS based on this observation alone.

Production authentication, recent Gmail/Yahoo complaint rates, and inbox
placement were not verified in this code/design review. Configure the domain
in Google Postmaster Tools and inspect message headers and Resend delivery
events before claiming deliverability is confirmed.

## Recommended verification before release

1. Run the Accounts API unit tests and TypeScript build.
2. Send controlled test messages to Gmail web and mobile, plus at least one
   Outlook or Apple Mail account. Check narrow-screen rendering, visible
   subject/preheader, copyable code, and text/plain fallback.
3. In the received Gmail message, inspect `Authentication-Results` for
   `spf=pass`, `dkim=pass`, and `dmarc=pass`; confirm the authenticated domain
   alignment and compare it with the production From domain.
4. Check Resend's domain verification and event logs, bounces, complaints, and
   suppression list. Monitor the domain in Google Postmaster Tools where data
   is available; low-volume transactional traffic may not produce useful
   Postmaster dashboards.
5. Keep authentication mail transactional and send only to addresses tied to
   the account action. Do not send promotional content from this flow.

## Sources

- [Google: Email sender guidelines](https://support.google.com/mail/answer/81126?hl=en)
- [Google: DMARC setup](https://support.google.com/a/answer/2466580?hl=en)
- [Google: Postmaster Tools](https://support.google.com/mail/answer/9981691?hl=en)
- [Google: CSS support in Gmail](https://developers.google.com/gmail/design/css)
- [Yahoo: Sender requirements and best practices](https://senders.yahooinc.com/best-practices/)
- [Resend: Verified domains](https://resend.com/docs/dashboard/domains/introduction)
- [Resend: Send email API](https://resend.com/docs/api-reference/emails/send-email)
- [Can I email: HTML table support](https://www.caniemail.com/features/html-table/)
- [Can I email: CSS display support](https://www.caniemail.com/features/css-display/)
- [W3C: WCAG 2.2 contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [RFC 8058: Signaling one-click unsubscribe](https://datatracker.ietf.org/doc/html/rfc8058)
