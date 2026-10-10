import { JSDOM } from "jsdom"

/**
 * An article's stored images, numbered. The worker stores copies (`/assets/<id>`) and leaves images
 * it could not store pointing at the original site. Stored images get numbers in reading order;
 * MCP shows them as "Image N", and the HTTP API lists them by the same numbers.
 */

export interface ArticleImage {
	/** 1-based, in reading order, counting stored images only. */
	number: number
	assetId: string
	alt: string
	caption: string
}

export interface NumberedImages {
	/**
	 * The article HTML with stored images linked by absolute URL (and labeled "Image N" unless
	 * `label` is false).
	 */
	html: string
	images: ArticleImage[]
	/** Images that still point at the original site. */
	notStored: number
}

const ASSET_SRC = /^\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const TEXT_MAX = 300

function clean(value: string | null | undefined): string {
	const text = (value ?? "").replace(/\s+/g, " ").trim()
	return text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 1)}…` : text
}

/**
 * `label: false` keeps each image's own alt text, for Markdown meant for people (the API); by
 * default the alt text becomes "Image N: alt", which assistants refer to.
 */
export function numberImages(
	html: string,
	origin: string,
	{ label = true }: { label?: boolean } = {},
): NumberedImages {
	if (!html.includes("<img")) return { html, images: [], notStored: 0 }
	const body = new JSDOM(`<!doctype html><body>${html}</body>`).window.document.body
	const images: ArticleImage[] = []
	let notStored = 0
	for (const img of Array.from(body.querySelectorAll("img"))) {
		const src = img.getAttribute("src") ?? ""
		const assetId = ASSET_SRC.exec(src)?.[1]
		if (!assetId) {
			if (/^https?:\/\//i.test(img.getAttribute("data-original-src") ?? src)) notStored++
			continue
		}
		const number = images.length + 1
		const alt = clean(img.getAttribute("alt"))
		const caption = clean(img.closest("figure")?.querySelector("figcaption")?.textContent)
		// Some sites repeat the caption in the alt text (or the other way around): list it once.
		if (caption && alt.includes(caption)) images.push({ number, assetId, alt, caption: "" })
		else if (alt && caption.includes(alt)) images.push({ number, assetId, alt: "", caption })
		else images.push({ number, assetId, alt, caption })
		img.setAttribute("src", new URL(src, origin).href)
		img.removeAttribute("data-original-src")
		if (label) img.setAttribute("alt", alt ? `Image ${number}: ${alt}` : `Image ${number}`)
	}
	return { html: images.length ? body.innerHTML : html, images, notStored }
}
