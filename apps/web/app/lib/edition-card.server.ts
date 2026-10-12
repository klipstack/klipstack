import type { EditionCover } from "@klipstack/db"
import type { TFunction } from "i18next"
import { type Font, parse } from "opentype.js/dist/opentype.mjs"
import sharp from "sharp"
import type { EditionSnapshot } from "~/services/editions.server"
/**
 * An edition's picture for link previews (`og:image`): 1200×630, the title and its articles, in
 * the cover the owner chose: a stack of clippings on the ink gradient, or books on a shelf. Drawn
 * from the published snapshot when asked for, never stored. Text is Newsreader turned into outlines
 * (opentype.js), so the server needs no fonts installed and wraps lines by measuring them; sharp
 * makes the PNG. It holds no third-party images.
 */
import font400 from "../../../../brand/fonts/newsreader-400-opsz40.ttf?inline"
import font500 from "../../../../brand/fonts/newsreader-500-opsz40.ttf?inline"
import font600 from "../../../../brand/fonts/newsreader-600-opsz18.ttf?inline"
import { siteOf } from "./edition-view"
import { CARD_DESIGN, formatEditionDate } from "./editions"

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630

/** What the card says, every string already in the edition's language. */
export interface EditionCard {
	cover: EditionCover
	/** Over the title: its date, "October 1, 2026". Null when the date is the title. */
	date: string | null
	title: string
	authorName: string
	/** The first articles, as many as a cover can show: their site, title and reading time. */
	items: { site: string; title: string; minutes: number | null }[]
	/** How many articles the edition has. */
	total: number
	/** "10 articles". */
	count: string
	/** "+ 7 more", for the articles not shown. */
	more: (count: number) => string
}

const INK = {
	from: "#26344F",
	to: "#0D1322",
	tint: "#AAB7D2",
	text: "#FFFFFF",
	muted: "rgba(255,255,255,0.72)",
}
const PAPER = {
	ground: "#F5F0E6",
	text: "#1A2132",
	muted: "#5B6476",
	accent: "#B8432F",
	shelf: "#C9BFA9",
	/** The cards of the stack, from the back. */
	cards: ["#E6DECD", "#ECE5D7", "#F1ECE1", "#FBF8F1"],
	/** The books' colors, in turn; the light ones take dark text. */
	books: [
		"#1B2640",
		"#B8432F",
		"#2F5D50",
		"#C9A227",
		"#3E4A6B",
		"#8A5A44",
		"#5B6F8F",
		"#A23E48",
		"#355C7D",
		"#D8CBB0",
	],
	light: new Set(["#C9A227", "#D8CBB0"]),
}

