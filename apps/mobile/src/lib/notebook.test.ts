import { NOTEBOOK_SEED } from "@klipstack/api-contract"
import type { Highlight, NotebookArticle, NotebookItem } from "@klipstack/sdk"
import { describe, expect, it } from "vitest"
import {
	countLine,
	filterLabel,
	type NotebookRow,
	newSeed,
	parseZoomed,
	ZOOM_COLLAPSED,
	zoomTiles,
	notebookRows,
	withArticleNote,
	withHighlight,
	withoutHighlight,
} from "./notebook"

const article = (id: string): NotebookArticle => ({
	id,
	title: `Title ${id}`,
	author: null,
	site: null,
	url: `https://example.com/${id}`,
	readerUrl: `https://klipstack.test/read/${id}`,
	leadImage: null,
})

const highlight = (id: string, articleId: string, note: string | null = null): Highlight => ({
	id,
	quote: `Quote ${id}`,
	note,
	color: "yellow",
	createdAt: "2026-10-01T00:00:00.000Z",
	article: { id: articleId, title: null, url: `https://example.com/${articleId}`, site: null },
	start: 0,
	end: 5,
})

const noteItem = (articleId: string, note: string): NotebookItem => ({
	kind: "note",
	note,
	noteUpdatedAt: "2026-10-01T00:00:00.000Z",
	writtenAt: "2026-10-01T00:00:00.000Z",
	editable: true,
	article: article(articleId),
})

const highlightItem = (h: Highlight): NotebookItem => ({
	kind: "highlight",
	highlight: h,
	article: article(h.article.id),
})

describe("notebookRows", () => {
	it("gives an article's note card and its highlight's card ids that never collide", () => {
		// A note card's id is its article's: a highlight with that same id must stay a row of its own.
		const rows = notebookRows({
			view: "stream",
			items: [noteItem("a1", "Mine"), highlightItem(highlight("a1", "a2"))],
		})
		expect(new Set(rows.map((r) => r.id)).size).toBe(2)
	})

	it("keeps the topic groups apart from the articles in none", () => {
		const rows = notebookRows({
			view: "topics",
			groups: [
				{ topic: { id: "t1", name: "Cities" }, highlights: 1, notes: 0, items: [] },
				{ topic: null, highlights: 0, notes: 1, items: [] },
			],
		})
		expect(rows.map((r) => r.id)).toEqual(["topic:t1", "topic:none"])
	})
})

describe("withArticleNote", () => {
	it("updates the note wherever it shows, and nothing else", () => {
		const saved = { note: "Written here", noteUpdatedAt: "2026-10-02T00:00:00.000Z" }
		const rows: NotebookRow[] = [
			{
				kind: "article",
				id: "a1",
				entry: { article: article("a1"), note: null, noteUpdatedAt: null, highlights: [] },
			},
			{ kind: "item", id: "note:a1", item: noteItem("a1", "Old") },
			{ kind: "item", id: "note:a2", item: noteItem("a2", "Other") },
			{
				kind: "topic",
				id: "topic:t1",
				group: { topic: null, highlights: 0, notes: 2, items: [noteItem("a1", "Old")] },
			},
		]
		const next = withArticleNote(rows, "a1", saved)
		const [section, card, other, group] = next
		expect(section?.kind === "article" && section.entry.note).toBe("Written here")
		// The editor compares this with what it saved: a stale one would start it over.
		expect(section?.kind === "article" && section.entry.noteUpdatedAt).toBe(saved.noteUpdatedAt)
		expect(card?.kind === "item" && card.item.kind === "note" && card.item.noteUpdatedAt).toBe(
			saved.noteUpdatedAt,
		)
		expect(other).toBe(rows[2])
		const inGroup = group?.kind === "topic" ? group.group.items[0] : null
		expect(inGroup?.kind === "note" && inGroup.note).toBe("Written here")
	})
})

describe("withArticleNote, emptied", () => {
	it("keeps the section and the card, with no text, to write again", () => {
		const rows: NotebookRow[] = [
			{
				kind: "article",
				id: "a1",
				entry: { article: article("a1"), note: "Old", noteUpdatedAt: null, highlights: [] },
			},
			{ kind: "item", id: "note:a1", item: noteItem("a1", "Old") },
		]
		const [section, card] = withArticleNote(rows, "a1", { note: null, noteUpdatedAt: null })
		expect(section?.kind === "article" && section.entry.note).toBe(null)
		expect(card?.kind === "item" && card.item.kind === "note" && card.item.note).toBe("")
	})
})

describe("countLine and filterLabel", () => {
	it("says what a topic holds, in the singular for one, and leaves out none", () => {
		expect(countLine(3, 1)).toBe("3 highlights · 1 note")
		expect(countLine(1, 0)).toBe("1 highlight")
		expect(countLine(0, 2)).toBe("2 notes")
		expect(filterLabel(null)).toBe("All")
		expect(filterLabel("notes")).toBe("Notes")
		expect(filterLabel("pink")).toBe("Pink")
	})
})

