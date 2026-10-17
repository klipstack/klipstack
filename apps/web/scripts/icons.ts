/**
 * Generate every icon, the public SVGs, the share cards, the logo (mark and name), the
 * BrandMark components and the mobile app's icons and logo image from the brand sources:
 * brand/klipstack-mark.svg (the canonical mark, used at 48px and up),
 * brand/klipstack-mark-small.svg (redrawn for 32px and below) and Newsreader in brand/fonts. App
 * icons put the white mark on the navy tile. See brand/README.md.
 *
 *   pnpm --filter @klipstack/web icons
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { resources, supportedLanguages } from "@klipstack/i18n"
// The package's main entry is CommonJS without named exports; its ES module build has them.
import { type Font, parse } from "opentype.js/dist/opentype.mjs"
import sharp from "sharp"

const root = resolve(import.meta.dirname, "../../..")
const webIcons = resolve(root, "apps/web/public/icons")
const extIcons = resolve(root, "apps/extension/public/icon")
const mobileAssets = resolve(root, "apps/mobile/assets")

const full = readFileSync(resolve(root, "brand/klipstack-mark.svg"), "utf8")
const small = readFileSync(resolve(root, "brand/klipstack-mark-small.svg"), "utf8")

/** The navy tile: the brand accent, lighter at the top left. Fill with `url(#tile)`. */
const gradient =
	`<defs><linearGradient id="tile" x1="0" y1="0" x2="0.6" y2="1">` +
	`<stop offset="0" stop-color="#3a64a0"/><stop offset="1" stop-color="#132548"/>` +
	`</linearGradient></defs>`

function write(path: string, data: Buffer | string) {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, data)
	console.log("wrote", path.replace(`${root}/`, ""), `${Buffer.byteLength(data)} B`)
}

/** The mark that reads best at this size. */
const markFor = (size: number) => (size <= 32 ? small : full)

/** A mark nested in a square box at (at, at), its currentColor replaced by `color`. */
function place(mark: string, color: string, at: number, size: number): string {
	return mark
		.replace("<svg ", `<svg x="${at}" y="${at}" width="${size}" height="${size}" `)
		.replaceAll("currentColor", color)
}

type Tile = { pad: number; radius: number }

/**
 * The white mark on the navy tile. `pad` is the margin as a fraction of the tile; `radius`
 * rounds the corners (0 for full-bleed icons the OS masks itself).
 */
