CREATE TABLE "document_outlinks" (
	"document_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"url_hash" text NOT NULL,
	CONSTRAINT "document_outlinks_document_id_url_hash_pk" PRIMARY KEY("document_id","url_hash")
);
--> statement-breakpoint
ALTER TABLE "document_outlinks" ADD CONSTRAINT "document_outlinks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_outlinks" ADD CONSTRAINT "document_outlinks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_outlinks_user_hash_idx" ON "document_outlinks" USING btree ("user_id","url_hash");