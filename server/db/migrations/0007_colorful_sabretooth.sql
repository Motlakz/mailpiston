CREATE TYPE "public"."mail_filter_kind" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TYPE "public"."spam_verdict" AS ENUM('clean', 'suspicious', 'spam');--> statement-breakpoint
ALTER TYPE "public"."mail_event_type" ADD VALUE 'email.quarantined';--> statement-breakpoint
ALTER TYPE "public"."mail_event_type" ADD VALUE 'email.released';--> statement-breakpoint
ALTER TYPE "public"."mail_event_type" ADD VALUE 'email.deleted';--> statement-breakpoint
ALTER TYPE "public"."mail_event_type" ADD VALUE 'email.restored';--> statement-breakpoint
CREATE TABLE "mail_filter_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "mail_filter_kind" NOT NULL,
	"pattern" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "spam_verdict" "spam_verdict" DEFAULT 'clean' NOT NULL;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "spam_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "spam_category" text;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "spam_signals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_filter_entries_kind_pattern_key" ON "mail_filter_entries" USING btree ("kind",lower("pattern"));--> statement-breakpoint
CREATE INDEX "emails_spam_verdict_idx" ON "emails" USING btree ("spam_verdict","created_at");--> statement-breakpoint
CREATE INDEX "emails_deleted_at_idx" ON "emails" USING btree ("deleted_at");