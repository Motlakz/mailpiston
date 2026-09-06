CREATE TABLE "domain_webhook_keys" (
	"domain_id" text PRIMARY KEY NOT NULL,
	"key_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_webhook_keys" ADD CONSTRAINT "domain_webhook_keys_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;