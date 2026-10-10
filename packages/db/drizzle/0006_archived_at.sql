ALTER TABLE "documents" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
-- When each archived article went to the archive. Finished ones know (read_at); for the rest the
-- last update is the best guess there is.
UPDATE "documents" SET "archived_at" = coalesce("read_at", "updated_at") WHERE "location" = 'archive';--> statement-breakpoint
CREATE INDEX "documents_user_archived_idx" ON "documents" USING btree ("user_id","archived_at" DESC NULLS LAST);
