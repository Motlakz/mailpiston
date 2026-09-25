ALTER TABLE "domains" ADD COLUMN "relay_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reply_relays" ADD COLUMN "relay_domain" text;--> statement-breakpoint
CREATE UNIQUE INDEX "domains_one_relay_per_tenant_key" ON "domains" USING btree ("tenant_id") WHERE "domains"."relay_enabled" = true;