-- Highlight notes become short notes: 2,000 characters (HIGHLIGHT_NOTE_MAX). Longer ones are cut
-- to it. char_length counts code points, as the server's check does, so a cut note saves again.
-- Links cut off the note stop being backlinks (a note's links are otherwise rewritten on save).
DELETE FROM "document_links" l USING "highlights" h
WHERE l."highlight_id" = h."id" AND char_length(h."note") > 2000
	AND strpos(rtrim(left(h."note", 2000)), '](/read/' || l."to_document_id" || ')') = 0;
--> statement-breakpoint
UPDATE "highlights" SET "note" = rtrim(left("note", 2000)), "updated_at" = now()
WHERE char_length("note") > 2000;
