-- 0007_user_auth.sql
-- Adds columns for first-party auth and tables for refresh tokens, device tokens and JWKS key storage

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_algo" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_email_verified" boolean NOT NULL DEFAULT false;

-- Refresh tokens (store hashed token server-side for revocation and rotation)
CREATE TABLE IF NOT EXISTS "auth_refresh_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_used_at" timestamp,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "auth_refresh_tokens_token_hash_idx" ON "auth_refresh_tokens" ("token_hash");

-- Device tokens for privacy-preserving device recognition (store hashed token, optional device name)
CREATE TABLE IF NOT EXISTS "device_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "device_token_hash" text NOT NULL,
  "device_name" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  "revoked_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "device_tokens_token_hash_idx" ON "device_tokens" ("device_token_hash");

-- JWKS key storage: keep public JWK and private JWK (private JWK storage is sensitive; ensure DB secrets/backup policies are secure)
CREATE TABLE IF NOT EXISTS "jwks_keys" (
  "kid" text PRIMARY KEY,
  "public_jwk" jsonb NOT NULL,
  "private_jwk" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "active" boolean NOT NULL DEFAULT true
);

-- Basic housekeeping indexes
CREATE INDEX IF NOT EXISTS "auth_refresh_tokens_user_idx" ON "auth_refresh_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "device_tokens_user_idx" ON "device_tokens" ("user_id");

-- Note: Migration assumes gen_random_uuid() is available (pgcrypto or pgcrypto-compatible extension). If not present, replace with uuid_generate_v4() or ensure extension is enabled.
