import sharp from "sharp"
import {
	drawable,
	loadFonts,
	mark,
	outline,
	svg,
	width,
	wrap,
	CARD_HEIGHT,
	CARD_WIDTH,
} from "./edition-card.server"

/**
 * A news entry's picture for link previews (`og:image`), 1200×630: over the ink gradient, the
 * brand and "Klipstack news"; a clipping on a stack of them, its title highlighted and its
 * description below; the date and the address. Drawn as `edition-card.server.ts` draws, from the
 * entry's text, never stored. Bump `NEWS_CARD_DESIGN` when it changes: its address changes, so
 * platforms that cached the old one ask again.
 */
export const NEWS_CARD_DESIGN = 1

export interface NewsCard {
	/** "Klipstack news", in the entry's language. */
	kicker: string
	title: string
	description: string
	/** "October 22, 2026". */
	date: string
	/** "klipstack.com/news". */
	address: string
}

const INK = { from: "#26344F", to: "#0D1322", text: "#FFFFFF", tint: "#AAB7D2", rule: "#3B4A68" }
const PAPER = {
	text: "#1A2132",
	muted: "#5B6476",
	accent: "#B8432F",
	highlight: "#F4E04D",
	/** The clippings, from the back. */
	cards: ["#E6DECD", "#EFE9DC", "#FBF8F1"],
}

const LEFT = 80
const CLIP_X = 80
const CLIP_W = 1000
const PAD = 56
const TITLE = { size: 56, line: 66 }
const LINE = { size: 27, line: 38 }

export function newsCardSvg(card: NewsCard): string {
	const { text, name, small } = loadFonts()
	const parts: string[] = []

	// The brand, a rule, and what this is.
	parts.push(mark(LEFT, 58, 40, INK.text))
	parts.push(outline(name, "Klipstack", LEFT + 50, 90, 30, INK.text))
	const brandEnd = LEFT + 50 + width(name, "Klipstack", 30)
	parts.push(`<rect x="${brandEnd + 28}" y="62" width="2" height="36" fill="${INK.rule}"/>`)
	parts.push(
		outline(
			small,
			drawable(small, card.kicker).toUpperCase(),
			brandEnd + 58,
			88,
			19,
			"#E7A08F",
			0.16,
		),
	)

	// The clipping: as tall as its text, under the brand, the date below it.
	const max = CLIP_W - PAD * 2 - 10
	const title = wrap(text, drawable(text, card.title), TITLE.size, max, 2)
	const lines = wrap(
		text,
		drawable(text, card.description),
		LINE.size,
		max,
		title.length > 1 ? 2 : 3,
	)
	const height = PAD + title.length * TITLE.line + 18 + lines.length * LINE.line + PAD - 14
	const top = Math.round(150 + (390 - height) / 2)
	const clip: string[] = []
	clip.push(
		`<rect width="${CLIP_W}" height="${height}" rx="6" fill="${PAPER.cards[2]}" filter="url(#shadow)"/>`,
	)
	clip.push(
		`<rect x="30" y="${PAD - 8}" width="5" height="${height - PAD * 2 + 16}" fill="${PAPER.accent}"/>`,
	)
	title.forEach((line, i) => {
		const baseline = PAD + 46 + i * TITLE.line
		// A stroke of highlighter behind each line, as a reader would mark it.
		const w = width(text, line, TITLE.size)
		clip.push(
			`<rect x="${PAD + 4}" y="${baseline - 34}" width="${Math.round(w + 16)}" height="44" rx="4" fill="${PAPER.highlight}" opacity="0.8" transform="rotate(-0.6 ${PAD} ${baseline})"/>`,
		)
		clip.push(outline(text, line, PAD + 12, baseline, TITLE.size, PAPER.text))
	})
	const below = PAD + 46 + (title.length - 1) * TITLE.line + 18 + LINE.line
	lines.forEach((line, i) =>
		clip.push(outline(text, line, PAD + 12, below + i * LINE.line, LINE.size, PAPER.muted)),
	)
	// Two clippings behind it, their edges showing below, as in the sidebar.
	for (const [i, turn] of [
		[2, 1.6],
		[1, -1.1],
	] as const)
		parts.push(
			`<g transform="translate(${CLIP_X + i * 14} ${top + i * 12}) rotate(${turn} ${CLIP_W / 2} ${height / 2})"><rect width="${CLIP_W - i * 28}" height="${height}" rx="6" fill="${PAPER.cards[2 - i]}" filter="url(#shadow)"/></g>`,
		)
	parts.push(
		`<g transform="translate(${CLIP_X} ${top}) rotate(-0.8 ${CLIP_W / 2} ${height / 2})">${clip.join("")}</g>`,
	)

	// The date and the address.
	parts.push(
		outline(small, drawable(small, card.date).toUpperCase(), LEFT, 585, 19, INK.tint, 0.14),
	)
	const address = drawable(small, card.address)
	parts.push(
		outline(
			small,
			address,
			CARD_WIDTH - LEFT - width(small, address, 19, 0.04),
			585,
			19,
			INK.tint,
			0.04,
		),
	)

	return svg(
		`<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#g)"/>`,
		parts.join(""),
		`<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${INK.from}"/><stop offset="1" stop-color="${INK.to}"/></linearGradient><filter id="shadow" x="-10%" y="-20%" width="120%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.45"/></filter>`,
	)
}

const drawn = new Map<string, Promise<Buffer>>()

/**
 * The card as a PNG, drawn once per `key` (an entry and its language): entries ship with the app,
 * so there are only so many.
 */
export function newsCardPng(key: string, card: () => NewsCard): Promise<Buffer> {
	let png = drawn.get(key)
	if (!png) {
		png = sharp(Buffer.from(newsCardSvg(card())))
			.png({ compressionLevel: 9 })
			.toBuffer()
		png.catch(() => drawn.delete(key))
		drawn.set(key, png)
	}
	return png
}