function tile(mark: string, size: number, { pad, radius }: Tile): string {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${gradient}` +
		`<rect width="${size}" height="${size}" rx="${size * radius}" fill="url(#tile)"/>` +
		`${place(mark, "#ffffff", size * pad, size * (1 - pad * 2))}</svg>\n`
	)
}

/** The mark alone on a transparent square, for surfaces that recolor icons themselves. */
function bare(mark: string, size: number, color: string, pad: number): string {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
		`${place(mark, color, size * pad, size * (1 - pad * 2))}</svg>\n`
	)
}

const png = (svg: string) => sharp(Buffer.from(svg)).png().toBuffer()

const favicon = { pad: 0.06, radius: 0.22 } // 32px and below: the small mark, as big as it fits
const app = { pad: 0.16, radius: 0.22 } // launcher/desktop icons shown as-is
const masked = { pad: 0.2, radius: 0 } // the OS applies its own mask; keep the mark in the safe zone
const touch = { pad: 0.17, radius: 0 } // iOS rounds the corners itself
const icon = (size: number) => png(tile(markFor(size), size, size <= 32 ? favicon : app))

/** ICO container holding PNG images (every modern browser accepts PNG entries). */
function ico(entries: Array<{ size: number; data: Buffer }>): Buffer {
	const header = Buffer.alloc(6)
	header.writeUInt16LE(0, 0)
	header.writeUInt16LE(1, 2)
	header.writeUInt16LE(entries.length, 4)
	const dir = Buffer.alloc(16 * entries.length)
	let offset = 6 + dir.length
	entries.forEach(({ size, data }, i) => {
		const e = i * 16
		dir.writeUInt8(size >= 256 ? 0 : size, e)
		dir.writeUInt8(size >= 256 ? 0 : size, e + 1)
		dir.writeUInt16LE(1, e + 4)
		dir.writeUInt16LE(32, e + 6)
		dir.writeUInt32LE(data.byteLength, e + 8)
		dir.writeUInt32LE(offset, e + 12)
		offset += data.byteLength
	})
	return Buffer.concat([header, dir, ...entries.map((p) => p.data)])
}

// Browser tab icon; the tile reads on light and dark chrome alike.
write(`${webIcons}/favicon.svg`, tile(small, 32, favicon))
// The reader's saved-link marker masks with this one (about 13px wide).
write(`${webIcons}/mark.svg`, small)
write(`${webIcons}/favicon-16.png`, await icon(16))
write(`${webIcons}/favicon-32.png`, await icon(32))
write(
	resolve(root, "apps/web/public/favicon.ico"),
	ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await icon(size) })))),
)
for (const size of [192, 512]) {
	write(`${webIcons}/icon-${size}.png`, await png(tile(full, size, app)))
	write(`${webIcons}/icon-maskable-${size}.png`, await png(tile(full, size, masked)))
}
write(`${webIcons}/apple-touch-icon.png`, await png(tile(full, 180, touch)))
write(`${webIcons}/logo-256.png`, await png(tile(full, 256, app)))
// Email header: shown at 32px (3x for sharp screens), so the small mark.
write(`${webIcons}/icon-email.png`, await png(tile(small, 96, favicon)))
// Android themed icons (manifest purpose "monochrome"): the OS tints the alpha mask.
write(`${webIcons}/icon-monochrome-512.png`, await png(bare(full, 512, "#000000", 0.2)))
// Firefox theme_icons: dark ink on light toolbars, light ink on dark toolbars.
for (const size of [16, 32]) {
	write(`${extIcons}/mono-dark-${size}.png`, await png(bare(small, size, "#141210", 0)))
	write(`${extIcons}/mono-light-${size}.png`, await png(bare(small, size, "#f4f1ec", 0)))
}
for (const size of [16, 32, 48, 96, 128]) write(`${extIcons}/${size}.png`, await icon(size))

// The mobile app. iOS rounds the corners itself and wants no transparency in the icon.
const opaque = (svg: string) =>
	sharp(Buffer.from(svg)).flatten({ background: "#132548" }).png().toBuffer()
write(`${mobileAssets}/icon.png`, await opaque(tile(full, 1024, touch)))
// Android adaptive icons are layers the OS masks and moves: the navy tile behind, the mark in front
// inside the safe zone (the middle 66 of 108 units), and a black mark the OS tints for themed icons.
write(
	`${mobileAssets}/android-icon-background.png`,
	await png(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${gradient}<rect width="512" height="512" fill="url(#tile)"/></svg>`,
	),
)
write(`${mobileAssets}/android-icon-foreground.png`, await png(bare(full, 512, "#ffffff", 0.25)))
write(`${mobileAssets}/android-icon-monochrome.png`, await png(bare(full, 432, "#000000", 0.25)))

/** Newsreader fixed at one weight and optical size (SIL Open Font License, brand/fonts). */
function newsreader(
	instance: "400-opsz40" | "500-opsz40" | "600-opsz18" | "600-opsz72" | "italic-400-opsz24",
): Font {
	const file = readFileSync(resolve(root, `brand/fonts/newsreader-${instance}.ttf`))
	return parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))
}
const headlineFont = newsreader("400-opsz40")

/**
 * `text` as outlines, the pen starting at x = 0 on the baseline y = 0, rounded to `places`
 * decimals. The path data is written here: opentype.js 2.0's toPathData can run two numbers
 * together ("340 0" as "3400").
 */
function outline(font: Font, text: string, size: number, places = 1) {
	const path = font.getPath(text, 0, 0, size, { letterSpacing: -0.01 })
	return { d: outlineOf(path, places).d, box: path.getBoundingBox() }
}

/** Path data for an opentype.js path, rounded to `places` decimals (see `outline`). */
function outlineOf(path: ReturnType<Font["getPath"]>, places = 1) {
	const k = 10 ** places
	const n = (v: number) => String(Math.round(v * k) / k + 0)
	const d = path.commands
		.map((c) => {
			if (c.type === "Z") return "Z"
			const points = c.type === "C" ? [c.x1, c.y1, c.x2, c.y2] : c.type === "Q" ? [c.x1, c.y1] : []
			return c.type + [...points, c.x, c.y].map((v) => n(v as number)).join(" ")
		})
		.join("")
	return { d }
}

