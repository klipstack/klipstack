CREATE TABLE "reading_completions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"cycle" integer NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "reading_cycle" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_completions" ADD CONSTRAINT "reading_completions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_completions" ADD CONSTRAINT "reading_completions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reading_completions_document_cycle_unique" ON "reading_completions" USING btree ("document_id","cycle");--> statement-breakpoint
CREATE INDEX "reading_completions_user_date_idx" ON "reading_completions" USING btree ("user_id","completed_at");
--> statement-breakpoint
-- Preserve only known completion dates. Last-opened and archive dates are not completion dates.
INSERT INTO "reading_completions" ("id", "document_id", "user_id", "cycle", "completed_at", "source")
SELECT gen_random_uuid(), "id", "user_id", "reading_cycle", "read_at", 'legacy'
FROM "documents"
WHERE "read_at" IS NOT NULL;
