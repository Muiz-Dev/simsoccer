import { env } from '../config/env';

/**
 * Ensures that database migrations or seed scripts only run against explicit dev/test databases.
 * Fails closed if the database URL appears to point to production and ALLOW_UNSAFE_DB is not true.
 */
export function verifySafeDatabase(operationName: string): void {
  const url = env.DATABASE_URL.toLowerCase();

  const isDevOrTestEnv = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  const containsDevKeywords = url.includes('dev') || url.includes('test') || url.includes('localhost') || url.includes('127.0.0.1') || url.includes('supabase');
  const isExplicitlyAllowed = env.ALLOW_UNSAFE_DB;

  if (isExplicitlyAllowed) {
    console.warn(`⚠️ [SAFETY GUARD] Explicit override ALLOW_UNSAFE_DB=true active for operation: ${operationName}`);
    return;
  }

  if (!isDevOrTestEnv) {
    throw new Error(
      `🚫 [SAFETY GUARD REJECTED] Operation '${operationName}' blocked! NODE_ENV is '${env.NODE_ENV}'. Must be 'development' or 'test', or set ALLOW_UNSAFE_DB=true.`
    );
  }

  // Double check keywords in URL if in dev mode
  if (!containsDevKeywords) {
    throw new Error(
      `🚫 [SAFETY GUARD REJECTED] Operation '${operationName}' blocked! DATABASE_URL does not contain safe keywords ('dev', 'test', 'localhost', 'supabase'). Set ALLOW_UNSAFE_DB=true if intentional.`
    );
  }

  console.log(`✅ [SAFETY GUARD PASSED] Safe database confirmed for '${operationName}'.`);
}