const viewBox = (svg: string) => (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "").split(" ").map(Number)

/**
 * A logo: the mark, then the name in Newsreader, in the mark's units. The name is `size` of the
 * mark's height, `gap` of it away, centered on the mark as a line of text would be.
 */
function makeLogo(mark: string, nameFont: Font, { size: ratio = 0.62, gap = 0.28 } = {}) {
	const [, , w = 0, h = 0] = viewBox(mark)
	const size = h * ratio
	const x = w + h * gap
	const em = size / nameFont.unitsPerEm
	const content = (nameFont.ascender - nameFont.descender) * em
	const baseline = h / 2 - size / 2 + (size - content) / 2 + nameFont.ascender * em
	// The small mark's space is 24 units tall: the name needs more decimals there to keep its shape.
	const places = h < 100 ? 2 : 1
	const name = outline(nameFont, "Klipstack", size, places)
	return {
		mark,
		markWidth: w,
		width: Math.ceil((x + name.box.x2) * 10 ** (places - 1)) / 10 ** (places - 1),
		height: h,
		name: name.d,
		at: `translate(${x.toFixed(places)} ${baseline.toFixed(places)})`,
	}
}
type Logo = ReturnType<typeof makeLogo>
const logo = makeLogo(full, newsreader("500-opsz40"))
// The sidebar's logo, on its grid: shown 24px tall, the mark fills the 24px icon slot and the name
// (18px, the size of the old text) starts 8px after it, on the nav labels' column. Beside the
// heavier small mark the name is heavier too, cut for small text (optical size 18).
const logoSmall = makeLogo(small, newsreader("600-opsz18"), { size: 0.75, gap: 1 / 3 })

function logoSvg(l: Logo, markColor: string, nameColor: string, box = ""): string {
	const mark = l.mark
		.replace(/\s(xmlns|role|aria-label)="[^"]*"/g, "")
		.replace("<svg ", `<svg width="${l.markWidth}" height="${l.height}" `)
		.replaceAll("currentColor", markColor)
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" ${box}viewBox="0 0 ${l.width} ${l.height}" role="img" aria-label="Klipstack">\n` +
		`${mark}<path fill="${nameColor}" transform="${l.at}" d="${l.name}"/>\n</svg>\n`
	)
}
// The logos for documents and other sites, in the current text color like the marks.
write(resolve(root, "brand/klipstack-logo.svg"), logoSvg(logo, "currentColor", "currentColor"))
write(
	resolve(root, "brand/klipstack-logo-small.svg"),
	logoSvg(logoSmall, "currentColor", "currentColor"),
)
// The mobile app has no SVG renderer: it shows the logo as an image tinted with the text color.
// Black on transparent, 3x its 64pt height on the sign-in screen.
const mobileLogoH = 192
const mobileLogoW = Math.round((logo.width * mobileLogoH) / logo.height)
write(
	`${mobileAssets}/logo.png`,
	await png(logoSvg(logo, "#000000", "#000000", `width="${mobileLogoW}" height="${mobileLogoH}" `)),
)
// The launch screen's logo, 3x its 220pt width, in the app's text color for each mode (it can't be
// tinted: iOS draws it before the app runs).
const splashW = 660
const splashH = Math.round((logo.height * splashW) / logo.width)
for (const [name, ink] of [
	["splash-logo", "#1a1d23"],
	["splash-logo-dark", "#e9e8e3"],
] as const)
	write(
		`${mobileAssets}/${name}.png`,
		await png(logoSvg(logo, ink, ink, `width="${splashW}" height="${splashH}" `)),
	)

// The link-preview images and the X header: the landing headline, its promise marked as on the
// landing page, beside the sample essay with a highlighted sentence and a reader's note on a
// post-it. The site's paper, ink, accent, highlight and note colors (app.css, light theme).
const paper = {
	bg: "#fbfaf7",
	ink: "#1a1d23",
	muted: "#5f646b",
	border: "#e0ded8",
	card: "#ffffff",
	accent: "#243f6c",
	hl: "#ffe657",
	hlEdge: "#ecd453",
	note: "#fdf1bf",
	noteInk: "#2f2416",
}
const display = newsreader("600-opsz72")
const noteFont = newsreader("italic-400-opsz24")

