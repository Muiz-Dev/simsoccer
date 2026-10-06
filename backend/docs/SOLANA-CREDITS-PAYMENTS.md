# Solana SIM Credits Payments

**Status:** Opt-in devnet prototype; mainnet payments are disabled and unsupported  
**Scope:** Native SOL payment orders that can credit the existing off-chain `VIRTUAL` wallet  
**Out of scope:** Custom programs, SIM Credit tokens, TGE, withdrawals, transfers, prizes, and on-chain betting

## Product and accounting boundary

Solana is only a payment rail. The database remains authoritative for SIM Credits, bets, odds, market state, and settlement. A finalized devnet payment can add a `SOLANA_PURCHASE_CREDIT` entry to the existing `wallet_transactions` ledger and increase the user's existing `VIRTUAL` balance. Bet placement and settlement are unchanged.

The checkout offers fixed packages of 1,000 credits for USD 1 and 5,000 credits for USD 5. Credits stay in-game and cannot be transferred or withdrawn. Devnet SOL has no cash value. The presence of this devnet prototype is not approval to sell credits or accept paid wagers on mainnet; obtain qualified legal and jurisdictional review first.

## Files and data model

- `src/payments/price-service.ts` obtains and validates the SOL/USD quote.
- `src/payments/solana-rpc.ts` pins the configured RPC to devnet and performs read-only chain queries.
- `src/payments/solana-payment-service.ts` creates immutable quotes, validates transactions, reconciles exceptions, and credits the existing ledger.
- `src/payments/reconciliation.ts` polls recent orders every 30 seconds from the API process; `src/index.ts` starts and stops it.
- `src/app.ts` exposes authenticated payment endpoints.
- `src/db/schema/index.ts` defines `solana_payment_orders` and `solana_payment_attempts`.
- `drizzle/0013_solana_credit_payments.sql` is the versioned schema migration.
- `../../frontend/src/app/account/credits/` contains the Phantom devnet checkout.

`solana_payment_orders` records the account, fixed package, package value in cents, CoinGecko price and observation/fetch timestamps, expected lamports, payer, treasury, devnet, unique reference, lifecycle status, expiry, and credit/verification timestamps. Its scoped idempotency key and unique reference prevent duplicate order creation and reference collisions.

`solana_payment_attempts` records each observed signature once, its amount, block time, result, and reconciliation detail. A failed or incorrect attempt does not erase evidence or prevent a later exact payment before expiry. The transaction signature is globally unique in this table.

## API

