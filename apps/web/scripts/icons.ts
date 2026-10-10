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
function newsreader(instance: "400-opsz40" | "500-opsz40" | "600-opsz18"): Font {
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
	const k = 10 ** places
	const n = (v: number) => String(Math.round(v * k) / k + 0)
	const d = path.commands
		.map((c) => {
			if (c.type === "Z") return "Z"
			const points = c.type === "C" ? [c.x1, c.y1, c.x2, c.y2] : c.type === "Q" ? [c.x1, c.y1] : []
			return c.type + [...points, c.x, c.y].map((v) => n(v as number)).join(" ")
		})
		.join("")
	return { d, box: path.getBoundingBox() }
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

/** The link-preview image: the white logo and the landing headline on the navy tile, 1200×630. */
function shareCard(headline: string): string {
	const [w, h] = [1200, 630]
	const logoH = 150
	const logoW = (logo.width * logoH) / logo.height
	const words = outline(headlineFont, headline, 46)
	const wordsX = (w - words.box.x2 - words.box.x1) / 2
	const top = 196
	const placed = logoSvg(
		logo,
		"#ffffff",
		"#ffffff",
		`x="${(w - logoW) / 2}" y="${top}" width="${logoW}" height="${logoH}" `,
	)
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${gradient}` +
		`<rect width="${w}" height="${h}" fill="url(#tile)"/>` +
		`${placed.replace(/\s(xmlns|role|aria-label)="[^"]*"/g, "")}` +
		`<path fill="#ffffff" fill-opacity="0.85" transform="translate(${wordsX.toFixed(1)} ${top + logoH + 96})" d="${words.d}"/></svg>\n`
	)
}
for (const lang of supportedLanguages)
	write(
		`${webIcons}/share-${lang}.png`,
		await png(shareCard(resources[lang].common.home.headline.replace(/<[^>]+>/g, ""))),
	)

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
