"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionFeature,
} from "@solana/wallet-standard-features";
import bs58 from "bs58";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import type { Transaction } from "@solana/web3.js";
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
  customTopUp: {
    minCredits: number;
    maxCredits: number;
    stepCredits: number;
    creditsPerUsd: number;
  };
};

type LegacySolanaProvider = {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  isBraveWallet?: boolean;
  name?: string;
  icon?: string;
  publicKey?: { toString(): string } | null;
  connect: () => Promise<{ publicKey?: { toString(): string } } | void>;
  signAndSendTransaction: (
    transaction: Transaction,
    options?: { preflightCommitment?: "confirmed" | "finalized" },
  ) => Promise<{ signature: string }>;
};

type StandardSolanaWallet = Wallet & {
  features: Wallet["features"] & StandardConnectFeature & SolanaSignAndSendTransactionFeature;
};

type ConnectedWallet = {
  id: string;
  name: string;
  address: string;
  signAndSendTransaction: (transaction: Transaction) => Promise<string>;
};

type WalletChoice = {
  id: string;
  name: string;
  icon: string | null;
  connect: () => Promise<ConnectedWallet>;
};

declare global {
  interface Window {
    phantom?: { solana?: LegacySolanaProvider };
    solana?: LegacySolanaProvider;
    solflare?: LegacySolanaProvider;
    backpack?: { solana?: LegacySolanaProvider };
    braveSolana?: LegacySolanaProvider;
  }
}

function supportsDevnetWallet(wallet: Wallet): wallet is StandardSolanaWallet {
  const connect = wallet.features[StandardConnect];
  const send = wallet.features[SolanaSignAndSendTransaction];
  return wallet.chains.includes("solana:devnet")
    && typeof connect === "object"
    && connect !== null
    && "connect" in connect
    && typeof connect.connect === "function"
    && typeof send === "object"
    && send !== null
    && "signAndSendTransaction" in send
    && typeof send.signAndSendTransaction === "function";
}

function standardWalletChoice(wallet: StandardSolanaWallet): WalletChoice {
  return {
    id: `standard:${wallet.name}`,
    name: wallet.name,
    icon: wallet.icon,
    connect: async () => {
      const { accounts } = await wallet.features[StandardConnect].connect();
      const account: WalletAccount | undefined = accounts.find((item) => (
        item.chains.includes("solana:devnet")
        && item.features.includes(SolanaSignAndSendTransaction)
      ));
      if (!account) throw new Error("No devnet account is available in this wallet.");
      const signAndSend = wallet.features[SolanaSignAndSendTransaction].signAndSendTransaction;
      return {
        id: `standard:${wallet.name}`,
        name: wallet.name,
        address: account.address,
        signAndSendTransaction: async (transaction) => {
          const [result] = await signAndSend({
            account,
            chain: "solana:devnet",
            transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
            options: { preflightCommitment: "confirmed" },
          });
          if (!result?.signature) throw new Error("The wallet did not return a transaction signature.");
          return bs58.encode(result.signature);
        },
      };
    },
  };
}

function legacyWalletChoice(id: string, name: string, provider: LegacySolanaProvider): WalletChoice {
  return {
    id,
    name,
    icon: typeof provider.icon === "string" && provider.icon.startsWith("data:image/") ? provider.icon : null,
    connect: async () => {
      const connection = await provider.connect();
      const address = connection?.publicKey?.toString() ?? provider.publicKey?.toString();
      if (!address) throw new Error("The wallet did not return an account.");
      return {
        id,
        name,
        address,
        signAndSendTransaction: async (transaction) => {
          const { signature } = await provider.signAndSendTransaction(transaction, {
            preflightCommitment: "confirmed",
          });
          return signature;
        },
      };
    },
  };
}

