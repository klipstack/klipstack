ALTER TABLE "editions" DROP CONSTRAINT "editions_period_check";--> statement-breakpoint
ALTER TABLE "editions" ALTER COLUMN "title" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "editions" DROP COLUMN "period_start";--> statement-breakpoint
ALTER TABLE "editions" DROP COLUMN "period_end";--> statement-breakpoint
-- A blank title was a draft not yet named; now no title is null.
UPDATE "editions" SET "title" = NULL WHERE "title" = '';