let fonts: { text: Font; name: Font; small: Font } | null = null
/** Parsed once, on the first card. `?inline` puts each file in the server bundle. */
export function loadFonts() {
	fonts ??= { text: fromDataUrl(font400), name: fromDataUrl(font500), small: fromDataUrl(font600) }
	return fonts
}
function fromDataUrl(url: string): Font {
	const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64")
	return parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

/**
 * The text the font can draw: what it has no glyph for (emoji, other scripts) goes, rather than
 * showing as boxes.
 */
export function drawable(font: Font, text: string): string {
	return [...text]
		.filter((char) => /\s/.test(char) || font.charToGlyphIndex(char) > 0)
		.join("")
		.replace(/\s+/g, " ")
		.trim()
}

/**
 * Whether the card can show this text: it keeps nearly all of its letters. A title in a script the
 * font lacks would come out empty or in pieces; such an edition previews with the Klipstack card.
 */
export function canDraw(text: string): boolean {
	const letters = (s: string) => [...s].filter((char) => !/\s/.test(char)).length
	const total = letters(text)
	return total > 0 && letters(drawable(loadFonts().text, text)) >= total * 0.9
}

const width = (font: Font, text: string, size: number, spacing = 0) =>
	font.getAdvanceWidth(text, size) + spacing * size * Math.max(0, [...text].length - 1)

/**
 * `text` in lines at most `max` wide; past `lines`, the last one ends in "…", after a word and
 * never after punctuation. A word wider than a line is cut too.
 */
export function wrap(font: Font, text: string, size: number, max: number, lines: number): string[] {
	const out: string[] = []
	for (const word of text.split(" ")) {
		const line = out.at(-1)
		if (line !== undefined && width(font, `${line} ${word}`, size) <= max)
			out[out.length - 1] += ` ${word}`
		else out.push(word)
	}
	// A line too wide holds one word longer than a line (an address as a title): the text ends there.
	const wide = out.findIndex((line) => width(font, line, size) > max)
	if (out.length <= lines && wide < 0) return out
	const kept = out.slice(0, wide >= 0 ? Math.min(wide + 1, lines) : lines)
	let last = kept.at(-1)!
	const fits = (s: string) => width(font, `${s}…`, size) <= max
	while (last.includes(" ") && !fits(last)) last = last.replace(/\s+\S+$/, "")
	while (last.length > 1 && !fits(last)) last = last.slice(0, -1)
	kept[kept.length - 1] = `${last.replace(/[\s,.;:!?–—-]+$/, "")}…`
	return kept
}

/** `text` as an SVG path, its baseline starting at (x, y). */
function outline(
	font: Font,
	text: string,
	x: number,
	y: number,
	size: number,
	fill: string,
	spacing = 0,
) {
	const path = font.getPath(text, x, y, size, { letterSpacing: spacing })
	const n = (v: number) => String(Math.round(v * 10) / 10 + 0)
	const d = path.commands
		.map((c) => {
			if (c.type === "Z") return "Z"
			const points = c.type === "C" ? [c.x1, c.y1, c.x2, c.y2] : c.type === "Q" ? [c.x1, c.y1] : []
			return c.type + [...points, c.x, c.y].map(n).join(" ")
		})
		.join("")
	return `<path d="${d}" fill="${fill}"/>`
}

const MARK = `<path d="M106.5 238.5L28.1 268.6Q19.7 271.9 23.4 280.1L207.6 687"/><path d="M175.2 134.9L88.7 163Q80.2 165.8 83.4 174.3C115.1 260.6 145.6 347.3 173.1 435C199.3 518.4 222.8 602.5 244.9 687"/><path d="M271.5 687C267.3 474.7 226.9 284.9 167.4 82C324.9 35 530.7 9.8 689 31.1C708.2 33.7 721.6 43.7 727.8 62C824.2 349 869.4 635.8 865.6 938C865.3 956.7 852.2 969.7 834 974C709.5 1003.6 565 1005.8 438 994C419.6 992.3 404.9 980.4 403 962C387.4 808.5 352.1 656.9 341.3 503C336.8 439.4 374.4 376.3 440 364.5C484.5 356.5 538.4 371.6 566.2 409C607.3 464.5 626.7 636.9 633.5 709C638.7 764.8 653.3 840.6 592 871C559 887.4 508.2 885.7 485.5 853C457.1 812.1 444.6 652.3 436.6 596C432.2 565.4 423.4 530.4 433.3 500C442.5 471.5 484 467.9 502.4 489.1C526.7 516.8 530 569.1 535.7 604C542.1 642.7 543.3 682.6 552 725.9"/>`
/** The Klipstack mark (brand/), `size` tall, its top left at (x, y). */
function mark(x: number, y: number, size: number, color: string) {
	return `<g transform="translate(${x} ${y}) scale(${size / 1022})" fill="none" stroke="${color}" stroke-width="41" stroke-linecap="round" stroke-linejoin="round">${MARK}<path fill="${color}" stroke="none" d="M184.4 685.5L305.5 953C300.9 860.9 293.3 768.9 291.8 676.7L242.4 677Z"/></g>`
}

const svg = (ground: string, body: string, defs = "") =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}"><defs>${defs}</defs>${ground}${body}</svg>`

