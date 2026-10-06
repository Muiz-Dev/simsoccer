import { env } from '../config/env';
import { reconcileRecentSolanaPayments } from './solana-payment-service';

let activeRun: Promise<void> | null = null;

export function startSolanaPaymentReconciliation(): () => void {
  if (!env.SOLANA_PAYMENTS_ENABLED) return () => undefined;

  const run = () => {
    if (activeRun) return activeRun;
    activeRun = reconcileRecentSolanaPayments()
      .catch((error) => {
        console.error('Solana payment reconciliation cycle failed:', error);
      })
      .finally(() => { activeRun = null; });
    return activeRun;
  };

  void run();
  const timer = setInterval(() => { void run(); }, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
