CREATE TABLE "world_runtime" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"status" text DEFAULT 'WAITING_FOR_SEASON' NOT NULL,
	"active_season_id" uuid,
	"current_round" integer DEFAULT 0 NOT NULL,
	"total_rounds" integer DEFAULT 38 NOT NULL,
	"coordinator_node_id" text,
	"heartbeat_at" timestamp DEFAULT now() NOT NULL,
	"last_reconciliation_at" timestamp,
	"degraded_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "world_runtime" ADD CONSTRAINT "world_runtime_active_season_id_seasons_id_fk" FOREIGN KEY ("active_season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_events_fixture_sequence_idx" ON "match_events" USING btree ("fixture_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "match_snapshots_match_vsec_idx" ON "match_snapshots" USING btree ("match_id","virtual_second");--> statement-breakpoint
CREATE UNIQUE INDEX "standings_season_team_idx" ON "standings" USING btree ("season_id","team_id");