/** The card as SVG, in its cover. */
export function editionCardSvg(card: EditionCard): string {
	return card.cover === "shelf" ? shelfSvg(card) : stackSvg(card)
}

/** Most cards in the stack. */
const STACK_MAX = 4

/** The articles the stack shows, the first on top, and how many it leaves out. */
export function stackCards(card: EditionCard) {
	const cards = card.items.slice(0, STACK_MAX)
	return { cards, more: Math.max(0, card.total - cards.length) }
}

// The stack's cards: their size, where they start, how far each one behind shows above the one in
// front, and how each one turns and moves aside, from the top one back. The stack is centred
// however many cards it has.
const CARD_W = 470
const CARD_H = 236
const STACK_X = 650
const STACK_MIDDLE = 318
const PEEK = 64
const TURN = [-2, 3, -3.5, 2.5]
const ASIDE = [0, 18, -8, 24]

/**
 * Left: the date, the title (up to four lines), the author and the brand. Right: the first
 * articles as clippings, each behind the one before, its site showing above it; on top, the first
 * one's site and title; and how many more.
 */
function stackSvg(card: EditionCard): string {
	const { text, name, small } = loadFonts()
	const p = PAPER
	const parts: string[] = []

	if (card.date)
		parts.push(
			outline(small, drawable(small, card.date).toUpperCase(), 80, 112, 21, INK.tint, 0.12),
		)
	const titleLines = wrap(text, drawable(text, card.title), 54, 480, 4)
	titleLines.forEach((line, i) => parts.push(outline(text, line, 80, 192 + i * 62, 54, INK.text)))
	const author = wrap(text, drawable(text, card.authorName), 26, 480, 1)[0] ?? ""
	parts.push(outline(text, author, 80, 192 + (titleLines.length - 1) * 62 + 56, 26, INK.muted))
	parts.push(mark(80, 530, 42, INK.text))
	parts.push(outline(name, "Klipstack", 132, 563, 30, INK.text))

	const { cards, more } = stackCards(card)
	const topY = Math.round(STACK_MIDDLE + ((cards.length - 1) * PEEK - CARD_H) / 2)
	// From the back, so each card covers the one behind.
	for (let i = cards.length - 1; i >= 0; i--) {
		const item = cards[i]!
		const top = i === 0
		const x = STACK_X + ASIDE[i]!
		const y = topY - i * PEEK
		const g = [
			`<rect width="${CARD_W}" height="${CARD_H}" rx="6" fill="${p.cards[STACK_MAX - 1 - i]}" filter="url(#shadow)"/>`,
			`<rect x="30" y="${top ? 32 : 24}" width="5" height="${top ? CARD_H - 64 : 24}" fill="${p.accent}"${top ? "" : ` opacity="0.45"`}/>`,
		]
		// A card behind shows only its site; without one, its title, rather than nothing.
		const label = top ? item.site : item.site || item.title
		const site = wrap(small, drawable(small, label).toUpperCase(), 15, CARD_W - 100, 1)[0] ?? ""
		g.push(outline(small, site, 54, top ? 52 : 42, 15, p.accent, 0.12))
		if (top)
			wrap(text, drawable(text, item.title), 30, CARD_W - 100, 3).forEach((line, j) =>
				g.push(outline(text, line, 54, 96 + j * 37, 30, p.text)),
			)
		parts.push(
			`<g transform="translate(${x} ${y}) rotate(${TURN[i]} ${CARD_W / 2} ${CARD_H / 2})">${g.join("")}</g>`,
		)
	}
	if (more > 0) {
		const label = drawable(small, card.more(more))
		const w = width(small, label, 17, 0.06) + 40
		parts.push(
			`<g transform="translate(${STACK_X + CARD_W - w + 20} ${topY + CARD_H - 18}) rotate(-5 ${w / 2} 22)"><rect width="${w}" height="44" rx="22" fill="${p.accent}"/>${outline(small, label, 20, 28, 17, "#FFFFFF", 0.06)}</g>`,
		)
	}

	return svg(
		`<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#g)"/>`,
		parts.join(""),
		`<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${INK.from}"/><stop offset="1" stop-color="${INK.to}"/></linearGradient><filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.45"/></filter>`,
	)
}

