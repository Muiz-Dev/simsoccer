import { db, leadershipConnection } from './db';
import { config } from './config';
import { runtimeState } from './runtime';
import { COORDINATOR_LOCK_ID, runSettlementScan } from './processor';

let timer: ReturnType<typeof setTimeout> | undefined;
let stopping = false;
let leaderBackendPid: number | null = null;

async function maintainLeadership(): Promise<boolean> {
  if (runtimeState.isLeader) {
    try {
      const [connection] = await leadershipConnection<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
      if (connection?.pid === leaderBackendPid) return true;
      runtimeState.isLeader = false;
      leaderBackendPid = null;
      console.error('Settlement leadership connection changed; reacquiring the worker lock.');
    } catch (error) {
      runtimeState.isLeader = false;
      leaderBackendPid = null;
      throw error;
    }
  }

  const [lock] = await leadershipConnection<{ locked: boolean; pid: number }[]>`
    SELECT pg_try_advisory_lock(${COORDINATOR_LOCK_ID}) AS locked,
      pg_backend_pid()::int AS pid
  `;
  runtimeState.isLeader = lock?.locked === true;
  leaderBackendPid = runtimeState.isLeader ? lock.pid : null;
  return runtimeState.isLeader;
}

async function scan(): Promise<void> {
  if (stopping) return;
  runtimeState.lastScanAt = new Date();
  try {
    if (await maintainLeadership()) {
      const result = await runSettlementScan();
      runtimeState.lastFixturesProcessed = result.fixturesProcessed;
      runtimeState.lastTicketsSettled = result.ticketsSettled;
    }
    runtimeState.lastSuccessfulScanAt = new Date();
    runtimeState.consecutiveErrors = 0;
    runtimeState.lastError = null;
  } catch (error) {
    runtimeState.consecutiveErrors++;
    runtimeState.lastError = error instanceof Error ? error.message : 'Unknown settlement worker error.';
    runtimeState.isLeader = false;
    leaderBackendPid = null;
    console.error('Settlement reconciliation scan failed.', error);
  } finally {
    if (!stopping) {
      timer = setTimeout(() => void scan(), config.SETTLEMENT_POLL_INTERVAL_MS);
      timer.unref();
    }
  }
}

export function startSettlementWorker(): void {
  console.log(`Starting isolated settlement worker; reconciliation interval ${config.SETTLEMENT_POLL_INTERVAL_MS}ms.`);
  void scan();
}

export async function stopSettlementWorker(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  if (runtimeState.isLeader) {
    try {
      await leadershipConnection`SELECT pg_advisory_unlock(${COORDINATOR_LOCK_ID})`;
    } catch (error) {
      console.error('Could not release settlement worker leadership lock cleanly.', error);
    }
  }
  runtimeState.isLeader = false;
  await Promise.all([leadershipConnection.end({ timeout: 5 }), db.end({ timeout: 5 })]);
}
