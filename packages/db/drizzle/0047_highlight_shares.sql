CREATE TABLE "highlight_shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"highlight_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"published" jsonb,
	"shared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_ground" text,
	"removed_note" text
);
--> statement-breakpoint
ALTER TABLE "edition_reports" ALTER COLUMN "edition_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "edition_reports" ADD COLUMN "share_id" uuid;--> statement-breakpoint
ALTER TABLE "highlight_shares" ADD CONSTRAINT "highlight_shares_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "highlight_shares" ADD CONSTRAINT "highlight_shares_highlight_id_highlights_id_fk" FOREIGN KEY ("highlight_id") REFERENCES "public"."highlights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "highlight_shares_highlight_unique" ON "highlight_shares" USING btree ("highlight_id");--> statement-breakpoint
CREATE UNIQUE INDEX "highlight_shares_public_id_unique" ON "highlight_shares" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "highlight_shares_user_idx" ON "highlight_shares" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "edition_reports" ADD CONSTRAINT "edition_reports_share_id_highlight_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."highlight_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edition_reports_share_idx" ON "edition_reports" USING btree ("share_id","created_at");--> statement-breakpoint
ALTER TABLE "edition_reports" ADD CONSTRAINT "edition_reports_one_target" CHECK (num_nonnulls("edition_reports"."edition_id", "edition_reports"."share_id") = 1);