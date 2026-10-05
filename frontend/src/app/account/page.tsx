"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import { requestAuth, restoreAccessToken, setAccessToken, signOut as logout } from "@/lib/auth-client";
import styles from "./page.module.css";

type Account = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  wallet: { balance: string; currency: string } | null;
};
type WalletTransaction = {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  createdAt: string;
};
type AccountSession = {
  familyId: string;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
  deviceRecognized: boolean;
};

const accountsUrl = (process.env.NEXT_PUBLIC_ACCOUNTS_API_URL ?? "").replace(/\/$/, "");
const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export default function AccountPage() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [securityNotice, setSecurityNotice] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const token = await restoreAccessToken();
        if (!token) {
          router.replace("/auth?next=/account");
          return;
        }
        if (!accountsUrl) throw new Error("Account services are not configured.");
        const authHeaders = { Authorization: `Bearer ${token}` };
        const accountResponse = await fetch(`${accountsUrl}/api/account/me`, { headers: authHeaders, cache: "no-store" });
        const accountPayload = await accountResponse.json().catch(() => null);
        if (!accountResponse.ok || !accountPayload?.account) {
          throw new Error(accountPayload?.message ?? "Account details are temporarily unavailable.");
        }
        if (active) setAccount(accountPayload.account as Account);

        const sessionResponse = await fetch(`${accountsUrl}/api/auth/sessions`, { headers: authHeaders, cache: "no-store" });
        const sessionPayload = await sessionResponse.json().catch(() => null);
        if (!sessionResponse.ok || !Array.isArray(sessionPayload?.sessions)) {
          throw new Error(sessionPayload?.message ?? "Your sessions could not be loaded.");
        }
        if (active) setSessions(sessionPayload.sessions as AccountSession[]);

        if (apiUrl) {
          const transactionResponse = await fetch(`${apiUrl}/api/wallet/transactions`, { headers: authHeaders, cache: "no-store" });
          if (transactionResponse.ok) {
            const rows = await transactionResponse.json();
            if (active && Array.isArray(rows)) setTransactions(rows as WalletTransaction[]);
          }
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Account details are temporarily unavailable.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [router]);

  async function handleSignOut() {
    setBusy(true);
    try {
      await logout();
      router.replace("/auth");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-out is temporarily unavailable.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeSession(familyId: string) {
    setBusy(true);
    setError("");
    try {
      const token = await restoreAccessToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      await requestAuth("sessions/revoke", { familyId }, token);
      setSessions((current) => current.filter((session) => session.familyId !== familyId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That session could not be revoked.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOutEverywhere() {
    setBusy(true);
    setError("");
    try {
      const token = await restoreAccessToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      await requestAuth("logout-all", {}, token);
      setAccessToken(null);
      router.replace("/auth");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your sessions could not be closed.");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSecurityNotice("");
    setBusy(true);
    try {
      const token = await restoreAccessToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const result = await requestAuth("password/change", {
        currentPassword,
        newPassword,
      }, token);
      if (result.accessToken && accountsUrl) {
        const response = await fetch(`${accountsUrl}/api/auth/sessions`, {
          headers: { Authorization: `Bearer ${result.accessToken}` },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (response.ok && Array.isArray(payload?.sessions)) {
          setSessions(payload.sessions as AccountSession[]);
        }
      }
      setCurrentPassword("");
      setNewPassword("");
      setSecurityNotice(result.notificationSent === false
        ? "Password changed and other devices were signed out, but the security email could not be sent."
        : "Password changed. Other signed-in devices were signed out.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The password could not be changed.");
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
          <div><p>Account</p><h1 id="account-title">{account?.firstName ? `Hello, ${account.firstName}` : "Your account"}</h1></div>
          <button type="button" onClick={() => void handleSignOut()} disabled={busy}>{busy ? "Signing out" : "Sign out"}</button>
        </div>
        {loading ? <div className={styles.loading} role="status">Loading account <span /></div> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {account ? (
          <>
            <section className={styles.profile} aria-label="Profile details">
              <h2>Profile</h2>
              <dl>
                <div><dt>Email</dt><dd>{account.email}</dd></div>
                <div><dt>Name</dt><dd>{[account.firstName, account.lastName].filter(Boolean).join(" ") || "Not completed"}</dd></div>
                <div><dt>Phone</dt><dd>{account.phone || "Not added"}</dd></div>
              </dl>
            </section>
            <section className={styles.wallet} aria-label="Play-money wallet">
              <div><h2>Wallet</h2><p>Play-money credits have no cash value.</p></div>
              <strong>{account.wallet ? Number(account.wallet.balance).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}<span> credits</span></strong>
            </section>
            <section className={styles.transactions} aria-labelledby="transactions-title">
              <div className={styles.sectionTitle}><h2 id="transactions-title">Recent activity</h2><Link href="/privacy">Privacy notice</Link></div>
              {transactions.length ? (
                <div className={styles.tableWrap}>
                  <table><thead><tr><th>Activity</th><th>Date</th><th>Change</th><th>Balance</th></tr></thead>
                    <tbody>{transactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td>{transaction.type.replaceAll("_", " ").toLowerCase()}</td>
                        <td>{new Date(transaction.createdAt).toLocaleDateString("en-GB")}</td>
                        <td>{transaction.amount}</td>
                        <td>{transaction.balanceAfter}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className={styles.empty}>No wallet activity yet.</p>}
            </section>
            <section className={styles.transactions} aria-labelledby="sessions-title">
              <div className={styles.sectionTitle}>
                <h2 id="sessions-title">Signed-in devices</h2>
                <button type="button" onClick={() => void handleSignOutEverywhere()} disabled={busy}>Sign out everywhere</button>
              </div>
              {sessions.length ? (
                <ul>
                  {sessions.map((session) => (
                    <li key={session.familyId}>
                      <p>{session.current ? "This session" : session.deviceRecognized ? "Recognized device" : "Unrecognized session"}</p>
                      <p>Last active {new Date(session.lastUsedAt).toLocaleString("en-GB")}</p>
                      {!session.current ? (
                        <button type="button" onClick={() => void revokeSession(session.familyId)} disabled={busy}>
                          Sign out
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : <p className={styles.empty}>No active sessions found.</p>}
            </section>
            <section className={styles.transactions} aria-labelledby="password-title">
              <h2 id="password-title">Change password</h2>
              <form className={styles.securityForm} onSubmit={(event) => void changePassword(event)}>
                <label>Current password
                  <input type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                </label>
                <label>New password
                  <input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                </label>
                <button type="submit" disabled={busy}>{busy ? "Changing password" : "Change password"}</button>
              </form>
              {securityNotice ? <p className={styles.empty} role="status">{securityNotice}</p> : null}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
