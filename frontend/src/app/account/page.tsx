"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import { supabase } from "@/lib/supabase/client";
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

const accountsUrl = (process.env.NEXT_PUBLIC_ACCOUNTS_API_URL ?? "").replace(/\/$/, "");
const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export default function AccountPage() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          router.replace("/auth?next=/account");
          return;
        }
        if (!accountsUrl) throw new Error("Account services are not configured.");
        const authHeaders = { Authorization: `Bearer ${session.access_token}` };
        const accountResponse = await fetch(`${accountsUrl}/api/account/me`, { headers: authHeaders, cache: "no-store" });
        const accountPayload = await accountResponse.json().catch(() => null);
        if (!accountResponse.ok || !accountPayload?.account) {
          throw new Error(accountPayload?.message ?? "Account details are temporarily unavailable.");
        }
        if (active) setAccount(accountPayload.account as Account);

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

  async function signOut() {
    setBusy(true);
    await supabase.auth.signOut();
    router.replace("/auth");
    router.refresh();
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
          <button type="button" onClick={() => void signOut()} disabled={busy}>{busy ? "Signing out" : "Sign out"}</button>
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
          </>
        ) : null}
      </section>
    </main>
  );
}