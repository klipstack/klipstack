ALTER TABLE "documents" ADD COLUMN "shared_url" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "shared_url_hash" text;--> statement-breakpoint
CREATE INDEX "documents_user_shared_url_idx" ON "documents" USING btree ("user_id","shared_url_hash") WHERE "documents"."shared_url_hash" is not null;