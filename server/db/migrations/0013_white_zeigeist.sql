CREATE TYPE "public"."mail_filter_source" AS ENUM('operator', 'auto');--> statement-breakpoint
ALTER TABLE "mail_filter_entries" ADD COLUMN "source" "mail_filter_source" DEFAULT 'operator' NOT NULL;