// The shelf: its top, its ends, and the books' sizes. A book is wider the longer its article takes
// to read; one without a reading time is as wide as a 12-minute read.
const SHELF_Y = 556
const SHELF_LEFT = 80
export const SHELF_RIGHT = 1120
const BOOK_GAP = 6
const BOOK_MAX = 14
const bookWidth = (minutes: number | null) =>
	Math.round(28 + 8 * Math.sqrt(Math.min(Math.max(minutes ?? 12, 1), 90)))
/** Varied, but the same for the same edition. */
const bookHeight = (i: number) => 236 + ((i * 37) % 76)

/** The books that fit on the shelf, from the left: where each one starts and how wide it is. */
export function shelfBooks(card: EditionCard) {
	const books: { site: string; x: number; width: number; height: number }[] = []
	let x = SHELF_LEFT
	for (const [i, item] of card.items.slice(0, BOOK_MAX).entries()) {
		const w = bookWidth(item.minutes)
		if (x + w > SHELF_RIGHT) break
		books.push({ site: item.site || item.title, x, width: w, height: bookHeight(i) })
		x += w + BOOK_GAP
	}
	return books
}

/**
 * Above: the date and the author, the title (up to two lines). Below: each article a book on the
 * shelf, its site down the spine. Under the shelf, the brand and how many articles.
 */
function shelfSvg(card: EditionCard): string {
	const { text, name, small } = loadFonts()
	const p = PAPER
	const parts: string[] = []

	const over = [card.date, card.authorName].filter(Boolean).join("  ·  ")
	const overLine = wrap(small, drawable(small, over).toUpperCase(), 17, 1040, 1)[0] ?? ""
	parts.push(outline(small, overLine, 80, 92, 17, p.muted, 0.12))
	wrap(text, drawable(text, card.title), 48, 1040, 2).forEach((line, i) =>
		parts.push(outline(text, line, 80, 152 + i * 54, 48, p.text)),
	)

	const books = shelfBooks(card)
	books.forEach((book, i) => {
		const color = p.books[i % p.books.length]!
		const ink = p.light.has(color) ? p.text : "#FFFFFF"
		const top = SHELF_Y - book.height
		parts.push(
			`<rect x="${book.x}" y="${top}" width="${book.width}" height="${book.height}" rx="3" fill="${color}"/>`,
			`<rect x="${book.x}" y="${top + 18}" width="${book.width}" height="2" fill="${ink}" opacity="0.35"/>`,
			`<rect x="${book.x}" y="${SHELF_Y - 30}" width="${book.width}" height="2" fill="${ink}" opacity="0.35"/>`,
		)
		const label =
			wrap(small, drawable(small, book.site).toUpperCase(), 15, book.height - 76, 1)[0] ?? ""
		// Read from the bottom up, centred on the spine: the capitals are about 11 tall.
		parts.push(
			`<g transform="translate(${book.x + book.width / 2 + 5.5} ${SHELF_Y - 44}) rotate(-90)">${outline(small, label, 0, 0, 15, ink, 0.12)}</g>`,
		)
	})
	// A bookend after the last book.
	const last = books.at(-1)
	const end = last ? last.x + last.width + 4 : SHELF_LEFT
	if (end + 44 <= SHELF_RIGHT + 20)
		parts.push(
			`<path d="M${end} ${SHELF_Y}V${SHELF_Y - 128}Q${end} ${SHELF_Y - 134} ${end + 6} ${SHELF_Y - 134}H${end + 10}V${SHELF_Y - 8}H${end + 44}V${SHELF_Y}Z" fill="${p.muted}"/>`,
		)
	parts.push(`<rect x="60" y="${SHELF_Y}" width="1080" height="12" rx="2" fill="${p.shelf}"/>`)

	parts.push(mark(80, 584, 30, p.text))
	parts.push(outline(name, "Klipstack", 116, 607, 22, p.text))
	const count = drawable(text, card.count)
	parts.push(outline(text, count, 1120 - width(text, count, 22), 606, 22, p.muted))

	return svg(
		`<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${p.ground}"/>`,
		parts.join(""),
	)
}

