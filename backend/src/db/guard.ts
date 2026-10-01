import { env } from '../config/env';

function getDatabaseHost(): string {
  const url = env.DATABASE_URL.toLowerCase();
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'host.docker.internal';
}

/**
 * Ensures that database migrations or seed scripts only run against explicitly verified dev/test databases.
 * Fails closed unless the target database is confirmed as an isolated local or explicitly confirmed dev/test target.
 */
export function verifySafeDatabase(operationName: string): void {
  const host = getDatabaseHost();
  const isLocal = isLocalHost(host);
  const isDevOrTestEnv = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

  // 1. Safe local dev/test environment
  if (isLocal && isDevOrTestEnv) {
    console.log(`✅ [SAFETY GUARD PASSED] Safe local database verified for '${operationName}' (${host}).`);
    return;
  }

  // 2. Non-local / Remote target requires explicit confirmation override
  const isExplicitlyConfirmed = env.ALLOW_UNSAFE_DB || process.env.EXPLICIT_TEST_DB_CONFIRMED === 'true';

  if (!isLocal && isExplicitlyConfirmed) {
    console.warn(`⚠️ [SAFETY GUARD OVERRIDE] Operation '${operationName}' running against non-local target (${host}) with explicit confirmation.`);
    return;
  }

  // Fail closed
  throw new Error(
    `🚫 [SAFETY GUARD REJECTED] Operation '${operationName}' blocked! The target database (${host}) is not a verified local development/test database, and explicit target confirmation is absent. Never run migrations or seeds against non-verified targets.`
  );
}

export function verifySafeMigration(operationName: string): void {
  const host = getDatabaseHost();
  const isLocal = isLocalHost(host);
  const isDevOrTestEnv = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

  if (isLocal && isDevOrTestEnv) {
    console.log(`✅ [SAFETY GUARD PASSED] Safe local database verified for '${operationName}' (${host}).`);
    return;
  }

  if (!isLocal && env.ALLOW_PRODUCTION_MIGRATIONS) {
    console.warn(`⚠️ [MIGRATION PERMISSION] Applying versioned migrations to configured database (${host}).`);
    return;
  }

  throw new Error(
    `🚫 [SAFETY GUARD REJECTED] '${operationName}' requires a local dev/test database or ALLOW_PRODUCTION_MIGRATIONS=true.`
  );
}
