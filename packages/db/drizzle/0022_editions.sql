CREATE TABLE "edition_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"edition_id" uuid NOT NULL,
	"document_id" uuid,
	"position" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"site_name" text,
	"description" text,
	"lead_image_url" text,
	"reading_minutes" integer,
	"word_count" integer,
	"read_on" date,
	"note" text,
	"include_note" boolean DEFAULT false NOT NULL,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "edition_items_edition_position_unique" UNIQUE("edition_id","position") DEFERRABLE INITIALLY IMMEDIATE
);
--> statement-breakpoint
CREATE TABLE "editions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"public_id" text NOT NULL,
	"title" text NOT NULL,
	"intro" text,
	"locale" text NOT NULL,
	"time_zone" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"published" jsonb,
	"published_at" timestamp with time zone,
	"republished_at" timestamp with time zone,
	"unpublished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editions_period_check" CHECK ("editions"."period_end" >= "editions"."period_start")
);
--> statement-breakpoint
ALTER TABLE "edition_items" ADD CONSTRAINT "edition_items_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_items" ADD CONSTRAINT "edition_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "edition_items_edition_document_unique" ON "edition_items" USING btree ("edition_id","document_id");--> statement-breakpoint
CREATE INDEX "edition_items_document_idx" ON "edition_items" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "editions_public_id_unique" ON "editions" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "editions_user_created_idx" ON "editions" USING btree ("user_id","created_at" DESC NULLS LAST);