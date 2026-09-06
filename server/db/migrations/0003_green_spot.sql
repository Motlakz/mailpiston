ALTER TABLE "accounts" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "accounts"
SET "issuer" = CASE
  WHEN "provider_id" = 'credential' THEN 'local:credential'
  ELSE 'local:oauth:' || "provider_id"
END
WHERE "issuer" IS NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_issuer_account_id_key" ON "accounts" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");