/** Words in lines no wider than `max` at `size`. */
function wrap(font: Font, text: string, size: number, max: number, spacing = -0.01): string[] {
	const width = (line: string) =>
		font.getPath(line, 0, 0, size, { letterSpacing: spacing }).getBoundingBox().x2
	const lines: string[] = []
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const last = lines.at(-1)
		if (last !== undefined && width(`${last} ${word}`) <= max)
			lines[lines.length - 1] = `${last} ${word}`
		else lines.push(word)
	}
	return lines
}

/** A marker stroke behind a line of text, as `.marker` on the landing page draws it. */
function stroke(x1: number, x2: number, baseline: number, size: number): string {
	const [left, right] = [x1 - 0.12 * size, x2 + 0.18 * size]
	const [top, height] = [baseline - 0.62 * size, 0.8 * size]
	return (
		`<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${(right - left).toFixed(1)}" ` +
		`height="${height.toFixed(1)}" rx="${(0.4 * size).toFixed(1)}" ry="${(0.3 * size).toFixed(1)}" fill="url(#marker)"/>`
	)
}

/** Lines of text at (x, y), `y` the first baseline; `marked` lines get a marker stroke behind. */
function textBlock(
	font: Font,
	lines: { text: string; marked?: boolean }[],
	{
		x,
		y,
		size,
		leading,
		fill,
		spacing = -0.01,
	}: {
		x: number
		y: number
		size: number
		leading: number
		fill: string
		spacing?: number
	},
): string {
	let strokes = ""
	let paths = ""
	lines.forEach(({ text, marked }, i) => {
		const baseline = y + i * leading
		const path = font.getPath(text, 0, 0, size, { letterSpacing: spacing })
		const { d } = outlineOf(path)
		if (marked) {
			const box = path.getBoundingBox()
			strokes += stroke(x + box.x1, x + box.x2, baseline, size)
		}
		paths += `<path fill="${fill}" transform="translate(${x.toFixed(1)} ${baseline.toFixed(1)})" d="${d}"/>`
	})
	return strokes + paths
}

/**
 * `plain` then `marked`, wrapped as one paragraph (no letter spacing, so a line's advance places
 * the highlight): each line, and where on it the marked words start, if they do.
 */
function passage(font: Font, plain: string, marked: string, size: number, max: number) {
	const words = [
		...plain
			.split(/\s+/)
			.filter(Boolean)
			.map((word) => ({ word, marked: false })),
		...marked
			.split(/\s+/)
			.filter(Boolean)
			.map((word) => ({ word, marked: true })),
	]
	const lines: { text: string; markFrom: number | null }[] = []
	for (const { word, marked: m } of words) {
		const last = lines.at(-1)
		const joined = last ? `${last.text} ${word}` : word
		if (last && font.getPath(joined, 0, 0, size).getBoundingBox().x2 <= max) {
			if (m && last.markFrom === null) last.markFrom = font.getAdvanceWidth(`${last.text} `, size)
			last.text = joined
		} else lines.push({ text: word, markFrom: m ? 0 : null })
	}
	return lines
}

/** A `passage` at (x, y), `y` the first baseline, its marked words on a marker stroke. */
function passageBlock(
	font: Font,
	lines: ReturnType<typeof passage>,
	{
		x,
		y,
		size,
		leading,
		fill,
	}: { x: number; y: number; size: number; leading: number; fill: string },
): string {
	let strokes = ""
	let paths = ""
	lines.forEach(({ text, markFrom }, i) => {
		const baseline = y + i * leading
		const path = font.getPath(text, 0, 0, size)
		if (markFrom !== null)
			strokes += stroke(x + markFrom, x + path.getBoundingBox().x2, baseline, size)
		paths += `<path fill="${fill}" transform="translate(${x.toFixed(1)} ${baseline.toFixed(1)})" d="${outlineOf(path).d}"/>`
	})
	return strokes + paths
}

