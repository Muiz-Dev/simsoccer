CREATE TABLE "booking_slip_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_slip_id" uuid NOT NULL,
	"fixture_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"market_outcome_id" uuid NOT NULL,
	"quoted_odds" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_slips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "booking_slips_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "booking_slip_selections" ADD CONSTRAINT "booking_slip_selections_booking_slip_id_booking_slips_id_fk" FOREIGN KEY ("booking_slip_id") REFERENCES "public"."booking_slips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_slip_selections" ADD CONSTRAINT "booking_slip_selections_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_slip_selections" ADD CONSTRAINT "booking_slip_selections_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_slip_selections" ADD CONSTRAINT "booking_slip_selections_market_outcome_id_market_outcomes_id_fk" FOREIGN KEY ("market_outcome_id") REFERENCES "public"."market_outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_slip_fixture_idx" ON "booking_slip_selections" USING btree ("booking_slip_id","fixture_id");