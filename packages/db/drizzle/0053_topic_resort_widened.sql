ALTER TABLE "topic_libraries" ADD COLUMN "grew_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "resort_widened" boolean DEFAULT false NOT NULL;