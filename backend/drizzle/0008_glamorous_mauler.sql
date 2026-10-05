ALTER TABLE "bets" ADD COLUMN "public_ticket_code_hash" text;
--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_public_ticket_code_hash_unique" UNIQUE("public_ticket_code_hash");
