-- Highlights and article notes get search vectors of their own, built like documents.search
-- (packages/db/src/search.ts): the exact words, unaccented, then their stems in the article's
-- language, or in English and Spanish when it is unknown. A note may not be in the article's
-- language: notes are stemmed in both app languages.
--
-- Triggers keep the vectors current, so no writer can forget them: a highlight's when its quote,
-- note or article changes; an article note's when the note changes; and every highlight of an
-- article when the article's title, author, site or language changes.
ALTER TABLE "documents" ADD COLUMN "note_search" "tsvector";--> statement-breakpoint
ALTER TABLE "highlights" ADD COLUMN "search" "tsvector";--> statement-breakpoint
-- textSearchVector in packages/db/src/search.ts, in SQL; search.test.ts checks that they agree.
CREATE FUNCTION search_part(t text, lang text) RETURNS tsvector LANGUAGE sql STABLE AS $$
	SELECT ts_delete(to_tsvector('simple'::regconfig, p.plain) || '_:16'::tsvector || CASE lang
		WHEN 'en' THEN to_tsvector('english'::regconfig, p.stemmed)
		WHEN 'es' THEN to_tsvector('spanish'::regconfig, p.stemmed)
		WHEN 'pt' THEN to_tsvector('portuguese'::regconfig, p.stemmed)
		WHEN 'fr' THEN to_tsvector('french'::regconfig, p.stemmed)
		WHEN 'it' THEN to_tsvector('italian'::regconfig, p.stemmed)
		WHEN 'de' THEN to_tsvector('german'::regconfig, p.stemmed)
		WHEN 'nl' THEN to_tsvector('dutch'::regconfig, p.stemmed)
		ELSE to_tsvector('english'::regconfig, p.stemmed) || '_:16'::tsvector || to_tsvector('spanish'::regconfig, p.stemmed)
	END, '_')
	FROM (
		SELECT unaccent(coalesce(t, '')) AS plain, left(unaccent(coalesce(t, '')), 100000) AS stemmed
	) p
$$;--> statement-breakpoint
-- The placeholders keep the parts apart: no phrase matches across the quote and the note.
CREATE FUNCTION highlight_search(exact text, note text, title text, author text, site_name text, lang text)
RETURNS tsvector LANGUAGE sql STABLE AS $$
	SELECT ts_delete(
		setweight(search_part(exact, lang), 'A') || '_:16'::tsvector
		|| setweight(search_part(note, NULL), 'B') || '_:16'::tsvector
		|| setweight(search_part(title, lang), 'C') || '_:16'::tsvector
		|| setweight(search_part(author, lang), 'C') || '_:16'::tsvector
		|| setweight(search_part(site_name, lang), 'C'),
		'_')
$$;--> statement-breakpoint
CREATE FUNCTION article_note_search(note text) RETURNS tsvector LANGUAGE sql STABLE AS $$
	SELECT CASE WHEN btrim(coalesce(note, '')) = '' THEN NULL ELSE setweight(search_part(note, NULL), 'B') END
$$;--> statement-breakpoint
UPDATE "highlights" h SET "search" =
	highlight_search(h."exact", h."note", d."title", d."author", d."site_name", d."language")
FROM "documents" d WHERE d."id" = h."document_id";--> statement-breakpoint
UPDATE "documents" SET "note_search" = article_note_search("note") WHERE btrim(coalesce("note", '')) <> '';--> statement-breakpoint
CREATE FUNCTION highlights_search_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	NEW.search := (
		SELECT highlight_search(NEW.exact, NEW.note, d.title, d.author, d.site_name, d.language)
		FROM documents d WHERE d.id = NEW.document_id
	);
	RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER highlights_search BEFORE INSERT OR UPDATE OF exact, note, document_id ON highlights
	FOR EACH ROW EXECUTE FUNCTION highlights_search_write();--> statement-breakpoint
CREATE FUNCTION documents_note_search_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	NEW.note_search := article_note_search(NEW.note);
	RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER documents_note_search BEFORE INSERT OR UPDATE OF note ON documents
	FOR EACH ROW EXECUTE FUNCTION documents_note_search_write();--> statement-breakpoint
CREATE FUNCTION documents_highlights_search_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	UPDATE highlights h
	SET search = highlight_search(h.exact, h.note, NEW.title, NEW.author, NEW.site_name, NEW.language)
	WHERE h.document_id = NEW.id;
	RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER documents_highlights_search AFTER UPDATE OF title, author, site_name, language ON documents
	FOR EACH ROW
	WHEN (OLD.title IS DISTINCT FROM NEW.title OR OLD.author IS DISTINCT FROM NEW.author
		OR OLD.site_name IS DISTINCT FROM NEW.site_name OR OLD.language IS DISTINCT FROM NEW.language)
	EXECUTE FUNCTION documents_highlights_search_write();--> statement-breakpoint
CREATE INDEX "documents_note_search_idx" ON "documents" USING gin ("note_search") WHERE "documents"."note_search" is not null;--> statement-breakpoint
CREATE INDEX "highlights_search_idx" ON "highlights" USING gin ("search");