/** The headline in lines: the plain part, then the marked promise on lines of its own. */
function headlineLines(headline: string, size: number, max: number) {
	const [, plain = headline, marked = ""] = /^(.*?)\s*<mark>(.*)<\/mark>/.exec(headline) ?? []
	const spacing = -0.02
	return [
		...wrap(display, plain.replace(/<[^>]+>/g, ""), size, max, spacing).map((text) => ({ text })),
		...wrap(display, marked, size, max, spacing).map((text) => ({ text, marked: true })),
	]
}

/** The logo in the accent color, `height` tall, its top left at (x, y). */
function placedLogo(x: number, y: number, height: number): string {
	const width = (logo.width * height) / logo.height
	return logoSvg(
		logo,
		paper.accent,
		paper.accent,
		`x="${x}" y="${y}" width="${width.toFixed(1)}" height="${height}" `,
	).replace(/\s(xmlns|role|aria-label)="[^"]*"/g, "")
}

type Copy = {
	headline: string
	site: string
	title: string
	before: string
	marked: string
	note: string
}

/**
 * The sample essay on a card, its last sentence highlighted, and the reader's note on a post-it
 * over the card's lower left corner: `width` wide, its top left at (x, y). Without `before`, only
 * the highlighted sentence, for a shorter card. Without `overhang`, the note stays within the
 * card's height, below the text. Without `site`, no site line. Returns where it ends.
 */
function essayCard(
	copy: Copy,
	x: number,
	y: number,
	width: number,
	{ before = true, overhang = true, site = true } = {},
) {
	const pad = 32
	const inner = width - pad * 2
	const meta = !site
		? ""
		: textBlock(headlineFont, [{ text: copy.site }], {
				x: x + pad,
				y: y + pad + 16,
				size: 19,
				leading: 0,
				fill: paper.muted,
			})
	const titleLines = wrap(headlineFont, copy.title, 30, inner)
	const titleTop = y + pad + (site ? 60 : 24)
	const title = textBlock(
		headlineFont,
		titleLines.map((text) => ({ text })),
		{
			x: x + pad,
			y: titleTop,
			size: 30,
			leading: 36,
			fill: paper.ink,
		},
	)
	const bodySize = 23
	const bodyLeading = 36
	// One passage: the highlight starts where the sentence before it ends, as in the reader.
	const body = passage(headlineFont, before ? copy.before : "", copy.marked, bodySize, inner)
	const bodyTop = titleTop + (titleLines.length - 1) * 36 + 50
	const text = passageBlock(headlineFont, body, {
		x: x + pad,
		y: bodyTop,
		size: bodySize,
		leading: bodyLeading,
		fill: paper.ink,
	})
	const noteSize = 27
	const noteLines = wrap(noteFont, copy.note, noteSize, 250, 0)
	const noteW = 300
	const noteH = 44 + noteLines.length * 34
	const lastBaseline = bodyTop + (body.length - 1) * bodyLeading
	// Overhanging, the note covers the card's lower left corner; within it, it sits below the text.
	const height = overhang ? lastBaseline + pad + 70 - y : lastBaseline + noteH + 40 - y
	const card =
		`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="${paper.card}" ` +
		`stroke="${paper.border}" stroke-width="1.5" filter="url(#lift)"/>`
	// The note: italic, on its paper, leaning a little, as the post-its in the app do.
	const noteX = x - 46
	const noteY = overhang ? y + height - 64 : lastBaseline + 22
	const note =
		`<g transform="rotate(-2.5 ${noteX + noteW / 2} ${noteY + noteH / 2})">` +
		`<rect x="${noteX}" y="${noteY}" width="${noteW}" height="${noteH}" fill="${paper.note}" filter="url(#lift)"/>` +
		`<rect x="${noteX + noteW / 2 - 42}" y="${noteY - 12}" width="84" height="24" fill="#ffffff" fill-opacity="0.6" transform="rotate(-3 ${noteX + noteW / 2} ${noteY})"/>${textBlock(
			noteFont,
			noteLines.map((text) => ({ text })),
			{
				x: noteX + 24,
				y: noteY + 46,
				size: noteSize,
				leading: 34,
				fill: paper.noteInk,
				spacing: 0,
			},
		)}</g>`
	return { svg: card + meta + title + text + note, bottom: Math.max(y + height, noteY + noteH) }
}

