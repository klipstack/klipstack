import { articleFileBase } from "@klipstack/api-contract/names"
import {
	byName,
	and,
	asc,
	type Document,
	db,
	documents,
	documentTags,
	documentVersions,
	documentVia,
	eq,
	type Highlight,
	highlights,
	isNull,
	type SQL,
	tags,
} from "@klipstack/db"
import { htmlToMarkdown } from "@klipstack/extract"
import { strToU8, zipSync } from "fflate"
import { rateLimited } from "~/lib/app-error"
import { rewriteNoteLinks } from "~/lib/note-links"
import { EXPORT_LIMIT, rateLimit } from "~/lib/rate-limit.server"
import { type ExportedEdition, exportEditions } from "./editions.server"
import { listReadingHistory, type ReadingHistory } from "./reading-history.server"
import { listSavedSearches } from "./saved-searches.server"
import { documentTagList } from "./tags.server"

const exporting = new Set<string>()

/** All public export entry points share quota and concurrency admission, before loading data. */
export async function downloadExport(userId: string, format: "json" | "zip"): Promise<ExportFile> {
	if (exporting.has(userId) || exporting.size >= 2) throw rateLimited(2, "exports")
	const limited = rateLimit(`export:${userId}`, EXPORT_LIMIT.limit, EXPORT_LIMIT.windowMs)
	if (!limited.ok) throw rateLimited(limited.retryAfterSeconds, "exports")
	exporting.add(userId)
	try {
		return exportFile(await buildExport(userId), format)
	} finally {
		exporting.delete(userId)
	}
}

export interface ExportedHighlight {
	id: string
	exact: string
	note: string | null
	color: number
	createdAt: string
}

/** A post the article was saved through. */
export interface ExportedVia {
	url: string
	author: string | null
	siteName: string | null
	publishedAt: string | null
	/** What the post said, as Markdown. */
	markdown: string
}

export interface ExportedDocument {
	id: string
	url: string
	canonicalUrl: string | null
	title: string | null
	author: string | null
	siteName: string | null
	description: string | null
	language: string | null
	wordCount: number | null
	publishedAt: string | null
	savedAt: string
	location: "inbox" | "archive"
	archivedAt: string | null
	starred: boolean
	/** Marked for the next edition. */
	shortlisted: boolean
	finishedAt: string | null
	readingHistory: Array<{ completedAt: string; source: ReadingHistory[number]["source"] }>
	markdown: string
	/** The note on the whole article. */
	note: string | null
	noteUpdatedAt: string | null
	/** The note written for the edition's readers, at the end of the article. */
	editionNote: string | null
	/** Tag names, by name. */
	tags: string[]
	highlights: ExportedHighlight[]
	/** The posts it was saved through, oldest first. */
	via: ExportedVia[]
}

export interface ExportBundle {
	exportedAt: string
	app: "klipstack"
	version: 1
	/** Every tag, by name: a tag outlives its articles, so some are on no document. */
	tags: string[]
	/** The searches the user named, by name. The query is what the search page takes. */
	savedSearches: Array<{ name: string; query: string }>
	documents: ExportedDocument[]
	/** Pages of what the user read: each one's working copy and, once published, its snapshot. */
	editions: ExportedEdition[]
}

export async function buildExport(userId: string): Promise<ExportBundle> {
	const docs = await db.query.documents.findMany({
		columns: { search: false, noteSearch: false },
		where: and(eq(documents.userId, userId), isNull(documents.deletedAt)),
		orderBy: asc(documents.createdAt),
	})
	const hls = await db.query.highlights.findMany({
		columns: { search: false },
		where: and(eq(highlights.userId, userId), isNull(highlights.deletedAt)),
		orderBy: asc(highlights.startOffset),
	})
	const byDoc = new Map<string, Highlight[]>()
	for (const h of hls) {
		const list = byDoc.get(h.documentId) ?? []
		list.push(h)
		byDoc.set(h.documentId, list)
	}
	const allTags = await db
		.select({ id: tags.id, name: tags.name })
		.from(tags)
		.where(eq(tags.userId, userId))
		.orderBy(byName(tags.name))
	const tagged = await db
		.select({ documentId: documentTags.documentId, tagId: documentTags.tagId })
		.from(documentTags)
		.innerJoin(tags, eq(tags.id, documentTags.tagId))
		.where(eq(tags.userId, userId))
	const tagIdsByDoc = new Map<string, Set<string>>()
	for (const { documentId, tagId } of tagged) {
		const set = tagIdsByDoc.get(documentId) ?? new Set()
		set.add(tagId)
		tagIdsByDoc.set(documentId, set)
	}
	const out: ExportedDocument[] = []
	const historyByDoc = new Map<string, ReadingHistory>()
	for (const entry of await listReadingHistory(userId)) {
		const entries = historyByDoc.get(entry.documentId) ?? []
		entries.push(entry)
		historyByDoc.set(entry.documentId, entries)
	}
	const viaByDoc = new Map<string, Awaited<ReturnType<typeof viaOf>>>()
	for (const v of await viaOf(eq(documentVia.userId, userId)))
		viaByDoc.set(v.documentId, [...(viaByDoc.get(v.documentId) ?? []), v])
	for (const d of docs) {
		const own = tagIdsByDoc.get(d.id)
		// `allTags` is in order already.
		const names = own ? allTags.filter((t) => own.has(t.id)).map((t) => t.name) : []
		out.push(
			await exportDocument(
				d,
				byDoc.get(d.id) ?? [],
				names,
				historyByDoc.get(d.id) ?? [],
				viaByDoc.get(d.id) ?? [],
			),
		)
	}
	return {
		exportedAt: new Date().toISOString(),
		app: "klipstack",
		version: 1,
		tags: allTags.map((t) => t.name),
		savedSearches: (await listSavedSearches(userId)).map(({ name, query }) => ({ name, query })),
		documents: out,
		editions: await exportEditions(userId),
	}
}

