"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import { getAccessToken } from "@/lib/auth-client";
import styles from "./page.module.css";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

type PaymentPackage = {
  id: string;
  credits: number;
  usdCents: number;
};

type PaymentOrder = {
  id: string;
  packageId: string;
  creditAmount: string;
  usdCents: number;
  solUsdPrice: string;
  priceProvider: string;
  priceObservedAt: string;
  expectedLamports: string;
  network: "devnet";
  treasuryAddress: string;
  payerAddress: string;
  referenceAddress: string;
  status: string;
  transactionSignature: string | null;
  reviewReason: string | null;
  expiresAt: string;
};

type PaymentConfig = {
  enabled: boolean;
  cluster: "devnet";
  packages: PaymentPackage[];
};

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect: () => Promise<{ publicKey: { toString(): string } }>;
  signAndSendTransaction: (
    transaction: import("@solana/web3.js").Transaction,
    options?: { preflightCommitment?: "confirmed" | "finalized" },
  ) => Promise<{ signature: string }>;
};

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
  }
}

const statusText: Record<string, string> = {
  PENDING: "Waiting for payment",
  SUBMITTED: "Payment sent",
  CONFIRMING: "Confirming on devnet",
  VERIFIED: "Payment verified",
  CREDITED: "Credits added",
  EXPIRED: "Quote expired",
  FAILED: "Transaction failed",
  UNDERPAID: "Payment amount is short",
  OVERPAID: "Payment amount needs review",
  REQUIRES_REVIEW: "Payment needs review",
};

function formatCredits(value: number | string): string {
  return Number(value).toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function formatSol(lamports: string): string {
  const amount = Number(BigInt(lamports)) / 1_000_000_000;
  return `${amount.toFixed(9).replace(/0+$/, "").replace(/\.$/, "")} SOL`;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    throw new Error("The payment service returned an unreadable response.");
  }
  return payload as Record<string, unknown>;
}

