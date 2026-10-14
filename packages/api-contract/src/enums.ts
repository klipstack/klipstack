/**
 * The API's enumerations, as `as const` arrays. This entry point imports nothing, so client code
 * (the web app, the extension) can use it without pulling zod into its bundle.
 */

/** `all`: the library and the archive together, out of the trash. */
export const VIEWS = ["inbox", "archive", "starred", "all", "trash"] as const
export type View = (typeof VIEWS)[number]

/** `again`: finished before, and put back unread to be read again. */
export const INBOX_FILTERS = ["progress", "unread", "again", "quick", "long", "x", "read"] as const
export type InboxFilter = (typeof INBOX_FILTERS)[number]

/** For the archive and starred: read or not, everything counts. */
export const ARCHIVE_FILTERS = ["unfinished", "finished", "quick", "long", "x"] as const
export type ArchiveFilter = (typeof ARCHIVE_FILTERS)[number]

/** Every list filter; which ones a view takes depends on the view. */
export const LIST_FILTERS = [
	"progress",
	"unread",
	"again",
	"quick",
	"long",
	"x",
	"read",
	"unfinished",
	"finished",
] as const
export type ListFilter = (typeof LIST_FILTERS)[number]

const SAVED_SORTS = ["newest", "oldest", "shortest", "longest"] as const
export const LIST_SORTS = ["recent", ...SAVED_SORTS] as const
export type ListSort = (typeof LIST_SORTS)[number]

/** Index = the `color` column of a highlight. */
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "orange"] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

export const HIGHLIGHT_FILTERS = ["notes", ...HIGHLIGHT_COLORS] as const
export type HighlightFilter = (typeof HIGHLIGHT_FILTERS)[number]

/**
 * What the Notebook shows besides everything: notes (article notes, and highlights with a note),
 * highlights alone, or the highlights of one color.
 */
export const NOTEBOOK_FILTERS = ["notes", "highlights", ...HIGHLIGHT_COLORS] as const
export type NotebookFilter = (typeof NOTEBOOK_FILTERS)[number]

/** By article, as one stream, by the articles' topics, or a random hand. */
export const NOTEBOOK_VIEWS = ["articles", "stream", "topics", "shuffle"] as const
export type NotebookView = (typeof NOTEBOOK_VIEWS)[number]

/** Search operators (`in:archive`, `is:starred`…): see `./search-query`. */
export const SEARCH_LOCATIONS = ["library", "archive", "trash", "anywhere"] as const
export type SearchLocation = (typeof SEARCH_LOCATIONS)[number]

export const SEARCH_IS = [
	"starred",
	"shortlisted",
	"unread",
	"reading",
	"finished",
	"quick",
	"long",
	"failed",
] as const
export type SearchIs = (typeof SEARCH_IS)[number]

export const SEARCH_HAS = ["highlights", "note", "tags", "topic"] as const
export type SearchHas = (typeof SEARCH_HAS)[number]

export const SEARCH_SORTS = ["relevance", ...SAVED_SORTS] as const
export type SearchSort = (typeof SEARCH_SORTS)[number]

/** How an article was saved. Mirrors the database's `captureSource`. */
export const CAPTURE_SOURCES = ["web", "extension", "api", "feed"] as const
export type CaptureSource = (typeof CAPTURE_SOURCES)[number]
