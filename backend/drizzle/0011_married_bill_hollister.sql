CREATE TABLE "settlement_bet_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bet_selection_id" uuid NOT NULL,
	"bet_id" uuid NOT NULL,
	"fixture_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"market_outcome_id" uuid,
	"outcome_code" text NOT NULL,
	"accepted_odds" numeric NOT NULL,
	"status" text NOT NULL,
	"fixture_result_hash" text NOT NULL,
	"rules_version" text NOT NULL,
	"settled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "settlement_bet_legs" ADD CONSTRAINT "settlement_bet_legs_bet_selection_id_bet_selections_id_fk" FOREIGN KEY ("bet_selection_id") REFERENCES "public"."bet_selections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_bet_legs" ADD CONSTRAINT "settlement_bet_legs_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_bet_legs" ADD CONSTRAINT "settlement_bet_legs_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_bet_legs" ADD CONSTRAINT "settlement_bet_legs_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_bet_legs" ADD CONSTRAINT "settlement_bet_legs_market_outcome_id_market_outcomes_id_fk" FOREIGN KEY ("market_outcome_id") REFERENCES "public"."market_outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_bet_legs_selection_idx" ON "settlement_bet_legs" USING btree ("bet_selection_id");--> statement-breakpoint
CREATE INDEX "settlement_bet_legs_bet_idx" ON "settlement_bet_legs" USING btree ("bet_id");--> statement-breakpoint
CREATE INDEX "settlement_bet_legs_fixture_idx" ON "settlement_bet_legs" USING btree ("fixture_id");--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_idempotency_key_unique" UNIQUE("idempotency_key");