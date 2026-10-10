-- Offline warm-up fetches used to count as the user opening an article. Articles that were never
-- actually read (no progress, no position, not finished) go back to unread.
UPDATE "documents"
SET "first_opened_at" = NULL, "last_read_at" = NULL
WHERE "reading_progress" = 0 AND "reading_position" = 0 AND "read_at" IS NULL;
