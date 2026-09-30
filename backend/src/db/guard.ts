import { env } from '../config/env';

/**
 * Ensures that database migrations or seed scripts only run against explicitly verified dev/test databases.
 * Fails closed unless the target database is confirmed as an isolated local or explicitly confirmed dev/test target.
 */
export function verifySafeDatabase(operationName: string): void {
  const url = env.DATABASE_URL.toLowerCase();

  // Parse URL host
  let host = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
  } catch {
    // If not a standard URL, check string match
    host = url;
  }

  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'host.docker.internal';
  const isDevOrTestEnv = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

  // 1. Safe local dev/test environment
  if (isLocalHost && isDevOrTestEnv) {
    console.log(`✅ [SAFETY GUARD PASSED] Safe local database verified for '${operationName}' (${host}).`);
    return;
  }

  // 2. Non-local / Remote target requires explicit confirmation override
  const isExplicitlyConfirmed = env.ALLOW_UNSAFE_DB || process.env.EXPLICIT_TEST_DB_CONFIRMED === 'true';

  if (!isLocalHost && isExplicitlyConfirmed) {
    console.warn(`⚠️ [SAFETY GUARD OVERRIDE] Operation '${operationName}' running against non-local target (${host}) with explicit confirmation.`);
    return;
  }

  // Fail closed
  throw new Error(
    `🚫 [SAFETY GUARD REJECTED] Operation '${operationName}' blocked! The target database (${host}) is not a verified local development/test database, and explicit target confirmation is absent. Never run migrations or seeds against non-verified targets.`
  );
}
