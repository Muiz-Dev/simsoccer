ALTER TABLE "users" ADD COLUMN "password_hash" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_email_verified" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE "users" SET "is_email_verified" = true WHERE "auth_subject" IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" (lower("email"));
--> statement-breakpoint

CREATE TABLE "auth_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "challenge_hash" text NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "purpose" text NOT NULL,
  "code_hash" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_challenges_hash_unique" ON "auth_challenges" ("challenge_hash");
--> statement-breakpoint
CREATE INDEX "auth_challenges_expiry_idx" ON "auth_challenges" ("expires_at");
--> statement-breakpoint

CREATE TABLE "auth_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "family_id" uuid NOT NULL,
  "refresh_token_hash" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_used_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "consumed_at" timestamp,
  "user_agent_hash" text,
  "ip_hash" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_refresh_hash_unique" ON "auth_sessions" ("refresh_token_hash");
--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" ("user_id");
--> statement-breakpoint
CREATE INDEX "auth_sessions_family_idx" ON "auth_sessions" ("family_id");
--> statement-breakpoint
CREATE INDEX "auth_sessions_expiry_idx" ON "auth_sessions" ("expires_at");
--> statement-breakpoint

CREATE TABLE "auth_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "device_token_hash" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  "revoked_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_devices_user_token_unique" ON "auth_devices" ("user_id", "device_token_hash");
--> statement-breakpoint
CREATE INDEX "auth_devices_user_idx" ON "auth_devices" ("user_id");
--> statement-breakpoint

ALTER TABLE "auth_sessions"
  ADD COLUMN "device_id" uuid REFERENCES "auth_devices"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "auth_sessions_device_idx" ON "auth_sessions" ("device_id");
