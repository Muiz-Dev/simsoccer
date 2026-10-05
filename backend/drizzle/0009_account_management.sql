ALTER TABLE "users" ADD COLUMN "account_status" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_by" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "anonymized_at" timestamp;