/** The card as a PNG. */
export function editionCardPng(card: EditionCard): Promise<Buffer> {
	return sharp(Buffer.from(editionCardSvg(card)))
		.png({ compressionLevel: 9 })
		.toBuffer()
}

/**
 * What a published edition's card says, in the edition's language. Without a title, the date of
 * the first publish is the title.
 */
export function cardFor(
	snapshot: EditionSnapshot,
	published: { publishedAt: Date; timeZone: string },
	t: TFunction<"editions">,
): EditionCard {
	const date = formatEditionDate(published.publishedAt, snapshot.locale, published.timeZone)
	return {
		cover: snapshot.cover,
		date: snapshot.title === null ? null : date,
		title: snapshot.title ?? date,
		authorName: snapshot.authorName,
		items: snapshot.items.slice(0, BOOK_MAX).map((item) => ({
			site: siteOf(item) ?? "",
			title: item.title,
			minutes: item.readingMinutes,
		})),
		total: snapshot.items.length,
		count: t("public.articles", { count: snapshot.items.length }),
		more: (count) => t("public.cardMore", { count }),
	}
}

/** The example sites of `exampleCard`, and their reading times: made up, not anyone's. */
const EXAMPLE_SITES: [string, number][] = [
	["The Slow Review", 42],
	["Field Notes", 11],
	["Longform Weekly", 9],
	["Margins", 18],
	["The Reading Room", 7],
	["Quiet Machines", 34],
	["Paper & Ink", 15],
	["Northern Letters", 13],
]

/** A cover's example for the editor's picker: an edition that is not the user's, in `lang`. */
export function exampleCard(
	cover: EditionCover,
	lang: string,
	t: TFunction<"editions">,
): EditionCard {
	return {
		cover,
		date: formatEditionDate(new Date("2026-10-01T12:00:00Z"), lang, "UTC"),
		title: t("editor.coverSample.title"),
		authorName: "Ada Reader",
		items: EXAMPLE_SITES.map(([site, minutes], i) => ({
			site,
			title: i === 0 ? t("editor.coverSample.first") : "",
			minutes,
		})),
		total: EXAMPLE_SITES.length,
		count: t("public.articles", { count: EXAMPLE_SITES.length }),
		more: (count) => t("public.cardMore", { count }),
	}
}

/**
 * Which version of an edition's card: it changes with each Update and each new design, so the
 * card's address does too, and a link shared after either is not shown with the old one from a
 * platform's cache.
 */
export function cardVersion(published: { publishedAt: Date | null; republishedAt: Date | null }) {
	const at = (published.republishedAt ?? published.publishedAt)?.getTime() ?? 0
	return `${at.toString(36)}d${CARD_DESIGN}`
}

/** Cards drawn lately, by edition and version: a link shared in a busy channel is asked for often. */
const drawn = new Map<string, Promise<Buffer>>()
const DRAWN_MAX = 50

/** The card for `key` (an edition's id and version), drawn once while it stays among the latest. */
export function cachedCard(key: string, card: () => EditionCard): Promise<Buffer> {
	const hit = drawn.get(key)
	if (hit) {
		drawn.delete(key)
		drawn.set(key, hit)
		return hit
	}
	const png = editionCardPng(card())
	png.catch(() => drawn.delete(key))
	drawn.set(key, png)
	if (drawn.size > DRAWN_MAX) drawn.delete(drawn.keys().next().value!)
	return png
}
