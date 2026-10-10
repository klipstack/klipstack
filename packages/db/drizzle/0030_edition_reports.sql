CREATE TABLE "edition_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"edition_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text NOT NULL,
	"email" text,
	"locale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "removed_ground" text;--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "removed_note" text;--> statement-breakpoint
ALTER TABLE "edition_reports" ADD CONSTRAINT "edition_reports_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edition_reports_edition_idx" ON "edition_reports" USING btree ("edition_id","created_at");