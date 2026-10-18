import { parse as parseNote } from "@klipstack/api-contract/note-links"
import sharp from "sharp"
import {
	CARD_HEIGHT,
	CARD_WIDTH,
	canDraw,
	drawable,
	loadFonts,
	mark,
	outline,
	svg,
	width,
	wrap,
} from "./edition-card.server"
import { creditAuthor, safeHost, siteLabel } from "./site-label"

/**
 * A shared highlight's picture for link previews (`og:image`): 1200×630, drawn as the page shows
 * it. The quote on a clipping, unmarked, under an opening quote mark; the note on a yellow post-it
 * stuck on it, whatever the highlight's color (a meaning of its owner's); under the quote, the
 * article it came from; the brand. Drawn from the snapshot when asked for, never stored, with the
 * editions' fonts and helpers (`edition-card.server.ts`).
 */
export interface HighlightCard {
	exact: string
	/** Null leaves the post-it off and the clipping takes the room. */
	note: string | null
	/** Where the article was published. */
	site: string
	/** Who wrote it, shown before the site; null when unknown. */
	author?: string | null
	title: string
}

/** The post-it's paper and ink: the classic yellow (app.css, in sRGB). */
const NOTE = { paper: "#FDF1BF", ink: "#2F2416" }
const INK = { from: "#26344F", to: "#0D1322", text: "#FFFFFF" }
const PAPER = { ground: "#FBF8F1", text: "#1A2132", muted: "#5B6476", accent: "#B8432F" }

/** The credit's letter spacing, in ems: the measure of a line adds it to every character. */
const CREDIT_SPACING = 0.12

/**
 * The credit under the quote, "AUTHOR · SITE", on one line of the clipping's width. A long author is
 * shortened first: where it was published stays whole.
 */
export function creditLine(card: HighlightCard, shape: HighlightShape): string {
	const { small, text } = loadFonts()
	const withNote = card.note !== null && drawable(text, plainNote(card.note)) !== ""
	const { size, max } =
		shape === "tall"
			? { size: 22, max: 920 - 72 * 2 }
			: { size: 15, max: (withNote ? 780 : 1040) - 56 * 2 }
	const measure = (s: string) => width(small, s, size) + CREDIT_SPACING * size * [...s].length
	const fit = (s: string, room: number) => {
		for (let m = room; m > 0; m -= size) {
			const line = wrap(small, s, size, m, 1)[0] ?? ""
			if (measure(line) <= room) return line
		}
		return ""
	}
	const site = drawable(small, card.site).toUpperCase()
	const author = card.author ? drawable(small, card.author).toUpperCase() : ""
	if (!author) return fit(site, max)
	const full = `${author} · ${site}`
	if (measure(full) <= max) return full
	const short = fit(author, max - measure(` · ${site}`))
	return short && short !== "…" ? `${short} · ${site}` : fit(site, max)
}

/** The quote's lines at the largest size that shows it whole, or cut at the smallest. */
function quoteLines(text: string, max: number, height: number, sizes = [46, 40, 34, 30]) {
	const { text: font } = loadFonts()
	const shown = drawable(font, text)
	for (const size of sizes) {
		const leading = Math.round(size * 1.32)
		const fit = Math.floor(height / leading)
		const lines = wrap(font, shown, size, max, fit)
		if (!lines.at(-1)?.endsWith("…") || size === sizes.at(-1)) return { lines, size, leading }
	}
	throw new Error("unreachable")
}

/** The note as text: a link to an article reads as its title. */
function plainNote(note: string): string {
	return parseNote(note)
		.map((line) => line.map((s) => (s.kind === "text" ? s.text : s.title)).join(""))
		.join(" ")
}