All routes below require an authenticated, active local account:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/wallet/solana/config` | Returns devnet availability and fixed packages. |
| `POST` | `/api/wallet/solana/orders` | Creates or replays an idempotent price-locked order. Body: `packageId`, `payerAddress`, `idempotencyKey`. |
| `GET` | `/api/wallet/solana/orders/:orderId` | Returns the user's order and triggers a reference scan. |
| `POST` | `/api/wallet/solana/orders/:orderId/submit` | Records the wallet-reported signature as a verification hint; the server independently checks it. |
| `GET` | `/api/admin/solana-payments/review` | Admin-session-only list of exceptional orders and their recorded attempts. |

The browser never supplies the exchange rate, recipient, amount to credit, or network. Those are fixed or captured by the backend order.

## Price and amount

The server requests `solana` / `usd` from CoinGecko's **keyless public Simple Price API**, with `include_last_updated_at=true` and no API-key header. Concurrent requests in one API process share one fetch; successful results are cached for 60 seconds to match the public API's documented cache interval and reduce calls against its shared IP-based rate pool. The service also requires the source timestamp to be no more than three minutes old. Stale or failed price data fails order creation; there is no stale-price fallback.

The keyless endpoint is appropriate for this opt-in devnet prototype, not production-volume pricing: CoinGecko documents a dynamic shared limit of roughly 10–30 calls per minute and warns against production workloads. The API cache is process-local, so running multiple instances multiplies requests. Before production or higher request volume, choose a supported price feed/API plan and consider a shared cache with explicit rate-limit backoff. The returned price and both provider/server timestamps are stored with the order. The stored quote is never recalculated after creation.

Lamports are calculated with decimal arithmetic and half-up rounding:

```text
round_half_up((package_usd_cents / 100) / sol_usd_price * 1,000,000,000)
```

The result is stored as an integer decimal string, not a floating-point balance. For example, USD 5 at USD 200/SOL is 25,000,000 lamports (0.025 SOL).

## References, verification, and reconciliation

Each order receives a random 32-byte base58 reference generated on the server. The checkout adds this non-signing reference to the wallet transfer instruction. Wallet connection is not SimSoccer authentication; only the existing account session identifies the credit recipient.

No third-party webhook is enabled. The client's signature is only a hint. The server periodically calls `getSignaturesForAddress` on the order reference, then fetches candidate transactions using `getTransaction` at `finalized` commitment. It checks the RPC genesis hash is devnet, transaction execution succeeded, the transaction signature matches, the order reference is present, the expected payer signed, the transaction contains exactly one native SOL transfer from that payer to the stored treasury (plus optional compute-budget instructions), the amount exactly matches expected lamports, and the on-chain block time falls within the locked order window.

The reference poller runs every 30 seconds and checks recent non-credited orders; polling can also be triggered by the authenticated status route. Provider outages are logged and surfaced as a pending/retryable status; they never cause a credit. Orders older than the automated 24-hour recovery window and exceptional cases require operational investigation using the order and attempt records.

On an exact timely payment, one PostgreSQL transaction locks the order and wallet, inserts the globally unique attempt and idempotent wallet ledger row, adjusts the balance, then marks the order credited. A unique `wallet_transactions.idempotency_key` (`solana-payment:<order-id>`) prevents a second credit. A failed transaction, underpayment, overpayment, late payment, reused signature, or transaction mismatch is retained as a failed/review attempt and does not credit the wallet. Underpayment and failed orders can still receive a later exact payment before expiry.

Lifecycle values include `PENDING`, `SUBMITTED`, `CONFIRMING`, `CREDITED`, `EXPIRED`, `FAILED`, `UNDERPAID`, `OVERPAID`, and `REQUIRES_REVIEW`. `VERIFIED` is used for the recorded on-chain attempt while wallet credit and order completion commit atomically as `CREDITED`.

## End-to-end flow

1. The signed-in user connects Phantom on the checkout page and chooses a fixed package.
2. The browser sends a package ID, payer public key, and fresh idempotency UUID.
3. The backend fetches a fresh server-side quote, computes exact lamports, generates the unique reference, and persists a ten-minute order.
4. Phantom signs and submits one native SOL transfer on devnet to the order's recipient and amount, including the order reference.
5. The client submits the resulting signature, but the backend uses its own devnet RPC to verify the finalized transaction.
6. The backend marks attempts and exceptions for reconciliation. Only a matching, timely, exact payment can be applied to the existing `VIRTUAL` wallet and ledger.
7. The API process continues reference polling if the browser closes or its signature callback fails.

## Environment and rollout

| Variable | Default | Notes |
| --- | --- | --- |
| `SOLANA_PAYMENTS_ENABLED` | `false` | Set to `true` to enable devnet credit purchases. |
| `SOLANA_CLUSTER` | `devnet` | Only `devnet` is accepted by this build. |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | Use a devnet RPC URL. Its genesis hash is checked before use. |
| `SOLANA_TREASURY_ADDRESS` | unset | Required and validated when the feature is enabled. Public address only. |
| `SOLANA_PAYMENT_ORDER_TTL_SECONDS` | `600` | Valid range: 60–1,800 seconds. |

CoinGecko uses its keyless public endpoint; no API key or API-key environment variable is required.

The feature accepts only devnet; set `SOLANA_CLUSTER=devnet` in the backend environment. Never put a treasury private key in application or browser configuration. Do not enable mainnet deposits or purchased wagering.

## Research sources

- [Solana payment overview](https://solana.com/docs/payments/accept-payments)
- [Solana Pay URL and reference fields](https://solana.com/docs/payments/accept-payments/solana-pay) — the current page marks Commerce Kit APIs beta/draft; this implementation builds the standard transfer instruction directly.
- [Solana `getSignaturesForAddress`](https://solana.com/docs/rpc/http/getsignaturesforaddress)
- [Solana `getTransaction` commitments](https://solana.com/docs/rpc/http/gettransaction)
- [Solana production readiness and RPC guidance](https://solana.com/docs/tools/production-readiness)
- [Phantom transaction signing](https://docs.phantom.com/solana/sending-a-transaction)
- [CoinGecko Simple Price API](https://docs.coingecko.com/reference/simple-price)
- [CoinGecko Keyless Public API](https://docs.coingecko.com/docs/keyless-public-api)
