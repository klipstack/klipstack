import { and, asc, db, eq, highlights, isNull } from "@klipstack/db"
import { insertTitle, type LinkStatus, parse } from "~/lib/note-links"
import { getDocument } from "../documents.server"
import { linkTargetStatus, listBacklinks, listContentLinks } from "../links.server"
import { readerUrl } from "./results.server"

/**
 * Links between articles, as the reader shows them, of two kinds that are never mixed. Note links:
 * what an article's notes (its own and its highlights') link to, and which articles' notes link to
 * it; the user wrote them. Content links: library articles the article's content links to, and the
 * ones whose content links to it; the authors wrote them.
 */

/** A note that can hold links: the article's own, or one of its highlights'. */
export interface NoteSource {
	highlightId: string | null
	quote: string | null
	note: string | null
}

export interface NoteLinkTo {
	id: string
	title: string
	status: LinkStatus
	klipstackUrl: string
	/** Null when the link is in the article's own note. */
	highlight: { id: string; quote: string | null } | null
}

export interface NoteLinkFrom {
	id: string
	title: string | null
	url: string
	klipstackUrl: string
	/** Null when the link is in that article's own note. */
	highlight: { id: string; quote: string | null } | null
}

/** A library article at the other end of a link in an article's content. */
export interface ContentLink {
	id: string
	title: string | null
	url: string
	klipstackUrl: string
}

export interface ContentLinks {
	to: ContentLink[]
	from: ContentLink[]
}

/** Every link in these notes, in order, with whether its target is still readable. */
export async function linksFromNotes(userId: string, sources: NoteSource[]): Promise<NoteLinkTo[]> {
	const found: Omit<NoteLinkTo, "status">[] = []
	for (const source of sources) {
		if (!source.note) continue
		const highlight = source.highlightId ? { id: source.highlightId, quote: source.quote } : null
		for (const segment of parse(source.note).flat())
			if (segment.kind === "link")
				found.push({
					id: segment.id,
					title: segment.title,
					klipstackUrl: readerUrl(segment.id),
					highlight,
				})
	}
	const status = await linkTargetStatus(
		userId,
		found.map((l) => l.id),
	)
	return found.map((l) => ({ ...l, status: status[l.id] ?? "missing" }))
}

/** Articles whose notes link to this one. */
export async function backlinksTo(userId: string, articleId: string): Promise<NoteLinkFrom[]> {
	const rows = await listBacklinks(userId, articleId)
	return rows.map((b) => ({
		id: b.documentId,
		title: b.title,
		url: b.sourceUrl,
		klipstackUrl: readerUrl(b.documentId),
		highlight: b.highlightId ? { id: b.highlightId, quote: b.exact } : null,
	}))
}

/** Library articles this article's content links to, and the ones whose content links to it. */
export async function contentLinksOf(userId: string, articleId: string): Promise<ContentLinks> {
	const links = await listContentLinks(userId, articleId)
	const shape = (l: (typeof links.to)[number]): ContentLink => ({
		id: l.documentId,
		title: l.title,
		url: l.sourceUrl,
		klipstackUrl: readerUrl(l.documentId),
	})
	return { to: links.to.map(shape), from: links.from.map(shape) }
}

/** Both kinds, both directions, for one article; null when it is not in the library. */
export async function articleLinks(userId: string, articleId: string) {
	const doc = await getDocument(userId, articleId)
	if (!doc) return null
	const notes = await db
		.select({ highlightId: highlights.id, quote: highlights.exact, note: highlights.note })
		.from(highlights)
		.where(
			and(
				eq(highlights.documentId, articleId),
				eq(highlights.userId, userId),
				isNull(highlights.deletedAt),
			),
		)
		.orderBy(asc(highlights.startOffset))
	const [to, from, contentLinks] = await Promise.all([
		linksFromNotes(userId, [{ highlightId: null, quote: null, note: doc.note }, ...notes]),
		backlinksTo(userId, articleId),
		contentLinksOf(userId, articleId),
	])
	return { noteLinks: { to, from }, contentLinks }
}

const STATUS_NOTE: Record<LinkStatus, string> = {
	ok: "",
	trash: " (in the trash)",
	missing: " (no longer in the library)",
}

function where(highlight: { quote: string | null } | null, own: string) {
	if (!highlight) return own
	const quote = (highlight.quote ?? "").replace(/\s+/g, " ").trim()
	return `a highlight: “${quote.length > 80 ? `${quote.slice(0, 79)}…` : quote}”`
}

/**
 * The link sections of get_article, one per kind and direction; empty when there are none. The
 * headings say who wrote the links: the user in notes, or the authors in the articles' content.
 */
export function linksMarkdown(
	to: NoteLinkTo[],
	from: NoteLinkFrom[],
	content: ContentLinks,
): string {
	const sections: string[] = []
	if (to.length)
		sections.push(
			`## Note links to\n\n${to
				.map(
					(l) =>
						`- [${insertTitle(l.title)}](${l.klipstackUrl})${STATUS_NOTE[l.status]}, from ${where(l.highlight, "the note")}`,
				)
				.join("\n")}`,
		)
	if (from.length)
		sections.push(
			`## Note links from\n\n${from
				.map(
					(l) =>
						`- [${insertTitle(l.title ?? l.url)}](${l.klipstackUrl}), in ${where(l.highlight, "its note")}`,
				)
				.join("\n")}`,
		)
	const contentRow = (l: ContentLink) => `- [${insertTitle(l.title ?? l.url)}](${l.klipstackUrl})`
	if (content.to.length)
		sections.push(`## Content links to\n\n${content.to.map(contentRow).join("\n")}`)
	if (content.from.length)
		sections.push(`## Content links from\n\n${content.from.map(contentRow).join("\n")}`)
	return sections.join("\n\n")
}
