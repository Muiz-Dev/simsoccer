"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import SecurityIcon from "@mui/icons-material/Security";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import WalletIcon from "@mui/icons-material/Wallet";
import { restoreAccessToken, signOut } from "@/lib/auth-client";
import styles from "./page.module.css";

type Account = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  wallet: { balance: string; currency: string } | null;
};

const shortcuts = [
  { href: "/bets", title: "My bets", description: "Open tickets and results", icon: ReceiptLongIcon },
  { href: "/account/transactions", title: "Transaction history", description: "Wallet credits and activity", icon: WalletIcon },
  { href: "/account/settings", title: "Settings", description: "Profile, password and sessions", icon: SecurityIcon },
];

export default function AccountPage() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = await restoreAccessToken();
        if (!token) {
          router.replace("/auth?next=/account");
          return;
        }
        const response = await fetch("/api/auth/account/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.account) {
          throw new Error(payload?.message ?? "Your account could not be loaded. Try again.");
        }
        if (active) setAccount(payload.account as Account);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Your account could not be loaded. Try again.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  async function handleSignOut() {
    setBusy(true);
    setError("");
    try {
      await signOut();
      router.replace("/auth");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "You couldn't be signed out. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><SportsSoccerIcon aria-hidden="true" /><span>SimSoccer</span></Link>
        <Link className={styles.backLink} href="/betting"><ArrowBackIcon fontSize="small" /> Betting desk</Link>
      </header>
      <section className={styles.content} aria-labelledby="account-title">
        <div className={styles.heading}>
          <div>
            <p>Your account</p>
            <h1 id="account-title">Account</h1>
          </div>
          <button type="button" onClick={() => void handleSignOut()} disabled={busy}>
            {busy ? <span className={styles.buttonSpinner} aria-label="Signing out" /> : "Sign out"}
          </button>
        </div>

        {loading ? (
          <div className={styles.overviewSkeleton} role="status" aria-label="Loading account">
            <span /><span /><span />
          </div>
        ) : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        {account ? (
          <>
            <section className={styles.accountSummary} aria-label="Account overview">
              <div className={styles.identity}>
                <span className={styles.avatar} aria-hidden="true">
                  {(account.firstName?.[0] ?? account.email[0] ?? "S").toUpperCase()}
                </span>
                <div>
                  <h2>{[account.firstName, account.lastName].filter(Boolean).join(" ") || "Your profile"}</h2>
                  <p>{account.email}</p>
                </div>
              </div>
              <div className={styles.balance}>
                <span>Play-money balance</span>
                <strong>{Number(account.wallet?.balance ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                <small>Credits have no cash value</small>
              </div>
            </section>

            <nav className={styles.shortcuts} aria-label="Account">
              {shortcuts.map(({ href, title, description, icon: Icon }) => (
                <Link key={href} href={href} className={styles.shortcut}>
                  <span className={styles.shortcutIcon}><Icon aria-hidden="true" /></span>
                  <span className={styles.shortcutCopy}><strong>{title}</strong><small>{description}</small></span>
                  <ArrowForwardIcon className={styles.arrow} aria-hidden="true" />
                </Link>
              ))}
            </nav>
          </>
        ) : null}
      </section>
    </main>
  );
}
