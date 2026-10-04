CREATE TABLE "market_outcome_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fixture_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"market_outcome_id" uuid NOT NULL,
	"outcome_code" text NOT NULL,
	"status" text NOT NULL,
	"fixture_result_hash" text NOT NULL,
	"rules_version" text NOT NULL,
	"settled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_outcome_settlements" ADD CONSTRAINT "market_outcome_settlements_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_outcome_settlements" ADD CONSTRAINT "market_outcome_settlements_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_outcome_settlements" ADD CONSTRAINT "market_outcome_settlements_market_outcome_id_market_outcomes_id_fk" FOREIGN KEY ("market_outcome_id") REFERENCES "public"."market_outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "market_outcome_settlements_outcome_idx" ON "market_outcome_settlements" USING btree ("market_outcome_id");