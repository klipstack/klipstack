ALTER TABLE "topics" ADD COLUMN "reword_pending" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Topics the reader renamed before this kept the words written for their old name. They get
-- words for the new one at the reader's next run. A change of case is asked again too: harmless.
UPDATE "topics" SET "reword_pending" = true WHERE "named_by_reader" AND "status" = 'active';