export default function CreditPurchasePage() {
  const router = useRouter();
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [selectedPackage, setSelectedPackage] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const polling = useRef(false);
  const orderIdempotencyKey = useRef<string | null>(null);

  const refreshOrder = useCallback(async (currentOrder: PaymentOrder, token: string) => {
    if (!API_URL || polling.current) return;
    polling.current = true;
    try {
      const response = await fetch(`${API_URL}/api/wallet/solana/orders/${currentOrder.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(typeof payload.message === "string" ? payload.message : "Payment status is temporarily unavailable.");
      }
      if (payload.order && typeof payload.order === "object") {
        setOrder(payload.order as PaymentOrder);
        setError("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment status is temporarily unavailable.");
    } finally {
      polling.current = false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          router.replace("/auth?next=/account/credits");
          return;
        }
        if (!API_URL) throw new Error("Credit purchases are temporarily unavailable.");
        const response = await fetch(`${API_URL}/api/wallet/solana/config`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = await readJson(response);
        if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : "Payment configuration could not be loaded.");
        if (active) setConfig(payload as unknown as PaymentConfig);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Credit purchases are temporarily unavailable.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (!order || ["CREDITED", "EXPIRED", "OVERPAID", "REQUIRES_REVIEW"].includes(order.status)) return;
    let active = true;
    const poll = async () => {
      try {
        const token = await getAccessToken();
        if (token && active) await refreshOrder(order, token);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Payment status is temporarily unavailable.");
      }
    };
    const timer = window.setInterval(() => void poll(), 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [order, refreshOrder]);

  useEffect(() => {
    if (!order) return;
    const updateTimeLeft = () => setSecondsLeft(Math.max(0, Math.ceil((new Date(order.expiresAt).getTime() - Date.now()) / 1000)));
    updateTimeLeft();
    const timer = window.setInterval(updateTimeLeft, 1_000);
    return () => window.clearInterval(timer);
  }, [order]);

  async function connectWallet() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const provider = window.phantom?.solana;
      if (!provider?.isPhantom) {
        throw new Error("Install the Phantom wallet extension, then return here to connect on devnet.");
      }
      const connection = await provider.connect();
      const address = connection.publicKey.toString();
      if (walletAddress && walletAddress !== address) orderIdempotencyKey.current = null;
      setWalletAddress(address);
      setOrder(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection was not completed.");
    } finally {
      setBusy(false);
    }
  }

  async function createOrder() {
    if (!config || !selectedPackage || !walletAddress) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const idempotencyKey = orderIdempotencyKey.current ?? crypto.randomUUID();
      orderIdempotencyKey.current = idempotencyKey;
      const token = await getAccessToken();
      if (!token) {
        router.replace("/auth?next=/account/credits");
        return;
      }
      const response = await fetch(`${API_URL}/api/wallet/solana/orders`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: selectedPackage, payerAddress: walletAddress, idempotencyKey }),
        cache: "no-store",
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : "A payment quote could not be created.");
      if (!payload.order || typeof payload.order !== "object") throw new Error("The payment service returned an invalid quote.");
      orderIdempotencyKey.current = null;
      setOrder(payload.order as PaymentOrder);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A payment quote could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function payWithPhantom() {
    if (!order) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await getAccessToken();
      if (!token) {
        router.replace("/auth?next=/account/credits");
        return;
      }
      const provider = window.phantom?.solana;
      if (!provider?.isPhantom) throw new Error("Reconnect your Phantom wallet to continue.");
      const connected = await provider.connect();
      const payerAddress = connected.publicKey.toString();
      if (payerAddress !== order.payerAddress) {
        setWalletAddress(payerAddress);
        throw new Error("The connected wallet changed. Create a new quote for this wallet.");
      }

      const { Connection, PublicKey, SystemProgram, Transaction, clusterApiUrl } = await import("@solana/web3.js");
      const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
      const lamports = BigInt(order.expectedLamports);
      if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("This quote is too large to send safely.");
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const transfer = SystemProgram.transfer({
        fromPubkey: new PublicKey(order.payerAddress),
        toPubkey: new PublicKey(order.treasuryAddress),
        lamports: Number(lamports),
      });
      transfer.keys.push({
        pubkey: new PublicKey(order.referenceAddress),
        isSigner: false,
        isWritable: false,
      });
      const transaction = new Transaction();
      transaction.feePayer = new PublicKey(order.payerAddress);
      transaction.recentBlockhash = blockhash;
      transaction.add(transfer);

      const { signature } = await provider.signAndSendTransaction(transaction, { preflightCommitment: "confirmed" });
      setOrder({ ...order, status: "SUBMITTED", transactionSignature: signature });
      setNotice("Payment sent. We’ll add credits only after the backend verifies the finalized devnet transaction.");

      const response = await fetch(`${API_URL}/api/wallet/solana/orders/${order.id}/submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ signature }),
        cache: "no-store",
      });
      const payload = await readJson(response);
      if (payload.order && typeof payload.order === "object") setOrder(payload.order as PaymentOrder);
      if (!response.ok) {
        throw new Error(typeof payload.message === "string"
          ? payload.message
          : "The transaction was sent, but verification is delayed. Keep this page open while we retry.");
      }
      setNotice(payload.order && (payload.order as PaymentOrder).status === "CREDITED"
        ? "Payment verified. SIM Credits have been added to your account."
        : "Payment sent. We’ll keep checking devnet and update your balance after verification.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The payment could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const selected = config?.packages.find((item) => item.id === selectedPackage);
  const terminal = order && ["CREDITED", "EXPIRED", "OVERPAID", "REQUIRES_REVIEW"].includes(order.status);
  const retryable = order && ["FAILED", "UNDERPAID"].includes(order.status) && secondsLeft > 0;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><SportsSoccerIcon aria-hidden="true" /><span>SimSoccer</span></Link>
        <Link className={styles.backLink} href="/account"><ArrowBackIcon fontSize="small" /> Account</Link>
      </header>

      <section className={styles.content} aria-labelledby="credits-title">
        <div className={styles.heading}>
          <p>Account balance</p>
          <h1 id="credits-title">Add SIM Credits</h1>
          <span>Connect a wallet, choose a package, and pay on Solana devnet.</span>
        </div>

        {loading ? <div className={styles.loading} role="status">Checking devnet payment settings…</div> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

        {!loading && config && !config.enabled ? (
          <section className={styles.unavailable} aria-label="Payments unavailable">
            <strong>Devnet checkout is not enabled</strong>
            <p>Credit purchases are not configured for this environment. No payment has been requested.</p>
          </section>
        ) : null}

        {!loading && config?.enabled ? (
          <div className={styles.checkout}>
            <section className={styles.walletPanel} aria-labelledby="wallet-title">
              <div className={styles.panelHeading}>
                <span className={styles.step}>1</span>
                <div><h2 id="wallet-title">Connect Phantom</h2><p>Your wallet signs the devnet transfer. It does not sign you in to SimSoccer.</p></div>
              </div>
              <div className={styles.walletActions}>
                <button className={styles.secondaryButton} type="button" onClick={() => void connectWallet()} disabled={busy}>
                  {walletAddress ? "Reconnect wallet" : "Connect wallet"}
                </button>
                {walletAddress ? <span className={styles.walletAddress}>{walletAddress.slice(0, 5)}…{walletAddress.slice(-5)}</span> : null}
              </div>
            </section>

            <section className={styles.packagePanel} aria-labelledby="package-title">
              <div className={styles.panelHeading}>
                <span className={styles.step}>2</span>
                <div><h2 id="package-title">Choose a package</h2><p>Each quote uses the current server-side SOL/USD price.</p></div>
              </div>
              <fieldset className={styles.packageList} disabled={!walletAddress || Boolean(order && !terminal && !retryable)}>
                <legend className={styles.visuallyHidden}>SIM Credits package</legend>
                {config.packages.map((item) => (
                  <label key={item.id} className={`${styles.packageOption} ${selectedPackage === item.id ? styles.packageSelected : ""}`}>
                    <input
                      type="radio"
                      name="credit-package"
                      value={item.id}
                      checked={selectedPackage === item.id}
                      onChange={() => setSelectedPackage(item.id)}
                    />
                    <span><strong>{formatCredits(item.credits)}</strong><small>SIM Credits</small></span>
                    <b>{formatUsd(item.usdCents)}</b>
                  </label>
                ))}
              </fieldset>
              {!order || terminal || retryable ? (
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={() => void createOrder()}
                  disabled={busy || !walletAddress || !selected}
                >
                  {busy ? "Creating quote…" : retryable ? "Create a new quote" : "Get payment quote"}
                </button>
              ) : null}
            </section>

            {order ? (
              <section className={styles.orderPanel} aria-labelledby="order-title">
                <div className={styles.panelHeading}>
                  <span className={styles.step}>3</span>
                  <div><h2 id="order-title">Payment order</h2><p className={`${styles.status} ${styles[`status${order.status}`] ?? ""}`}>{statusText[order.status] ?? "Payment pending"}</p></div>
                </div>
                <dl className={styles.quote}>
                  <div><dt>You receive</dt><dd>{formatCredits(order.creditAmount)} SIM Credits</dd></div>
                  <div><dt>Package value</dt><dd>{formatUsd(order.usdCents)}</dd></div>
                  <div><dt>Locked SOL amount</dt><dd>{formatSol(order.expectedLamports)}</dd></div>
                  <div><dt>SOL/USD at quote</dt><dd>${Number(order.solUsdPrice).toLocaleString("en-US", { maximumFractionDigits: 6 })}</dd></div>
                  <div><dt>Quote expires</dt><dd>{secondsLeft > 0 ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : "Expired"}</dd></div>
                </dl>

                {order.reviewReason ? <p className={styles.reviewReason}>{order.reviewReason} Contact support with the order ID if you believe this is incorrect.</p> : null}
                {order.transactionSignature ? (
                  <a className={styles.explorerLink} href={`https://explorer.solana.com/tx/${encodeURIComponent(order.transactionSignature)}?cluster=devnet`} target="_blank" rel="noreferrer">
                    View transaction on Solana Explorer
                  </a>
                ) : null}

                {order.status === "PENDING" && secondsLeft > 0 ? (
                  <button className={styles.primaryButton} type="button" onClick={() => void payWithPhantom()} disabled={busy}>
                    {busy ? "Waiting for wallet…" : `Pay ${formatSol(order.expectedLamports)} with Phantom`}
                  </button>
                ) : null}
                {retryable ? (
                  <p className={styles.retryNote}>This attempt did not complete the order. Create a fresh quote before trying again.</p>
                ) : null}
                {order.status === "CREDITED" ? (
                  <p className={styles.success}>Payment verified. Your SIM Credits are now in your existing account balance.</p>
                ) : null}
                {order.status === "EXPIRED" ? (
                  <p className={styles.retryNote}>This quote can no longer be used. Create a new one for the current SOL price.</p>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}

        <aside className={styles.devnetNote}>
          <strong>Devnet only</strong>
          <p>Use devnet SOL only and keep extra for the network fee. Devnet SOL has no cash value. SIM Credits remain in-game and cannot be transferred or withdrawn. Never send mainnet funds to this checkout.</p>
        </aside>
      </section>
    </main>
  );
}