describe("withoutHighlight", () => {
	it("drops an article's section once it holds nothing, but keeps one with its note", () => {
		const rows: NotebookRow[] = [
			{
				kind: "article",
				id: "a1",
				entry: {
					article: article("a1"),
					note: null,
					noteUpdatedAt: null,
					highlights: [highlight("h1", "a1")],
				},
			},
			{
				kind: "article",
				id: "a2",
				entry: {
					article: article("a2"),
					note: "Kept",
					noteUpdatedAt: null,
					highlights: [highlight("h2", "a2")],
				},
			},
		]
		const once = withoutHighlight(rows, "h1")
		expect(once.map((r) => r.id)).toEqual(["a2"])
		const twice = withoutHighlight(once, "h2")
		expect(twice.map((r) => r.id)).toEqual(["a2"])
		expect(twice[0]?.kind === "article" && twice[0].entry.highlights).toEqual([])
	})

	it("takes the card out of the stream and of every topic", () => {
		const h = highlight("h1", "a1")
		const rows: NotebookRow[] = [
			{ kind: "item", id: "h1", item: highlightItem(h) },
			{
				kind: "topic",
				id: "topic:t1",
				group: { topic: null, highlights: 1, notes: 0, items: [highlightItem(h)] },
			},
		]
		const next = withoutHighlight(rows, "h1")
		expect(next.map((r) => r.id)).toEqual(["topic:t1"])
		expect(next[0]?.kind === "topic" && next[0].group.items).toEqual([])
	})
})

describe("withHighlight", () => {
	it("changes the highlight in its article's section and on its cards", () => {
		const h = highlight("h1", "a1")
		const rows: NotebookRow[] = [
			{
				kind: "article",
				id: "a1",
				entry: { article: article("a1"), note: null, noteUpdatedAt: null, highlights: [h] },
			},
			{ kind: "item", id: "h1", item: highlightItem(h) },
		]
		const next = withHighlight(rows, "h1", (x) => ({ ...x, note: "Noted" }))
		expect(next[0]?.kind === "article" && next[0].entry.highlights[0]?.note).toBe("Noted")
		expect(
			next[1]?.kind === "item" && next[1].item.kind === "highlight" && next[1].item.highlight.note,
		).toBe("Noted")
	})
})

describe("newSeed", () => {
	it("deals a seed the API takes, from the low and high ends of the random range", () => {
		expect(newSeed(() => 0)).toMatch(NOTEBOOK_SEED)
		expect(newSeed(() => 0.9999)).toMatch(NOTEBOOK_SEED)
		expect(newSeed(() => 0.9999)).toBe("99999999")
	})
})

describe("zoomTiles", () => {
	const entry = (id: string, note: string | null, n: number) => ({
		kind: "article" as const,
		id,
		entry: {
			article: article(id),
			note,
			noteUpdatedAt: null,
			highlights: Array.from({ length: n }, (_, i) => highlight(`${id}-h${i}`, id)),
		},
	})

	it("heads each article, its note first, and folds what is past the first few", () => {
		// The note and six highlights: seven cards, one past the fold.
		const tiles = zoomTiles([entry("a1", "Mine", ZOOM_COLLAPSED), entry("a2", null, 1)], new Set())
		expect(tiles.map((t) => t.kind)).toEqual([
			"article",
			...Array.from({ length: ZOOM_COLLAPSED }, () => "tile"),
			"more",
			"article",
			"tile",
		])
		const first = tiles[1]
		expect(first?.kind === "tile" && first.item.kind).toBe("note")
		const more = tiles[ZOOM_COLLAPSED + 1]
		expect(more?.kind === "more" && more.count).toBe(ZOOM_COLLAPSED + 1)
	})

	it("shows every card of an article opened, with the way to fold it again", () => {
		const tiles = zoomTiles([entry("a1", "Mine", ZOOM_COLLAPSED)], new Set(["a1"]))
		expect(tiles.filter((t) => t.kind === "tile")).toHaveLength(ZOOM_COLLAPSED + 1)
		expect(tiles.at(-1)?.kind === "more" && tiles.at(-1)).toMatchObject({ open: true })
	})

	it("gives a card in two topics two different ids", () => {
		const item = highlightItem(highlight("h1", "a1"))
		const group = (id: string) => ({
			kind: "topic" as const,
			id: `topic:${id}`,
			group: { topic: { id, name: id }, highlights: 1, notes: 0, items: [item] },
		})
		const ids = zoomTiles([group("t1"), group("t2")], new Set()).map((t) => t.id)
		expect(new Set(ids).size).toBe(ids.length)
	})
})

describe("parseZoomed", () => {
	it("is zoomed out only when stored so", () => {
		expect(parseZoomed("true")).toBe(true)
		expect(parseZoomed("false")).toBe(false)
		expect(parseZoomed(null)).toBe(false)
		expect(parseZoomed("{not json")).toBe(false)
	})
})
