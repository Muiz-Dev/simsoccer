CREATE TABLE "solana_payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"signature" text NOT NULL,
	"status" text NOT NULL,
	"actual_lamports" numeric(20, 0),
	"transaction_block_time" timestamp,
	"details" text,
	"observed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "solana_payment_attempts_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "solana_payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"package_id" text NOT NULL,
	"credit_amount" numeric(12, 2) NOT NULL,
	"usd_cents" integer NOT NULL,
	"sol_usd_price" text NOT NULL,
	"price_provider" text NOT NULL,
	"price_observed_at" timestamp NOT NULL,
	"price_fetched_at" timestamp NOT NULL,
	"expected_lamports" numeric(20, 0) NOT NULL,
	"network" text NOT NULL,
	"treasury_address" text NOT NULL,
	"payer_address" text NOT NULL,
	"reference_address" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"transaction_signature" text,
	"review_reason" text,
	"expires_at" timestamp NOT NULL,
	"verified_at" timestamp,
	"credited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "solana_payment_orders_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "solana_payment_orders_reference_address_unique" UNIQUE("reference_address")
);
--> statement-breakpoint
ALTER TABLE "solana_payment_attempts" ADD CONSTRAINT "solana_payment_attempts_order_id_solana_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."solana_payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solana_payment_orders" ADD CONSTRAINT "solana_payment_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "solana_payment_attempts_order_idx" ON "solana_payment_attempts" USING btree ("order_id","observed_at");--> statement-breakpoint
CREATE INDEX "solana_payment_orders_user_created_idx" ON "solana_payment_orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "solana_payment_orders_status_expiry_idx" ON "solana_payment_orders" USING btree ("status","expires_at");