-- An article used to count as finished when it was scrolled to 95%, with or without a finish
-- date. Now only the finish date (`read_at`) says so: leaving the reader after reaching the end
-- sets it. Articles read to the end before that (finishing on leave came on 2026-10-02, on the web
-- and in the app) get the date they would have had, so they stay finished: when their reading
-- reached the end, else when they were last read. Those read to the end since, and not finished,
-- were kept or undone on purpose. Opening an article again later (an archived one, to look at a
-- highlight) does not move that date.
UPDATE "documents" d
SET "read_at" = r."reached"
FROM (
	SELECT x."id", coalesce(
		(
			SELECT max(c."completed_at") FROM "reading_completions" c
			WHERE c."document_id" = x."id" AND c."cycle" = x."reading_cycle"
		),
		x."last_read_at",
		x."first_opened_at",
		x."created_at"
	) AS "reached"
	FROM "documents" x
	WHERE x."read_at" IS NULL AND x."reading_progress" >= 0.95
) r
WHERE d."id" = r."id" AND r."reached" < '2026-10-02T00:00:00Z';
