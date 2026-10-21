-- Highlight notes become short notes: 2,000 characters (HIGHLIGHT_NOTE_MAX). Longer ones are cut
-- to it. char_length counts code points, as the server's check does, so a cut note saves again.
UPDATE "highlights" SET "note" = rtrim(left("note", 2000))
WHERE char_length("note") > 2000;
