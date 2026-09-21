-- Tenancy (roadmap §5.4).
--
-- Hand-edited after generation, deliberately. `drizzle-kit` emits
-- `ADD COLUMN "tenant_id" text NOT NULL` with no default, which is correct
-- against an empty database and fails against one with a single row in it —
-- Postgres cannot fill the new column and refuses the statement. The generated
-- form would have worked on a laptop and broken the first real deployment.
--
-- The safe shape is the same three steps per table: add the column nullable,
-- backfill it, then tighten it to NOT NULL. Everything that exists before this
-- migration belongs to one workspace — the operator's own — so the backfill is
-- a constant rather than a join.
--
-- Re-runnable by construction: every insert takes ON CONFLICT DO NOTHING and
-- every backfill is guarded by IS NULL, so a partial application can be
-- replayed without duplicating anything.

CREATE TYPE "public"."tenant_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_members" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "tenant_role" DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_members_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tenant_provider_credentials" (
	"tenant_id" text NOT NULL,
	"provider" text NOT NULL,
	"api_token_ciphertext" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_provider_credentials_tenant_id_provider_pk" PRIMARY KEY("tenant_id","provider")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_provider_credentials" ADD CONSTRAINT "tenant_provider_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- The workspace everything already in this database belongs to. A fixed id so
-- the backfill below and the application's bootstrap agree on it without
-- either having to look it up.
INSERT INTO "tenants" ("id", "name", "slug")
VALUES ('ten_0000000000000000000000', 'Default workspace', 'default')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

-- Whoever could already sign in owns that workspace. Without this the operator
-- migrates successfully and is then locked out of their own data.
INSERT INTO "tenant_members" ("tenant_id", "user_id", "role")
SELECT 'ten_0000000000000000000000', "id", 'owner' FROM "users"
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Add nullable, backfill, then tighten. One block per table.
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "tenant_id" text;--> statement-breakpoint
UPDATE "domains" SET "tenant_id" = 'ten_0000000000000000000000' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "domains" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "tenant_id" text;--> statement-breakpoint
UPDATE "addresses" SET "tenant_id" = 'ten_0000000000000000000000' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "addresses" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "endpoints" ADD COLUMN IF NOT EXISTS "tenant_id" text;--> statement-breakpoint
UPDATE "endpoints" SET "tenant_id" = 'ten_0000000000000000000000' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "endpoints" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "tenant_id" text;--> statement-breakpoint
UPDATE "threads" SET "tenant_id" = 'ten_0000000000000000000000' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "threads" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "emails" ADD COLUMN IF NOT EXISTS "tenant_id" text;--> statement-breakpoint
UPDATE "emails" SET "tenant_id" = 'ten_0000000000000000000000' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "emails" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "email_attachments" ADD COLUMN IF NOT EXISTS "tenant_id" text;--> statement-breakpoint
UPDATE "email_attachments" SET "tenant_id" = 'ten_0000000000000000000000' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "email_attachments" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "mail_events" ADD COLUMN IF NOT EXISTS "tenant_id" text;--> statement-breakpoint
UPDATE "mail_events" SET "tenant_id" = 'ten_0000000000000000000000' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "mail_events" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "mail_filter_entries" ADD COLUMN IF NOT EXISTS "tenant_id" text;--> statement-breakpoint
UPDATE "mail_filter_entries" SET "tenant_id" = 'ten_0000000000000000000000' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "mail_filter_entries" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "reply_relays" ADD COLUMN IF NOT EXISTS "tenant_id" text;--> statement-breakpoint
UPDATE "reply_relays" SET "tenant_id" = 'ten_0000000000000000000000' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "reply_relays" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "endpoint_deliveries" ADD COLUMN IF NOT EXISTS "tenant_id" text;--> statement-breakpoint
UPDATE "endpoint_deliveries" SET "tenant_id" = 'ten_0000000000000000000000' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "endpoint_deliveries" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "tenant_id" text;--> statement-breakpoint
UPDATE "api_keys" SET "tenant_id" = 'ten_0000000000000000000000' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "tenant_id" text;--> statement-breakpoint
UPDATE "audit_logs" SET "tenant_id" = 'ten_0000000000000000000000' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "provider_reconciliation_runs" ADD COLUMN IF NOT EXISTS "tenant_id" text;--> statement-breakpoint
UPDATE "provider_reconciliation_runs" SET "tenant_id" = 'ten_0000000000000000000000' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "provider_reconciliation_runs" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

-- Foreign keys after the backfill: adding them first would validate against
-- rows whose tenant_id is still null.
ALTER TABLE "domains" ADD CONSTRAINT "domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_events" ADD CONSTRAINT "mail_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_filter_entries" ADD CONSTRAINT "mail_filter_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_relays" ADD CONSTRAINT "reply_relays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_deliveries" ADD CONSTRAINT "endpoint_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_reconciliation_runs" ADD CONSTRAINT "provider_reconciliation_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Uniqueness becomes per tenant. Dropping first, because the new index covers
-- the same columns plus one and Postgres would otherwise keep both.
DROP INDEX IF EXISTS "domains_name_key";--> statement-breakpoint
DROP INDEX IF EXISTS "emails_fingerprint_key";--> statement-breakpoint
DROP INDEX IF EXISTS "mail_filter_entries_kind_pattern_key";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "domains_tenant_name_key" ON "domains" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domains_tenant_id_idx" ON "domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "emails_tenant_fingerprint_key" ON "emails" USING btree ("tenant_id","fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "emails_tenant_created_at_idx" ON "emails" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_events_tenant_occurred_at_idx" ON "mail_events" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mail_filter_entries_tenant_kind_pattern_key" ON "mail_filter_entries" USING btree ("tenant_id","kind",lower("pattern"));