/** The current version, for callers that adjust its HTML before it becomes Markdown. */
export type PrepareHtml = (version: { html: string; imagesDone: boolean }) => string

/** One article of the user's, as exported; null when it does not exist or is in the trash. */
export async function buildDocumentExport(
	userId: string,
	id: string,
	prepareHtml?: PrepareHtml,
): Promise<ExportedDocument | null> {
	const d = await db.query.documents.findFirst({
		columns: { search: false, noteSearch: false },
		where: and(eq(documents.id, id), eq(documents.userId, userId), isNull(documents.deletedAt)),
	})
	if (!d) return null
	const hls = await db.query.highlights.findMany({
		columns: { search: false },
		where: and(
			eq(highlights.documentId, id),
			eq(highlights.userId, userId),
			isNull(highlights.deletedAt),
		),
		orderBy: asc(highlights.startOffset),
	})
	return exportDocument(
		d,
		hls,
		await documentTagList(id),
		await listReadingHistory(userId, id),
		await viaOf(eq(documentVia.documentId, id)),
		prepareHtml,
	)
}

/** Posts articles were saved through, oldest first. */
function viaOf(where: SQL) {
	return db
		.select({
			documentId: documentVia.documentId,
			url: documentVia.url,
			author: documentVia.author,
			siteName: documentVia.siteName,
			html: documentVia.html,
			publishedAt: documentVia.publishedAt,
		})
		.from(documentVia)
		.where(where)
		.orderBy(asc(documentVia.createdAt))
}

async function exportDocument(
	d: Omit<Document, "search" | "noteSearch">,
	hls: Highlight[],
	tagNames: string[],
	readingHistory: ReadingHistory,
	via: Awaited<ReturnType<typeof viaOf>>,
	prepareHtml?: PrepareHtml,
): Promise<ExportedDocument> {
	let markdown = ""
	if (d.currentVersionId) {
		const v = await db.query.documentVersions.findFirst({
			where: eq(documentVersions.id, d.currentVersionId),
			columns: { html: true, imagesDone: true },
		})
		if (v) markdown = htmlToMarkdown(prepareHtml ? prepareHtml(v) : v.html)
	}
	return {
		id: d.id,
		url: d.sourceUrl,
		canonicalUrl: d.canonicalUrl,
		title: d.title,
		author: d.author,
		siteName: d.siteName,
		description: d.description,
		language: d.language,
		wordCount: d.wordCount,
		publishedAt: d.publishedAt?.toISOString() ?? null,
		savedAt: d.createdAt.toISOString(),
		location: d.archivedAt ? "archive" : "inbox",
		archivedAt: d.archivedAt?.toISOString() ?? null,
		starred: Boolean(d.starredAt),
		shortlisted: Boolean(d.shortlistedAt),
		finishedAt: d.readAt?.toISOString() ?? null,
		readingHistory: readingHistory.map(({ completedAt, source }) => ({
			completedAt: completedAt.toISOString(),
			source,
		})),
		markdown,
		note: d.note,
		noteUpdatedAt: d.noteUpdatedAt?.toISOString() ?? null,
		editionNote: d.editionNote,
		tags: tagNames,
		highlights: hls.map((h) => ({
			id: h.id,
			exact: h.exact,
			note: h.note,
			color: h.color,
			createdAt: h.createdAt.toISOString(),
		})),
		via: via.map((v) => ({
			url: v.url,
			author: v.author,
			siteName: v.siteName,
			publishedAt: v.publishedAt?.toISOString() ?? null,
			markdown: htmlToMarkdown(v.html),
		})),
	}
}

function yaml(v: string | null | number | boolean): string {
	if (v === null || v === undefined) return "null"
	if (typeof v === "number" || typeof v === "boolean") return String(v)
	return JSON.stringify(v)
}

/**
 * Turns a linked article's id into the path of its file in the zip, relative to the file being
 * written. Null when the export has no file for it (trashed, or gone).
 */
export type ResolveLink = (id: string) => string | null

/** Leaves every link pointing at the app, for callers that write no files. */
const keepLinks: ResolveLink = (id) => `/read/${id}`

