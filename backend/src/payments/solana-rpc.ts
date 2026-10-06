import { env } from '../config/env';

const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const RPC_TIMEOUT_MS = 8_000;
let verifiedRpcUrl = '';
let rpcVerifiedAt = 0;

type RpcResponse<T> = {
  result?: T;
  error?: { code: number; message: string };
};

export type SignatureInfo = {
  signature: string;
  err: unknown;
  blockTime: number | null;
};

async function callRpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(env.SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'simsoccer-payment', method, params }),
    cache: 'no-store',
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Solana RPC ${method} failed with HTTP ${response.status}.`);

  const payload = await response.json() as RpcResponse<T>;
  if (payload.error) {
    throw new Error(`Solana RPC ${method} failed (${payload.error.code}): ${payload.error.message}`);
  }
  if (payload.result === undefined) throw new Error(`Solana RPC ${method} returned no result.`);
  return payload.result;
}

export async function assertDevnetRpc(): Promise<void> {
  if (verifiedRpcUrl === env.SOLANA_RPC_URL && Date.now() - rpcVerifiedAt < 60_000) return;
  const genesisHash = await callRpc<string>('getGenesisHash', []);
  if (genesisHash !== DEVNET_GENESIS_HASH) {
    throw new Error('Configured Solana RPC is not connected to devnet.');
  }
  verifiedRpcUrl = env.SOLANA_RPC_URL;
  rpcVerifiedAt = Date.now();
}

export async function getReferenceSignatures(referenceAddress: string): Promise<SignatureInfo[]> {
  await assertDevnetRpc();
  return callRpc<SignatureInfo[]>('getSignaturesForAddress', [
    referenceAddress,
    { commitment: 'confirmed', limit: 20 },
  ]);
}

export async function getFinalizedTransaction(signature: string): Promise<unknown | null> {
  await assertDevnetRpc();
  return callRpc<unknown | null>('getTransaction', [
    signature,
    { commitment: 'finalized', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
  ]);
}
