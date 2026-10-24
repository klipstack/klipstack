import type { HighlightColor, NotebookFilter } from "@klipstack/api-contract/enums"
import type { Highlight, NotebookArticle, NotebookItem } from "@klipstack/sdk"
import { t } from "./i18n"

/** By article's entry: the article, its note, and its matching highlights in reading order. */
export type NotebookEntry = {
	article: NotebookArticle
	note: string | null
	noteUpdatedAt: string | null
	highlights: Highlight[]
}

/** By topic's group: a topic's newest few cards, and how many it holds in all. */
export type NotebookGroup = {
	topic: { id: string; name: string } | null
	highlights: number
	notes: number
	items: NotebookItem[]
}

/**
 * What the Notebook's list shows, one row each: an article's section (By article), a card
 * (Stream, Shuffle) or a topic's group (By topic). `id` is unique in the list, across pages.
 */
export type NotebookRow =
	| { kind: "article"; id: string; entry: NotebookEntry }
	| { kind: "item"; id: string; item: NotebookItem }
	| { kind: "topic"; id: string; group: NotebookGroup }

/** The answer of `notebook.get`, as far as the list needs it. */
type Answer =
	| { view: "articles"; articles: NotebookEntry[] }
	| { view: "stream" | "shuffle"; items: NotebookItem[] }
	| { view: "topics"; groups: NotebookGroup[] }

/** A card's id in the list: a highlight's own, or its article's for an article's note. */
export function itemId(item: NotebookItem): string {
	return item.kind === "highlight" ? item.highlight.id : `note:${item.article.id}`
}

/** The rows of an answer, in its own view (By topic without topics answers By article). */
export function notebookRows(answer: Answer): NotebookRow[] {
	switch (answer.view) {
		case "articles":
			return answer.articles.map((entry) => ({ kind: "article", id: entry.article.id, entry }))
		case "topics":
			return answer.groups.map((group) => ({
				kind: "topic",
				id: `topic:${group.topic?.id ?? "none"}`,
				group,
			}))
		default:
			return answer.items.map((item) => ({ kind: "item", id: itemId(item), item }))
	}
}

/** Every card of the rows changed by `change` (which returns null to take a card away). */
function mapItems(
	rows: NotebookRow[],
	change: (item: NotebookItem) => NotebookItem | null,
): NotebookRow[] {
	const out: NotebookRow[] = []
	for (const row of rows) {
		if (row.kind === "item") {
			const item = change(row.item)
			if (item) out.push(item === row.item ? row : { ...row, item })
		} else if (row.kind === "topic") {
			const items = row.group.items.flatMap((i) => change(i) ?? [])
			out.push({ ...row, group: { ...row.group, items } })
		} else out.push(row)
	}
	return out
}

/**
 * The article's note as saved here, wherever the rows show it: its section, its card, every topic
 * it is in. A note emptied stays in its section (to write again); its card stays too, until the
 * list loads again.
 */
export function withArticleNote(
	rows: NotebookRow[],
	articleId: string,
	saved: { note: string | null; noteUpdatedAt: string | null },
): NotebookRow[] {
	return mapItems(rows, (item) =>
		item.kind === "note" && item.article.id === articleId
			? { ...item, note: saved.note ?? "", noteUpdatedAt: saved.noteUpdatedAt }
			: item,
	).map((row) =>
		row.kind === "article" && row.entry.article.id === articleId
			? { ...row, entry: { ...row.entry, ...saved } }
			: row,
	)
}

/** The highlight changed (its note), wherever the rows show it. */
export function withHighlight(
	rows: NotebookRow[],
	id: string,
	change: (highlight: Highlight) => Highlight,
): NotebookRow[] {
	return mapItems(rows, (item) =>
		item.kind === "highlight" && item.highlight.id === id
			? { ...item, highlight: change(item.highlight) }
			: item,
	).map((row) =>
		row.kind === "article" && row.entry.highlights.some((h) => h.id === id)
			? {
					...row,
					entry: {
						...row.entry,
						highlights: row.entry.highlights.map((h) => (h.id === id ? change(h) : h)),
					},
				}
			: row,
	)
}

/**
 * The highlight gone, wherever the rows show it. Its article's section stays while it holds its
 * note or other highlights.
 */