const defs =
	`<defs><linearGradient id="marker" x1="0" y1="0" x2="1" y2="0">` +
	`<stop offset="0" stop-color="${paper.hlEdge}"/><stop offset="0.06" stop-color="${paper.hl}"/>` +
	`<stop offset="0.94" stop-color="${paper.hl}"/><stop offset="1" stop-color="${paper.hlEdge}"/></linearGradient>` +
	`<filter id="lift" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#1a1d23" flood-opacity="0.12"/></filter></defs>`

/** The link-preview image, 1200×630: the promise large on the left, the essay and note on the right. */
function shareCard(copy: Copy): string {
	const [w, h] = [1200, 630]
	const size = 70
	const leading = 78
	const lines = headlineLines(copy.headline, size, 650)
	const blockH = (lines.length - 1) * leading
	const first = (h - blockH) / 2 - 18
	const card = essayCard(copy, 746, 92, 398)
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${defs}<rect width="${w}" height="${h}" fill="${paper.bg}"/>${textBlock(
		display,
		lines,
		{ x: 76, y: first, size, leading, fill: paper.ink, spacing: -0.02 },
	)}${placedLogo(78, h - 92, 40)}${card.svg}</svg>\n`
}

/**
 * The X profile header, 1500×500. X crops it to a narrower band on some screens and the profile
 * photo covers its lower left corner, so everything sits between x = 430 and 1440 and at least
 * 60px from the top and bottom (brand/README.md).
 */
function xHeader(copy: Copy): string {
	const [w, h] = [1500, 500]
	const size = 60
	const leading = 66
	const lines = headlineLines(copy.headline, size, 560)
	const blockH = (lines.length - 1) * leading
	const first = (h - blockH) / 2 - 22
	const card = essayCard(copy, 1090, 60, 340, { before: false, overhang: false, site: false })
	const logoTop = first + blockH + 44
	// The headline's cap height above its first baseline, the logo below its last.
	const extent = { top: first - size * 0.75, bottom: Math.max(card.bottom, logoTop + 34) }
	if (extent.top < 60 || extent.bottom > h - 60)
		throw new Error(`The X header reaches y = ${extent.top}..${extent.bottom}: keep 60px clear`)
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${defs}<rect width="${w}" height="${h}" fill="${paper.bg}"/>${textBlock(
		display,
		lines,
		{ x: 450, y: first, size, leading, fill: paper.ink, spacing: -0.02 },
	)}${placedLogo(452, logoTop, 34)}${card.svg}</svg>\n`
}

const copyFor = (lang: (typeof supportedLanguages)[number]): Copy => {
	const home = resources[lang].common.home
	return {
		headline: home.headline,
		site: home.demo.site,
		title: home.demo.title,
		before: home.demo.sentences.s7,
		marked: home.demo.sentences.s8,
		note: home.shareCard.note,
	}
}
for (const lang of supportedLanguages)
	write(`${webIcons}/share-${lang}.png`, await png(shareCard(copyFor(lang))))
// The X profile is in English.
write(resolve(root, "brand/social/x-header.png"), await png(xHeader(copyFor("en"))))

/**
 * The Chrome Web Store's large promo tile, 1400×560, laid out as the share card: the promise on the
 * left, the essay and note on the right.
 */
function marqueeTile(copy: Copy): string {
	const [w, h] = [1400, 560]
	const size = 72
	const leading = 80
	const lines = headlineLines(copy.headline, size, 720)
	const blockH = (lines.length - 1) * leading
	const first = (h - blockH) / 2 - 20
	const card = essayCard(copy, 930, 64, 400)
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${defs}<rect width="${w}" height="${h}" fill="${paper.bg}"/>${textBlock(
		display,
		lines,
		{ x: 90, y: first, size, leading, fill: paper.ink, spacing: -0.02 },
	)}${placedLogo(92, first + blockH + 50, 40)}${card.svg}</svg>\n`
}

/** The Chrome Web Store's small promo tile, 440×280: the white logo on the navy tile, and a line. */
function smallTile(line: string): string {
	const [w, h] = [440, 280]
	const logoH = 64
	const logoW = (logo.width * logoH) / logo.height
	const size = 25
	const box = display.getPath(line, 0, 0, size, { letterSpacing: -0.01 }).getBoundingBox()
	const placed = logoSvg(
		logo,
		"#ffffff",
		"#ffffff",
		`x="${((w - logoW) / 2).toFixed(1)}" y="88" width="${logoW.toFixed(1)}" height="${logoH}" `,
	).replace(/\s(xmlns|role|aria-label)="[^"]*"/g, "")
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${gradient}<rect width="${w}" height="${h}" fill="url(#tile)"/>${placed}${textBlock(
		display,
		[{ text: line }],
		{ x: (w - (box.x2 - box.x1)) / 2 - box.x1, y: 206, size, leading: 0, fill: "#dbe4f2" },
	)}</svg>\n`
}

