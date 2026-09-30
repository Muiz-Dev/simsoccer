CREATE TABLE "fixture_post_match" (
	"fixture_id" uuid PRIMARY KEY NOT NULL,
	"evolution_completed" boolean DEFAULT false NOT NULL,
	"settlement_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fixture_post_match" ADD CONSTRAINT "fixture_post_match_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_league_number_idx" ON "seasons" USING btree ("league_id","season_number");