export function withoutHighlight(rows: NotebookRow[], id: string): NotebookRow[] {
	return mapItems(rows, (item) =>
		item.kind === "highlight" && item.highlight.id === id ? null : item,
	).flatMap((row) => {
		if (row.kind !== "article" || !row.entry.highlights.some((h) => h.id === id)) return [row]
		const highlights = row.entry.highlights.filter((h) => h.id !== id)
		if (!highlights.length && !row.entry.note) return []
		return [{ ...row, entry: { ...row.entry, highlights } }]
	})
}

/** The filter's name, as the menu says it. */
export function filterLabel(filter: NotebookFilter | null): string {
	if (filter === null) return t("notebook.filters.all")
	if (filter === "notes") return t("notebook.filters.notes")
	if (filter === "highlights") return t("notebook.filters.highlights")
	if (filter === "shared") return t("notebook.filters.shared")
	return COLOR_LABELS[filter]
}

const COLOR_LABELS: Record<HighlightColor, string> = {
	yellow: t("notebook.colors.yellow"),
	green: t("notebook.colors.green"),
	blue: t("notebook.colors.blue"),
	pink: t("notebook.colors.pink"),
	orange: t("notebook.colors.orange"),
}

/** "3 highlights · 1 note": what a topic holds. Nothing for none of either. */
export function countLine(highlights: number, notes: number): string {
	return [
		highlights ? highlightCount(highlights) : null,
		notes ? t("notebook.count.notes", { count: notes }) : null,
	]
		.filter(Boolean)
		.join(" · ")
}

/** "3 highlights". */
export function highlightCount(count: number): string {
	return t("notebook.count.highlights", { count })
}

/** A new Shuffle hand: eight random letters and digits (`NOTEBOOK_SEED`). */
export function newSeed(random: () => number = Math.random): string {
	let seed = ""
	for (let i = 0; i < 8; i++)
		seed += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)]
	return seed
}

/** The zoomed-out choice as stored; anything unknown is zoomed in. */
export function parseZoomed(raw: string | null | undefined): boolean {
	try {
		return JSON.parse(raw ?? "") === true
	} catch {
		return false
	}
}

/**
 * The Notebook zoomed out, as one flat list for a two-column wall: small cards (`tile`), and,
 * across both columns, an article's or a topic's heading and an article's "Show all" (`more`).
 * Flat, so the list draws only what is on screen however much is kept.
 */
export type ZoomTile =
	| { kind: "article"; id: string; entry: NotebookEntry }
	| { kind: "topic"; id: string; group: NotebookGroup }
	| { kind: "tile"; id: string; item: NotebookItem; withArticle: boolean }
	| { kind: "more"; id: string; articleId: string; count: number; open: boolean }

/** Small cards an article shows before "Show all". */
export const ZOOM_COLLAPSED = 6

/**
 * The rows as a wall: By article, each article's heading, then its note and highlights (the first
 * few, unless `open` holds it), then "Show all"; By topic, each topic's heading, then its cards;
 * Stream and Shuffle, their cards. Ids are unique: a card in two topics is two tiles.
 */
export function zoomTiles(rows: NotebookRow[], open: ReadonlySet<string>): ZoomTile[] {
	const tiles: ZoomTile[] = []
	for (const row of rows) {
		if (row.kind === "item") {
			tiles.push({ kind: "tile", id: row.id, item: row.item, withArticle: true })
		} else if (row.kind === "topic") {
			tiles.push({ kind: "topic", id: row.id, group: row.group })
			for (const item of row.group.items)
				tiles.push({ kind: "tile", id: `${row.id}/${itemId(item)}`, item, withArticle: true })
		} else {
			const { entry } = row
			const { article } = entry
			const items: NotebookItem[] = entry.highlights.map((highlight) => ({
				kind: "highlight",
				highlight,
				article,
			}))
			if (entry.note)
				items.unshift({
					kind: "note",
					note: entry.note,
					noteUpdatedAt: entry.noteUpdatedAt,
					writtenAt: entry.noteUpdatedAt ?? "",
					editable: false,
					article,
				})
			const isOpen = open.has(article.id)
			tiles.push({ kind: "article", id: `article:${article.id}`, entry })
			for (const item of isOpen ? items : items.slice(0, ZOOM_COLLAPSED))
				tiles.push({ kind: "tile", id: `${article.id}/${itemId(item)}`, item, withArticle: false })
			if (items.length > ZOOM_COLLAPSED)
				tiles.push({
					kind: "more",
					id: `more:${article.id}`,
					articleId: article.id,
					count: items.length,
					open: isOpen,
				})
		}
	}
	return tiles
}
