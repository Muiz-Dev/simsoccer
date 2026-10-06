import Decimal from 'decimal.js';

const CoinPrice = Decimal.clone({ precision: 40 });
const PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_last_updated_at=true';
const CACHE_TTL_MS = 60_000;
const MAX_PRICE_AGE_MS = 180_000;

export type SolUsdQuote = {
  priceUsd: string;
  provider: 'coingecko';
  observedAt: Date;
  fetchedAt: Date;
};

type CoinGeckoResponse = {
  solana?: {
    usd?: number;
    last_updated_at?: number;
  };
};

let cachedQuote: SolUsdQuote | null = null;
let cachedAt = 0;
let quoteRequest: Promise<SolUsdQuote> | null = null;

export async function getSolUsdQuote(now = Date.now()): Promise<SolUsdQuote> {
  if (cachedQuote && now - cachedAt < CACHE_TTL_MS
    && now - cachedQuote.observedAt.getTime() <= MAX_PRICE_AGE_MS) {
    return cachedQuote;
  }
  if (quoteRequest) return quoteRequest;

  quoteRequest = (async () => {
    const response = await fetch(PRICE_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`CoinGecko price request failed with HTTP ${response.status}.`);
    }

    const payload = await response.json() as CoinGeckoResponse;
    const price = payload.solana?.usd;
    const updatedAt = payload.solana?.last_updated_at;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0
      || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
      throw new Error('CoinGecko returned an invalid SOL/USD quote.');
    }

    const observedAt = new Date(updatedAt * 1000);
    const fetchedAt = new Date();
    const fetchedAtMs = fetchedAt.getTime();
    if (fetchedAtMs - observedAt.getTime() > MAX_PRICE_AGE_MS || observedAt.getTime() > fetchedAtMs + 30_000) {
      throw new Error('CoinGecko returned a stale SOL/USD quote.');
    }

    const quote: SolUsdQuote = {
      priceUsd: String(price),
      provider: 'coingecko',
      observedAt,
      fetchedAt,
    };
    cachedQuote = quote;
    cachedAt = fetchedAtMs;
    return quote;
  })();

  try {
    return await quoteRequest;
  } finally {
    quoteRequest = null;
  }
}

export function calculateLamports(usdCents: number, priceUsd: string): string {
  if (!Number.isInteger(usdCents) || usdCents <= 0) {
    throw new Error('USD package value must be a positive whole number of cents.');
  }
  const price = new CoinPrice(priceUsd);
  if (!price.isFinite() || price.lte(0)) {
    throw new Error('SOL/USD price must be positive and finite.');
  }

  const lamports = new CoinPrice(usdCents)
    .div(100)
    .div(price)
    .mul(1_000_000_000)
    .toDecimalPlaces(0, CoinPrice.ROUND_HALF_UP);
  if (lamports.lte(0) || !lamports.isInteger()) {
    throw new Error('The quoted package does not convert to a valid lamport amount.');
  }
  return lamports.toFixed(0);
}