export function highlightCardSvg(card: HighlightCard): string {
	const { text, name, small } = loadFonts()
	const withNote = card.note !== null && drawable(text, plainNote(card.note)) !== ""
	const parts: string[] = []

	// The clipping: wider without a note.
	const W = withNote ? 780 : 1040
	const H = 470
	const X = withNote ? 70 : 80
	const Y = 48
	const pad = 56
	const clip: string[] = [
		`<rect width="${W}" height="${H}" rx="4" fill="${PAPER.ground}" filter="url(#shadow)"/>`,
		// The tape at its top corner.
		`<rect x="${pad - 20}" y="-14" width="120" height="30" fill="#FFFFFF" opacity="0.6" transform="rotate(-4 ${pad + 40} 0)"/>`,
	]
	const quoteWidth = W - pad * 2 - (withNote ? 70 : 0)
	// The opening quote mark says what the text is: the marker is the app's, not the share's.
	clip.push(outline(text, "\u201C", pad - 4, 112, 96, PAPER.muted))
	const { lines, size, leading } = quoteLines(card.exact, quoteWidth, H - 214)
	lines.forEach((line, i) => {
		const baseline = 136 + i * leading
		clip.push(outline(text, line, pad, baseline, size, PAPER.text))
	})
	// Where it came from, at the foot.
	const site = creditLine(card, "wide")
	clip.push(`<rect x="${pad}" y="${H - 104}" width="${W - pad * 2}" height="1.5" fill="#E2DCCF"/>`)
	clip.push(outline(small, site, pad, H - 70, 15, PAPER.accent, CREDIT_SPACING))
	const title = wrap(text, drawable(text, card.title), 24, W - pad * 2, 1)[0] ?? ""
	clip.push(outline(text, title, pad, H - 36, 24, PAPER.muted))
	parts.push(
		`<g transform="translate(${X} ${Y}) rotate(-1.2 ${W / 2} ${H / 2})">${clip.join("")}</g>`,
	)

	if (withNote && card.note) {
		const paper = NOTE
		const NW = 360
		const NH = 330
		const noteLines = wrap(text, drawable(text, plainNote(card.note)), 27, NW - 64, 7)
		const note = [
			`<rect width="${NW}" height="${NH}" fill="${paper.paper}" filter="url(#shadow)"/>`,
			`<rect x="${NW / 2 - 55}" y="-14" width="110" height="30" fill="#FFFFFF" opacity="0.55"/>`,
			...noteLines.map((line, i) => outline(text, line, 32, 64 + i * 36, 27, paper.ink)),
		]
		parts.push(
			`<g transform="translate(790 230) rotate(2.5 ${NW / 2} ${NH / 2})">${note.join("")}</g>`,
		)
	}

	parts.push(mark(80, 556, 36, INK.text))
	parts.push(outline(name, "Klipstack.com", 126, 584, 26, INK.text))

	return svg(
		`<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#g)"/>`,
		parts.join(""),
		`<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${INK.from}"/><stop offset="1" stop-color="${INK.to}"/></linearGradient><filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.45"/></filter>`,
	)
}

/** The picture's shapes: wide for link previews and chats, tall for a phone's full screen. */
export const HIGHLIGHT_SHAPES = ["wide", "tall"] as const
export type HighlightShape = (typeof HIGHLIGHT_SHAPES)[number]

export const TALL_WIDTH = 1080
export const TALL_HEIGHT = 1920

