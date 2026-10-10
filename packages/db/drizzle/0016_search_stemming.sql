-- Library search ignores accents and matches word variants ("blocked" finds "blocking"). A search
-- vector now holds the exact words plus their stems: in the article's language when Postgres can
-- stem it, else in English and Spanish. This rebuilds every stored vector the way
-- packages/db/src/search.ts builds new ones. The '_:16' placeholder keeps the concatenated vectors
-- apart, so no phrase matches across two of them; ts_delete removes it.
UPDATE "documents" SET "language" = NULL WHERE "language" = '';
--> statement-breakpoint
CREATE FUNCTION pg_temp.search_part(t text, lang text) RETURNS tsvector LANGUAGE sql STABLE AS $$
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
$$;
--> statement-breakpoint
UPDATE "documents" d SET "search" =
	setweight(pg_temp.search_part(d."title", d."language"), 'A')
	|| setweight(pg_temp.search_part(d."author", d."language"), 'B')
	|| setweight(pg_temp.search_part(
		(SELECT left(v."text", 400000) FROM "document_versions" v WHERE v."id" = d."current_version_id"),
		d."language"
	), 'D')
WHERE d."search" IS NOT NULL;
--> statement-breakpoint
DROP FUNCTION pg_temp.search_part(text, text);
