export interface SettlementRuntimeState {
  startedAt: Date;
  isLeader: boolean;
  lastScanAt: Date | null;
  lastSuccessfulScanAt: Date | null;
  consecutiveErrors: number;
  lastError: string | null;
  lastFixturesProcessed: number;
  lastTicketsSettled: number;
}

export const runtimeState: SettlementRuntimeState = {
  startedAt: new Date(),
  isLeader: false,
  lastScanAt: null,
  lastSuccessfulScanAt: null,
  consecutiveErrors: 0,
  lastError: null,
  lastFixturesProcessed: 0,
  lastTicketsSettled: 0,
};