const DEFS = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${INK.from}"/><stop offset="1" stop-color="${INK.to}"/></linearGradient><filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.45"/></filter>`

/** Where the brand's mark starts on the tall picture: everything else stays above it. */
const TALL_BRAND_TOP = 1770
/** The lowest the clipping and its note may reach, a margin above the brand. */
export const TALL_CONTENT_BOTTOM = TALL_BRAND_TOP - 50

/**
 * The tall picture's geometry. The note is measured first; the quote gets the room left, so a long
 * quote, a title on two lines and a long note still end above the brand.
 */
export function tallLayout(card: HighlightCard) {
	const { text } = loadFonts()
	const withNote = card.note !== null && drawable(text, plainNote(card.note)) !== ""
	const W = 920
	const X = 80
	const pad = 72
	const titleLines = wrap(text, drawable(text, card.title), 34, W - pad * 2, 2)
	// The note hangs below the clipping, over its bottom margin only: the title stays readable.
	const NW = 600
	const noteLines =
		withNote && card.note ? wrap(text, drawable(text, plainNote(card.note)), 40, NW - 96, 7) : []
	const NH = Math.max(260, 110 + noteLines.length * 54)
	const overlap = 36
	const noteBelow = noteLines.length ? NH - overlap : 0
	const top = 120
	// The clipping is as tall as its words: the quote mark, the quote, then where it came from.
	const below = 90 + 100 + titleLines.length * 46 + 30
	const room = TALL_CONTENT_BOTTOM - top - noteBelow - 258 - below
	const { lines, size, leading } = quoteLines(
		card.exact,
		W - pad * 2,
		Math.min(1000, room + 60),
		[68, 60, 52, 46, 40],
	)
	// The quote starts a line below its quote mark, whatever size it was drawn at.
	const quoteTop = 190 + size
	const footTop = quoteTop + (lines.length - 1) * leading + 90
	const H = footTop + 100 + titleLines.length * 46 + 30
	const total = H + noteBelow
	// The whole in the middle of the room above the brand.
	const Y = Math.max(top, Math.round((TALL_CONTENT_BOTTOM - 20 - total) / 2 + top / 2))
	return {
		W,
		X,
		pad,
		lines,
		size,
		leading,
		titleLines,
		quoteTop,
		footTop,
		H,
		NW,
		noteLines,
		NH,
		overlap,
		Y,
		bottom: Y + total,
	}
}

/**
 * The same highlight for a phone held upright (9:16, as Stories and Status show it): the clipping
 * across the screen, the quote larger and longer before it is cut, the note stuck below it, the
 * brand at the foot.
 */
export function highlightCardTallSvg(card: HighlightCard): string {
	const { text, name, small } = loadFonts()
	const parts: string[] = []

	const {
		W,
		X,
		pad,
		lines,
		size,
		leading,
		titleLines,
		quoteTop,
		footTop,
		H,
		NW,
		noteLines,
		NH,
		overlap,
		Y,
	} = tallLayout(card)
	const clip: string[] = [
		`<rect width="${W}" height="${H}" rx="4" fill="${PAPER.ground}" filter="url(#shadow)"/>`,
		`<rect x="${pad - 20}" y="-18" width="160" height="40" fill="#FFFFFF" opacity="0.6" transform="rotate(-4 ${pad + 60} 0)"/>`,
		outline(text, "\u201C", pad - 6, 170, 140, PAPER.muted),
	]
	lines.forEach((line, i) => {
		clip.push(outline(text, line, pad, quoteTop + i * leading, size, PAPER.text))
	})
	const site = creditLine(card, "tall")
	clip.push(`<rect x="${pad}" y="${footTop}" width="${W - pad * 2}" height="2" fill="#E2DCCF"/>`)
	clip.push(outline(small, site, pad, footTop + 62, 22, PAPER.accent, CREDIT_SPACING))
	titleLines.forEach((line, i) => {
		clip.push(outline(text, line, pad, footTop + 112 + i * 46, 34, PAPER.muted))
	})
	parts.push(
		`<g transform="translate(${X} ${Y}) rotate(-1.2 ${W / 2} ${H / 2})">${clip.join("")}</g>`,
	)

	if (noteLines.length) {
		const note = [
			`<rect width="${NW}" height="${NH}" fill="${NOTE.paper}" filter="url(#shadow)"/>`,
			`<rect x="${NW / 2 - 80}" y="-18" width="160" height="40" fill="#FFFFFF" opacity="0.55"/>`,
			...noteLines.map((line, i) => outline(text, line, 48, 96 + i * 54, 40, NOTE.ink)),
		]
		parts.push(
			`<g transform="translate(${TALL_WIDTH - NW - 70} ${Y + H - overlap}) rotate(2.5 ${NW / 2} ${NH / 2})">${note.join("")}</g>`,
		)
	}

	// The brand, centered at the foot.
	const brand = "Klipstack.com"
	const brandWidth = 54 + 18 + width(name, brand, 40)
	const bx = Math.round((TALL_WIDTH - brandWidth) / 2)
	parts.push(mark(bx, TALL_BRAND_TOP, 54, INK.text))
	parts.push(outline(name, brand, bx + 72, 1812, 40, INK.text))

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${TALL_WIDTH}" height="${TALL_HEIGHT}" viewBox="0 0 ${TALL_WIDTH} ${TALL_HEIGHT}"><defs>${DEFS}</defs><rect width="${TALL_WIDTH}" height="${TALL_HEIGHT}" fill="url(#g)"/>${parts.join("")}</svg>`
}

export function highlightCardPng(
	card: HighlightCard,
	shape: HighlightShape = "wide",
): Promise<Buffer> {
	const drawn = shape === "tall" ? highlightCardTallSvg(card) : highlightCardSvg(card)
	return sharp(Buffer.from(drawn)).png({ compressionLevel: 9 }).toBuffer()
}

/** Whether the card can show this highlight; one it cannot gets the Klipstack card. */
export function canDrawHighlight(exact: string): boolean {
	return canDraw(exact)
}

/** What the card says, from the article as the snapshot has it. */
export function highlightCardFor(snapshot: {
	exact: string
	note: string | null
	article: { title: string | null; url: string; siteName: string | null; author?: string | null }
}): HighlightCard {
	const host = safeHost(snapshot.article.url)
	return {
		exact: snapshot.exact,
		note: snapshot.note,
		site: siteLabel(snapshot.article.siteName, host),
		author: creditAuthor(snapshot.article),
		title: snapshot.article.title ?? host,
	}
}

/**
 * Pictures drawn lately, by key, each drawn once while it stays among the latest `max`: a link
 * shared in a busy channel is asked for often.
 */
function drawnCache(max: number) {
	const drawn = new Map<string, Promise<Buffer>>()
	return (key: string, card: () => HighlightCard, shape: HighlightShape = "wide") => {
		const hit = drawn.get(key)
		if (hit) {
			drawn.delete(key)
			drawn.set(key, hit)
			return hit
		}
		const png = highlightCardPng(card(), shape)
		png.catch(() => drawn.delete(key))
		drawn.set(key, png)
		if (drawn.size > max) drawn.delete(drawn.keys().next().value!)
		return png
	}
}

/** Shared pages' previews, by address and version. */
export const cachedHighlightCard = drawnCache(50)

/**
 * Readers' own pictures, by reader, shape and content: apart from the previews, so one reader
 * trying shapes never pushes a busy link's preview out.
 */
export const cachedHighlightImage = drawnCache(30)
