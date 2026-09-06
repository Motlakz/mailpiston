ALTER TABLE "emails" ADD COLUMN "fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX "emails_fingerprint_key" ON "emails" USING btree ("fingerprint");