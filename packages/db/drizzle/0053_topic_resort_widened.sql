ALTER TABLE "topic_libraries" ALTER COLUMN "unsorted_at_last_grow" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "resort_widened" boolean DEFAULT false NOT NULL;