"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import { restoreAccessToken } from "@/lib/auth-client";
import styles from "../page.module.css";

type WalletTransaction = {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  createdAt: string;
};

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

const transactionLabels: Record<string, string> = {
  INITIAL_CREDIT: "Starting balance",
  BET_DEBIT: "Bet placed",
  BET_REFUND: "Bet refunded",
  WIN_PAYOUT: "Winnings",
  BONUS: "Bonus",
  ADMIN_ADJUSTMENT: "Balance adjustment",
  SOLANA_PURCHASE_CREDIT: "SIM Credits purchase",
};

export default function TransactionHistoryPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = await restoreAccessToken();
        if (!token) {
          router.replace("/auth?next=/account/transactions");
          return;
        }
        if (!apiUrl) throw new Error("Transaction history is temporarily unavailable. Try again later.");
        const response = await fetch(`${apiUrl}/api/wallet/transactions`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload)) {
          throw new Error("Transaction history is temporarily unavailable. Try again later.");
        }
        if (active) setTransactions(payload as WalletTransaction[]);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Transaction history is temporarily unavailable. Try again later.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><SportsSoccerIcon aria-hidden="true" /><span>SimSoccer</span></Link>
        <Link className={styles.backLink} href="/account"><ArrowBackIcon fontSize="small" /> Account</Link>
      </header>
      <section className={styles.content} aria-labelledby="transactions-title">
        <div className={styles.heading}>
          <div><p>Account</p><h1 id="transactions-title">Transaction history</h1></div>
        </div>
        <p className={styles.historyNote}>Play-money credits have no cash value.</p>
        {loading ? <div className={styles.overviewSkeleton} role="status" aria-label="Loading transactions"><span /><span /><span /></div> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {!loading && !error && transactions.length === 0 ? <p className={styles.emptyState}>No transactions yet.</p> : null}
        {!loading && transactions.length > 0 ? (
          <div className={styles.tableScroll}>
            <table className={styles.transactionTable}>
              <thead><tr><th scope="col">Date</th><th scope="col">Activity</th><th scope="col">Change</th><th scope="col">Balance (credits)</th></tr></thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{new Date(transaction.createdAt).toLocaleString()}</td>
                    <td>{transactionLabels[transaction.type] ?? "Wallet activity"}</td>
                    <td>{Number(transaction.amount) > 0 ? "+" : ""}{Number(transaction.amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} credits</td>
                    <td>{Number(transaction.balanceAfter).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}