export function highlightsMarkdown(
	list: ExportedHighlight[],
	resolve: ResolveLink = keepLinks,
): string {
	return list
		.map(
			(h) =>
				`> ${h.exact.replace(/\n/g, "\n> ")}${h.note ? `\n\n${rewriteNoteLinks(h.note, resolve)}` : ""}`,
		)
		.join("\n\n")
}

export function documentMarkdown(d: ExportedDocument, resolve: ResolveLink = keepLinks): string {
	const front = [
		"---",
		`title: ${yaml(d.title)}`,
		`url: ${yaml(d.url)}`,
		`author: ${yaml(d.author)}`,
		`site: ${yaml(d.siteName)}`,
		`published: ${yaml(d.publishedAt)}`,
		`saved: ${yaml(d.savedAt)}`,
		`starred: ${yaml(d.starred)}`,
		`finished: ${yaml(d.finishedAt)}`,
		// A flow sequence of quoted strings, only when there are tags.
		...(d.tags.length > 0 ? [`tags: [${d.tags.map(yaml).join(", ")}]`] : []),
		"---",
	].join("\n")
	const via = d.via.map((v) => `${viaMarkdown(v)}\n\n`).join("")
	const body = `# ${d.title ?? d.url}\n\n${via}${d.markdown}`
	const articleNote = d.note ? `\n\n## Note\n\n${rewriteNoteLinks(d.note, resolve)}` : ""
	// For other readers, under the user's name; plain text with web links, no library links.
	const editionNote = d.editionNote ? `\n\n## Note for my next edition\n\n${d.editionNote}` : ""
	const hl = d.highlights.length
		? `\n\n## Highlights\n\n${highlightsMarkdown(d.highlights, resolve)}\n`
		: "\n"
	return `${front}\n\n${body}${articleNote}${editionNote}${hl}`
}

/** A post the article was saved through, quoted, with who shared it and a link to it. */
function viaMarkdown(v: ExportedVia): string {
	const who = [v.author, v.siteName].filter(Boolean).join(" on ")
	const head = `Shared${who ? ` by ${who}` : ""} ([post](${v.url})):`
	return `> ${head}\n>\n> ${v.markdown.trim().replace(/\n/g, "\n> ")}`
}

/** A file to send: its bytes, type and name. The adapters make the `Response`. */
export interface ExportFile {
	body: Uint8Array
	contentType: string
	filename: string
}

/** The bundle as a download: JSON, or the zip. Built in memory, so it has a length. */
export function exportFile(bundle: ExportBundle, format: "zip" | "json"): ExportFile {
	const stamp = bundle.exportedAt.slice(0, 10)
	return {
		body:
			format === "json"
				? new TextEncoder().encode(JSON.stringify(bundle, null, 2))
				: bundleToZip(bundle),
		contentType: format === "json" ? "application/json; charset=utf-8" : "application/zip",
		filename: `klipstack-${stamp}.${format}`,
	}
}

/** Zip with one Markdown file per article, an all-highlights file, and the JSON bundle. */
export function bundleToZip(bundle: ExportBundle): Uint8Array {
	const files: Record<string, Uint8Array> = {}
	// Every article's file name first: a note can link to an article written later in the loop.
	const names = new Map<string, string>()
	const seen = new Map<string, number>()
	for (const d of bundle.documents) {
		const base = articleFileBase(d.savedAt, d.title, d.url)
		const n = (seen.get(base) ?? 0) + 1
		seen.set(base, n)
		names.set(d.id, `${base}${n > 1 ? `-${n}` : ""}.md`)
	}
	// From a file in articles/, a sibling is ./name.md; from highlights.md at the root, articles/name.md.
	const fromArticle: ResolveLink = (id) => {
		const name = names.get(id)
		return name ? `./${name}` : null
	}
	const fromRoot: ResolveLink = (id) => {
		const name = names.get(id)
		return name ? `articles/${name}` : null
	}
	for (const d of bundle.documents)
		files[`articles/${names.get(d.id)}`] = strToU8(documentMarkdown(d, fromArticle))
	const allHighlights = bundle.documents
		.filter((d) => d.note || d.highlights.length)
		.map((d) =>
			[
				`## [${d.title ?? d.url}](${d.url})`,
				d.note ? rewriteNoteLinks(d.note, fromRoot) : null,
				highlightsMarkdown(d.highlights, fromRoot),
			]
				.filter(Boolean)
				.join("\n\n"),
		)
		.join("\n\n")
	files["highlights.md"] = strToU8(`# Highlights\n\n${allHighlights}\n`)
	files["klipstack.json"] = strToU8(JSON.stringify(bundle, null, 2))
	files["README.md"] = strToU8(
		`# Klipstack export\n\nExported ${bundle.exportedAt}. ${bundle.documents.length} articles.\n\n- articles/: one Markdown file per article, with YAML front matter (its tags too), its note and highlights\n- highlights.md: every article note and highlight, grouped by article\n- klipstack.json: everything, machine-readable\n\nLinks between notes point at the files in articles/.\n`,
	)
	return zipSync(files, { level: 6 })
}
