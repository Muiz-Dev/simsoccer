CREATE TABLE "settlement_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"season_id" uuid,
	"round" integer,
	"fixture_id" uuid,
	"bet_id" uuid,
	"event_type" text NOT NULL,
	"result_hash" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_activity_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "settlement_fixture_records" (
	"fixture_id" uuid PRIMARY KEY NOT NULL,
	"season_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"result_hash" text,
	"status" text DEFAULT 'DISCOVERED' NOT NULL,
	"ticket_count" integer DEFAULT 0 NOT NULL,
	"selection_count" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"discovered_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_round_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"status" text DEFAULT 'WAITING' NOT NULL,
	"fixture_count" integer DEFAULT 0 NOT NULL,
	"finished_fixture_count" integer DEFAULT 0 NOT NULL,
	"processed_fixture_count" integer DEFAULT 0 NOT NULL,
	"ticket_count" integer DEFAULT 0 NOT NULL,
	"pending_ticket_count" integer DEFAULT 0 NOT NULL,
	"staked_credits" numeric DEFAULT '0.00' NOT NULL,
	"potential_payout_credits" numeric DEFAULT '0.00' NOT NULL,
	"payout_credits" numeric DEFAULT '0.00' NOT NULL,
	"last_error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settlement_activity" ADD CONSTRAINT "settlement_activity_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_activity" ADD CONSTRAINT "settlement_activity_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_activity" ADD CONSTRAINT "settlement_activity_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_fixture_records" ADD CONSTRAINT "settlement_fixture_records_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_fixture_records" ADD CONSTRAINT "settlement_fixture_records_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_round_records" ADD CONSTRAINT "settlement_round_records_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlement_activity_round_idx" ON "settlement_activity" USING btree ("season_id","round","created_at");--> statement-breakpoint
CREATE INDEX "settlement_activity_fixture_idx" ON "settlement_activity" USING btree ("fixture_id","created_at");--> statement-breakpoint
CREATE INDEX "settlement_fixture_round_idx" ON "settlement_fixture_records" USING btree ("season_id","round");--> statement-breakpoint
CREATE INDEX "settlement_fixture_status_idx" ON "settlement_fixture_records" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_round_season_round_idx" ON "settlement_round_records" USING btree ("season_id","round");--> statement-breakpoint
CREATE INDEX "settlement_round_status_idx" ON "settlement_round_records" USING btree ("status");