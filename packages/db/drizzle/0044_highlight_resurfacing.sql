CREATE TABLE "highlight_resurfacing" (
	"highlight_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"shown_on" date,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "highlight_resurfacing" ADD CONSTRAINT "highlight_resurfacing_highlight_id_highlights_id_fk" FOREIGN KEY ("highlight_id") REFERENCES "public"."highlights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "highlight_resurfacing" ADD CONSTRAINT "highlight_resurfacing_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "highlight_resurfacing_user_shown_idx" ON "highlight_resurfacing" USING btree ("user_id","shown_on");