// The Chrome Web Store (brand/chrome-web-store/README.md): its icon, the app icon drawn 96px inside
// a transparent 128px square as the store asks, and the promo tiles, in English (the store shows
// them in every language) and without transparency, which it refuses.
const store = resolve(root, "brand/chrome-web-store")
write(
	`${store}/icon-128.png`,
	await png(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${tile(full, 96, app).replace("<svg ", '<svg x="16" y="16" width="96" height="96" ')}</svg>`,
	),
)
const flat = (svg: string) => sharp(Buffer.from(svg)).flatten().png().toBuffer()
write(
	`${store}/promo-small-440x280.png`,
	await flat(smallTile("Save any page, exactly as you see it")),
)
write(`${store}/promo-marquee-1400x560.png`, await flat(marqueeTile(copyFor("en"))))

// React components: the marks and logos inline, in the current text color. oxfmt formats the file.
const attrs = (tag: string) =>
	[...tag.matchAll(/([a-z-]+)="([^"]*)"/gi)].map(([, k = "", v = ""]) => [k, v] as const)
const jsx = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
const jsxAttrs = (pairs: ReadonlyArray<readonly [string, string]>) =>
	pairs.map(([k, v]) => `${jsx(k)}="${v}"`).join(" ")
const markRoot = (svg: string) =>
	attrs(/<svg[^>]*>/.exec(svg)?.[0] ?? "").filter(
		([k]) => !["xmlns", "role", "aria-label", "viewBox"].includes(k),
	)
const markPaths = (svg: string) =>
	[...svg.matchAll(/<path[^>]*\/>/g)].map(([tag]) => `<path ${jsxAttrs(attrs(tag))} />`).join("")

function markComponent(name: string, doc: string, svg: string): string {
	return `
/** ${doc} */
export function ${name}(props: SVGProps<SVGSVGElement>) {
	return <svg viewBox="${viewBox(svg).join(" ")}" ${jsxAttrs(markRoot(svg))} aria-hidden="true" focusable="false" {...props}>${markPaths(svg)}</svg>
}
`
}
function logoComponent(name: string, doc: string, l: Logo): string {
	return `
/** ${doc} \`markClassName\` colors the mark apart from the name. */
export function ${name}({ markClassName, ...props }: SVGProps<SVGSVGElement> & { markClassName?: string }) {
	return <svg viewBox="0 0 ${l.width} ${l.height}" role="img" aria-label="Klipstack" {...props}>
		<g className={markClassName} ${jsxAttrs(markRoot(l.mark))}>${markPaths(l.mark)}</g>
		<path fill="currentColor" transform="${l.at}" d="${l.name}" />
	</svg>
}
`
}
const components = resolve(root, "apps/web/app/components/brand-mark.tsx")
write(
	components,
	`// Generated by scripts/icons.ts from the marks in brand/ and the Newsreader name. Do not edit by hand.
import type { SVGProps } from "react"
${markComponent("BrandMark", "The Klipstack mark, for 48px and up: strokes in the current text color.", full)}${markComponent("BrandMarkSmall", "The mark redrawn for 32px and below: heavier, simpler.", small)}${logoComponent("BrandLogo", "The logo: the mark and the name, for 48px and up.", logo)}${logoComponent("BrandLogoSmall", "The logo with the small mark, for 32px and below (the sidebar).", logoSmall)}`,
)
execFileSync("pnpm", ["exec", "oxfmt", components], { cwd: root, stdio: "inherit" })
