/**
 * Names and text clients write the way the app does: export file names, link titles in notes, and
 * what stored text may hold. Imports nothing.
 */

/** Postgres text cannot hold NUL characters: titles and notes with them are refused. */
export const withoutNul = (text: string) => !text.includes("\u0000")
export const NUL_REFUSED = "Text cannot contain NUL characters (U+0000)."

/** Days a deleted article or highlight stays in the trash before the purge job removes it. */
export const TRASH_RETENTION_DAYS = 30

/** Longest article title, in characters. */
export const ARTICLE_TITLE_MAX = 300
/** Longest URL a page is saved or followed from, in characters. */
export const URL_MAX = 4096
/** Longest name a user gives a followed feed, in characters. */
export const FEED_TITLE_MAX = 200

/** Longest highlighted quote, in characters. */
export const QUOTE_MAX = 20_000

/** Longest article note, in characters. */
export const NOTE_MAX = 100_000
/** Longest highlight note, in characters. */
export const HIGHLIGHT_NOTE_MAX = 10_000

export function slugify(s: string): string {
	return (
		s
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "untitled"
	)
}

/** `<saved date>-<title slug>`: the base name of an article's file in the export zip. */
export function articleFileBase(savedAt: string, title: string | null, url: string): string {
	return `${savedAt.slice(0, 10)}-${slugify(title ?? url)}`
}

/** Longest link text the app inserts. Hand-typed text longer than this still parses. */
export const TITLE_MAX = 200

/**
 * An article title as note link text (`[title](/read/<id>)`): brackets would end the link and
 * newlines the paragraph.
 */
export function insertTitle(title: string): string {
	return title.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX)
}

export const SAVED_SEARCH_NAME_MAX = 50
export const SAVED_SEARCHES_PER_USER_MAX = 50

/**
 * A saved search's name as stored: trimmed, inner whitespace as one space. Null when it cannot be
 * a name: empty, too long, or with a NUL. Nothing parses it, so quotes and commas are fine.
 */
export function cleanSavedSearchName(raw: string): string | null {
	const name = raw.replace(/\s+/g, " ").trim()
	if (name.length === 0 || name.length > SAVED_SEARCH_NAME_MAX) return null
	return withoutNul(name) ? name : null
}

export const TAG_NAME_MAX = 50
export const TAGS_PER_ARTICLE_MAX = 20
export const TAGS_PER_USER_MAX = 500

/**
 * A tag name as stored: trimmed, inner whitespace as one space. Null when it cannot be a name:
 * empty, too long, or with a character a name may not hold. A quote would break `tag:"…"` in a
 * search, a comma ends a name where tags are typed, and Postgres refuses NUL.
 */
export function cleanTagName(raw: string): string | null {
	const name = raw.replace(/\s+/g, " ").trim()
	if (name.length === 0 || name.length > TAG_NAME_MAX) return null
	return /[",]/.test(name) || !withoutNul(name) ? null : name
}
