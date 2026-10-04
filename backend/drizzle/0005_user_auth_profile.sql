ALTER TABLE "users" ADD COLUMN "auth_subject" text;
ALTER TABLE "users" ADD COLUMN "first_name" text;
ALTER TABLE "users" ADD COLUMN "last_name" text;
ALTER TABLE "users" ADD COLUMN "phone" text;
ALTER TABLE "users" ADD COLUMN "privacy_notice_version" text;
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamp;
--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_subject_unique" ON "users" USING btree ("auth_subject");