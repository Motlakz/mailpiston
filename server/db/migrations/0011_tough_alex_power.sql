DROP INDEX "accounts_issuer_account_id_key";--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "issuer" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "accounts_provider_account_idx" ON "accounts" USING btree ("provider_id","account_id");