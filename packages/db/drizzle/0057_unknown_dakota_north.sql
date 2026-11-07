ALTER TABLE "document_versions" ADD COLUMN "translated_from_id" uuid;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "word_count" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "original_version_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "translation_status" text;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_translated_from_id_document_versions_id_fk" FOREIGN KEY ("translated_from_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_versions_translated_from_idx" ON "document_versions" USING btree ("translated_from_id","language") WHERE "document_versions"."translated_from_id" is not null;