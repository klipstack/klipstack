import type { TFunction } from "i18next"
import { type Font, parse } from "opentype.js/dist/opentype.mjs"
import sharp from "sharp"
import type { EditionSnapshot } from "~/services/editions.server"
/**
 * An edition's picture for link previews (`og:image`): 1200×630, the title and what is inside, on
 * the ink gradient. Drawn from the published snapshot when asked for, never stored. Text is
 * Newsreader turned into outlines (opentype.js), so the server needs no fonts installed and wraps
 * lines by measuring them; sharp makes the PNG. It holds no third-party images.
 */
import font400 from "../../../../brand/fonts/newsreader-400-opsz40.ttf?inline"
import font500 from "../../../../brand/fonts/newsreader-500-opsz40.ttf?inline"
import font600 from "../../../../brand/fonts/newsreader-600-opsz18.ttf?inline"
import { siteOf } from "./edition-view"
import { formatEditionDate } from "./editions"

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630

/** What the card says, every string already in the edition's language. */
export interface EditionCard {
	/** Over the title: its date, "October 1, 2026". Null when the date is the title. */
	date: string | null
	title: string
	authorName: string
	/** The first articles, at most three: their site and title. */
	items: { site: string; title: string }[]
	/** How many articles the edition has. */
	total: number
	/** "+ 7 more", for the articles not shown. */
	more: (count: number) => string
}

const PALETTE = {
	from: "#26344F",
	to: "#0D1322",
	tint: "#AAB7D2",
	text: "#FFFFFF",
	muted: "rgba(255,255,255,0.72)",
	rule: "rgba(255,255,255,0.16)",
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

// The right column's rhythm: the first site's baseline, from a site to its title's first line, from
// line to line, from one item's last line to the next site, and to the "more" line. Its bottom is
// the bottom of the rule between the columns.
const RIGHT_TOP = 128
const SITE_TO_TITLE = 38
const LINE = 34
const ITEM_GAP = 62
const MORE = 48
const RIGHT_BOTTOM = 476

const itemHeight = (lines: number) => SITE_TO_TITLE + (lines - 1) * LINE + ITEM_GAP

/**
 * The articles the right column shows, each title in its lines. Titles get two lines while they all
 * fit; then the later ones get one; then the last article goes, to the "more" line.
 */
export function contents(font: Font, card: EditionCard) {
	const items = card.items.map((item) => ({
		site: item.site,
		long: wrap(font, drawable(font, item.title), 28, 420, 2),
		short: wrap(font, drawable(font, item.title), 28, 420, 1),
	}))
	for (let count = items.length; count > 0; count--) {
		const more = card.total > count
		const kept = items.slice(0, count)
		// How many of them keep two lines, from the first.
		for (let long = count; long >= 0; long--) {
			const shown = kept.map((item, i) => ({
				site: item.site,
				lines: i < long ? item.long : item.short,
			}))
			const bottom =
				RIGHT_TOP +
				shown.reduce((sum, item) => sum + itemHeight(item.lines.length), 0) -
				ITEM_GAP +
				(more ? MORE : 0)
			if (bottom <= RIGHT_BOTTOM) return shown
		}
	}
	return []
}

/**
 * The card as SVG. Left: the date, the title (up to four lines) and the author. Right: the first
 * articles, each its site over its title (up to two lines), and how many more. Below: the brand.
 */
export function editionCardSvg(card: EditionCard): string {
	const { text, name, small } = loadFonts()
	const p = PALETTE
	const parts: string[] = []

	// Left column, 500 wide.
	if (card.date)
		parts.push(outline(small, drawable(small, card.date).toUpperCase(), 80, 112, 21, p.tint, 0.12))
	const titleLines = wrap(text, drawable(text, card.title), 58, 500, 4)
	titleLines.forEach((line, i) => parts.push(outline(text, line, 80, 196 + i * 66, 58, p.text)))
	const author = wrap(text, drawable(text, card.authorName), 26, 500, 1)[0] ?? ""
	parts.push(outline(text, author, 80, 196 + (titleLines.length - 1) * 66 + 58, 26, p.muted))

	// Right column, 420 wide: the articles that fit above the footer.
	parts.push(`<rect x="640" y="76" width="1.5" height="400" fill="${p.rule}"/>`)
	const shown = contents(text, card)
	let y = RIGHT_TOP
	shown.forEach((item, i) => {
		const site = wrap(small, drawable(small, item.site).toUpperCase(), 16, 420, 1)[0] ?? ""
		parts.push(outline(small, site, 700, y, 16, p.tint, 0.1))
		item.lines.forEach((line, j) =>
			parts.push(outline(text, line, 700, y + SITE_TO_TITLE + j * LINE, 28, p.text)),
		)
		y += itemHeight(item.lines.length)
		if (i < shown.length - 1) {
			parts.push(
				`<rect x="700" y="${y - ITEM_GAP / 2 + 4}" width="420" height="1.5" fill="${p.rule}"/>`,
			)
		}
	})
	const more = card.total - shown.length
	if (more > 0) parts.push(outline(text, card.more(more), 700, y - ITEM_GAP + MORE, 24, p.muted))

	// Footer: the mark and the name, the address.
	parts.push(`<rect x="80" y="512" width="1040" height="1.5" fill="${p.rule}"/>`)
	parts.push(mark(80, 540, 44, p.text))
	parts.push(outline(name, "Klipstack", 132, 574, 30, p.text))
	const site = "klipstack.com"
	parts.push(outline(text, site, 1120 - width(text, site, 24), 572, 24, p.muted))

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.from}"/><stop offset="1" stop-color="${p.to}"/></linearGradient></defs><rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#g)"/>${parts.join("")}</svg>`
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
		date: snapshot.title === null ? null : date,
		title: snapshot.title ?? date,
		authorName: snapshot.authorName,
		items: snapshot.items.slice(0, 3).map((item) => ({
			site: siteOf(item) ?? "",
			title: item.title,
		})),
		total: snapshot.items.length,
		more: (count) => t("public.cardMore", { count }),
	}
}

/**
 * Which version of an edition's card: it changes with each Update, so the card's address does too,
 * and a link shared after an Update is not shown with the old one from a platform's cache.
 */
export function cardVersion(published: { publishedAt: Date | null; republishedAt: Date | null }) {
	return ((published.republishedAt ?? published.publishedAt)?.getTime() ?? 0).toString(36)
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
