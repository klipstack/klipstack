CREATE TABLE "document_via" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"url_hash" text NOT NULL,
	"author" text,
	"site_name" text,
	"html" text NOT NULL,
	"published_at" timestamp with time zone,
	"raw_id" uuid,
	"saved_as" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_via" ADD CONSTRAINT "document_via_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_via" ADD CONSTRAINT "document_via_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_via" ADD CONSTRAINT "document_via_raw_id_document_raw_id_fk" FOREIGN KEY ("raw_id") REFERENCES "public"."document_raw"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_via_document_hash_idx" ON "document_via" USING btree ("document_id","url_hash");--> statement-breakpoint
CREATE INDEX "document_via_user_hash_idx" ON "document_via" USING btree ("user_id","url_hash");--> statement-breakpoint
CREATE INDEX "document_via_saved_as_idx" ON "document_via" USING btree ("saved_as") WHERE "document_via"."saved_as" is not null;