function detectWalletChoices(): WalletChoice[] {
  const wallets = getWallets();
  const standardChoices = wallets.get().filter(supportsDevnetWallet).map(standardWalletChoice);
  const seenProviders = new Set<LegacySolanaProvider>();
  const legacyCandidates: Array<[string, string, LegacySolanaProvider | undefined]> = [
    ["phantom", "Phantom", window.phantom?.solana],
    ["solflare", "Solflare", window.solflare],
    ["backpack", "Backpack", window.backpack?.solana],
    ["brave", "Brave Wallet", window.braveSolana],
    ["solana", "Solana Wallet", window.solana],
  ];
  const knownNames = new Set(standardChoices.map((choice) => choice.name.toLowerCase()));
  const legacyChoices = legacyCandidates.flatMap(([id, name, provider]) => {
    if (!provider || typeof provider.connect !== "function" || typeof provider.signAndSendTransaction !== "function") return [];
    if (seenProviders.has(provider)) return [];
    seenProviders.add(provider);
    if (knownNames.has(name.toLowerCase())) return [];
    const isKnownProvider = id === "solana"
      ? Boolean(provider.isPhantom || provider.isSolflare || provider.isBackpack || provider.isBraveWallet || provider.name)
      : true;
    return isKnownProvider ? [legacyWalletChoice(id, name, provider)] : [];
  });
  return [...standardChoices, ...legacyChoices];
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
  const [customCreditAmount, setCustomCreditAmount] = useState("");
  const [walletChoices, setWalletChoices] = useState<WalletChoice[]>([]);
  const [activeWallet, setActiveWallet] = useState<ConnectedWallet | null>(null);
  const [walletChooserOpen, setWalletChooserOpen] = useState(false);
  const [connectingWalletId, setConnectingWalletId] = useState<string | null>(null);
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const polling = useRef(false);
  const orderIdempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    const wallets = getWallets();
    const updateWallets = () => setWalletChoices(detectWalletChoices());
    updateWallets();
    const unregisterAdded = wallets.on("register", updateWallets);
    const unregisterRemoved = wallets.on("unregister", updateWallets);
    return () => {
      unregisterAdded();
      unregisterRemoved();
    };
  }, []);

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
        if (active) {
          const paymentConfig = payload as unknown as PaymentConfig;
          setConfig(paymentConfig);
          setSelectedPackage(paymentConfig.packages[0]?.id ?? "");
          setCustomCreditAmount(String(paymentConfig.customTopUp.minCredits));
        }
      } catch {
        if (active) setError("Credit purchases are unavailable. Try again later.");
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

  async function connectWallet(choice: WalletChoice): Promise<ConnectedWallet | null> {
    setConnectingWalletId(choice.id);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const connected = await choice.connect();
      if (activeWallet && activeWallet.address !== connected.address) orderIdempotencyKey.current = null;
      setActiveWallet(connected);
      setOrder(null);
      setWalletChooserOpen(false);
      return connected;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection failed.");
      return null;
    } finally {
      setConnectingWalletId(null);
      setBusy(false);
    }
  }

  async function continueCheckout() {
    if (activeWallet) {
      await createOrder(activeWallet.address);
    } else if (walletChoices.length === 0) {
      setError("No Solana wallet found. Install a wallet and try again.");
    } else {
      setWalletChooserOpen(true);
    }
  }

  async function createOrder(payerAddress: string) {
    if (!config || !selectedPackage || !payerAddress) return;
    const customAmount = selectedPackage === "custom" ? Number(customCreditAmount) : undefined;
    if (selectedPackage === "custom" && !customCreditAmountValid) return;
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
        body: JSON.stringify({
          packageId: selectedPackage,
          ...(customAmount === undefined ? {} : { creditAmount: customAmount }),
          payerAddress,
          idempotencyKey,
        }),
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

  async function payWithWallet() {
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
      if (!activeWallet) throw new Error("Reconnect your wallet to continue.");
      if (activeWallet.address !== order.payerAddress) {
        throw new Error("The connected wallet changed. Create a new quote.");
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

      const signature = await activeWallet.signAndSendTransaction(transaction);
      setOrder({ ...order, status: "SUBMITTED", transactionSignature: signature });
      setNotice("Payment sent. Confirming…");

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
          : "Payment sent. Confirmation is taking longer than expected.");
      }
      setNotice(payload.order && (payload.order as PaymentOrder).status === "CREDITED"
        ? "Payment verified. SIM Credits have been added to your account."
        : "Payment sent. We’ll update your balance when it’s confirmed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The payment could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const selected = config?.packages.find((item) => item.id === selectedPackage);
  const customCreditAmountNumber = Number(customCreditAmount);
  const customCreditAmountValid = Boolean(config?.customTopUp)
    && Number.isSafeInteger(customCreditAmountNumber)
    && customCreditAmountNumber >= (config?.customTopUp.minCredits ?? 0)
    && customCreditAmountNumber <= (config?.customTopUp.maxCredits ?? 0)
    && (customCreditAmountNumber - (config?.customTopUp.minCredits ?? 0))
      % (config?.customTopUp.stepCredits ?? 1) === 0;
  const canContinue = Boolean(selected) || (selectedPackage === "custom" && customCreditAmountValid);
  const customPriceCents = config?.customTopUp
    ? Math.round(customCreditAmountNumber * 100 / config.customTopUp.creditsPerUsd)
    : 0;
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
          <h1 id="credits-title">Add SIM Credits</h1>
        </div>

        {loading ? (
          <div className={styles.loading} role="status">
            <span className={styles.spinner} aria-hidden="true" />
            <span>Loading…</span>
          </div>
        ) : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

        {!loading && config && !config.enabled ? (
          <section className={styles.unavailable} aria-label="Payments unavailable">
            <p>Credit purchases are unavailable. Try again later.</p>
          </section>
        ) : null}

        {!loading && config?.enabled ? (
          <div className={styles.checkout}>
            <section className={styles.packagePanel} aria-labelledby="package-title">
              <div className={styles.panelHeading}>
                <h2 id="package-title">Choose amount</h2>
              </div>
              <fieldset className={styles.packageList} disabled={busy || Boolean(order && !terminal && !retryable)}>
                <legend className={styles.visuallyHidden}>SIM Credits package</legend>
                {config.packages.map((item) => (
                  <label key={item.id} className={`${styles.packageOption} ${selectedPackage === item.id ? styles.packageSelected : ""}`}>
                    <input
                      type="radio"
                      name="credit-package"
                      value={item.id}
                      checked={selectedPackage === item.id}
                      onChange={() => {
                        orderIdempotencyKey.current = null;
                        setSelectedPackage(item.id);
                      }}
                    />
                    <span><strong>{formatCredits(item.credits)}</strong><small>SIM Credits</small></span>
                    <b>{formatUsd(item.usdCents)}</b>
                  </label>
                ))}
                <label className={`${styles.packageOption} ${selectedPackage === "custom" ? styles.packageSelected : ""}`}>
                  <input
                    type="radio"
                    name="credit-package"
                    value="custom"
                    checked={selectedPackage === "custom"}
                    onChange={() => {
                      orderIdempotencyKey.current = null;
                      setSelectedPackage("custom");
                    }}
                  />
                  <span><strong>Custom amount</strong><small>1,000–100,000 credits</small></span>
                  <b>Custom</b>
                </label>
              </fieldset>
              {selectedPackage === "custom" && config.customTopUp ? (
                <div className={styles.customAmount}>
                  <label htmlFor="custom-credit-amount">SIM Credits</label>
                  <div className={styles.customAmountInput}>
                    <input
                      id="custom-credit-amount"
                      type="number"
                      min={config.customTopUp.minCredits}
                      max={config.customTopUp.maxCredits}
                      step={config.customTopUp.stepCredits}
                      value={customCreditAmount}
                      aria-invalid={!customCreditAmountValid}
                      aria-describedby="custom-credit-price"
                      disabled={busy || Boolean(order && !terminal && !retryable)}
                      onChange={(event) => {
                        orderIdempotencyKey.current = null;
                        setCustomCreditAmount(event.target.value);
                      }}
                    />
                    <span>credits</span>
                  </div>
                  <p id="custom-credit-price" aria-live="polite">
                    {customCreditAmountValid ? formatUsd(customPriceCents) : "Enter 1,000–100,000 in steps of 10."}
                  </p>
                </div>
              ) : null}
              {!order || terminal || retryable ? (
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={() => void continueCheckout()}
                  disabled={busy || !canContinue}
                >
                  {busy ? <span className={styles.spinner} aria-hidden="true" /> : null}
                  {busy ? "Please wait…" : retryable ? "Try again" : "Continue"}
                </button>
              ) : null}
            </section>

            {order ? (
              <section className={styles.orderPanel} aria-labelledby="order-title">
                <div className={styles.panelHeading}>
                  <div>
                    <h2 id="order-title">Payment</h2>
                    <p className={`${styles.status} ${styles[`status${order.status}`] ?? ""}`}>{statusText[order.status] ?? "Payment pending"}</p>
                  </div>
                </div>
                <dl className={styles.quote}>
                  <div><dt>You receive</dt><dd>{formatCredits(order.creditAmount)} SIM Credits</dd></div>
                  <div><dt>Amount</dt><dd>{formatSol(order.expectedLamports)}</dd></div>
                  <div><dt>Price</dt><dd>{formatUsd(order.usdCents)}</dd></div>
                </dl>

                {order.reviewReason ? <p className={styles.reviewReason}>{order.reviewReason}</p> : null}
                {order.transactionSignature ? (
                  <a className={styles.explorerLink} href={`https://explorer.solana.com/tx/${encodeURIComponent(order.transactionSignature)}?cluster=devnet`} target="_blank" rel="noreferrer">
                    View transaction on Solana Explorer
                  </a>
                ) : null}

                {order.status === "PENDING" && secondsLeft > 0 ? (
                  <button className={styles.primaryButton} type="button" onClick={() => void payWithWallet()} disabled={busy}>
                    {busy ? <span className={styles.spinner} aria-hidden="true" /> : null}
                    {busy ? "Waiting for wallet…" : `Pay ${formatSol(order.expectedLamports)} with ${activeWallet?.name ?? "wallet"}`}
                  </button>
                ) : null}
                {retryable ? (
                  <p className={styles.retryNote}>Payment didn’t complete. Try again.</p>
                ) : null}
                {order.status === "CREDITED" ? (
                  <p className={styles.success}>SIM Credits added.</p>
                ) : null}
                {order.status === "EXPIRED" ? (
                  <p className={styles.retryNote}>This quote expired. Get a new one to continue.</p>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}

        {walletChooserOpen ? (
          <div className={styles.walletOverlay}>
            <section className={styles.walletDialog} role="dialog" aria-modal="true" aria-labelledby="wallet-dialog-title">
              <h2 id="wallet-dialog-title">Choose wallet</h2>
              <div className={styles.walletChoices}>
                {walletChoices.map((choice) => (
                  <button
                    className={styles.walletChoice}
                    key={choice.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void (async () => {
                      const connected = await connectWallet(choice);
                      if (connected) await createOrder(connected.address);
                    })()}
                  >
                    {connectingWalletId === choice.id ? <span className={styles.spinner} aria-hidden="true" /> : null}
                    {choice.icon ? (
                      <span className={styles.walletIconFrame}>
                        <Image className={styles.walletIcon} src={choice.icon} alt="" width={28} height={28} unoptimized />
                      </span>
                    ) : (
                      <AccountBalanceWalletIcon className={styles.walletIconFallback} aria-hidden="true" />
                    )}
                    <span>{choice.name}</span>
                  </button>
                ))}
              </div>
              <button className={styles.closeWalletDialog} type="button" onClick={() => setWalletChooserOpen(false)} disabled={busy}>
                Cancel
              </button>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
