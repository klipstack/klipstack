import type { ArticleImage, NumberedImages } from "../images"

/** How assistants see an article's images: sizes for models, tool text, get_article's section. */

/** The long edge and pixel count models downscale to (Claude's limits; others are similar). */
const MAX_EDGE = 1568
const MAX_PIXELS = 1_150_000

/** The size to send an image at so the model does not downscale it again; null when it fits. */
export function fitForModel(
	width: number,
	height: number,
): { width: number; height: number } | null {
	const scale = Math.min(
		1,
		MAX_EDGE / Math.max(width, height),
		Math.sqrt(MAX_PIXELS / (width * height)),
	)
	if (scale >= 1) return null
	return {
		width: Math.max(1, Math.floor(width * scale)),
		height: Math.max(1, Math.floor(height * scale)),
	}
}

/** "Image 2: A chart — caption: Figure 2", as tool text. */
export function describeImage(image: ArticleImage): string {
	return `Image ${image.number}${image.alt ? `: ${image.alt}` : ""}${image.caption ? ` — caption: ${image.caption}` : ""}`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The "## Images" section of get_article; empty when the article has no images. `sizes` holds the
 * stored copies that still exist.
 */
export function imagesMarkdown(
	{ images, notStored }: NumberedImages,
	sizes: ReadonlyMap<string, { width: number | null; height: number | null }>,
	imagesDone: boolean,
): string {
	if (images.length === 0 && notStored === 0 && imagesDone) return ""
	const lines: string[] = []
	if (images.length > 0) {
		lines.push(
			'Klipstack keeps copies of these images, numbered as in the text ("Image 2"). To look at them, call view_images with their numbers; the links only open with a Klipstack login.',
			"",
			...images.map((image) => {
				const size = sizes.get(image.assetId)
				const dims = !size
					? " (no longer available)"
					: size.width && size.height
						? ` (${size.width}×${size.height})`
						: ""
				return `${image.number}. ${image.alt || "No description"}${image.caption ? ` — caption: ${image.caption}` : ""}${dims}`
			}),
		)
	}
	const notes: string[] = []
	if (notStored > 0)
		notes.push(
			images.length > 0
				? `${plural(notStored, "other image links", "other images link")} to the original site; view_images cannot show ${notStored === 1 ? "it" : "them"}.`
				: `${plural(notStored, "image in the text links", "images in the text link")} to the original site; Klipstack has no copy, so view_images cannot show ${notStored === 1 ? "it" : "them"}.`,
		)
	if (!imagesDone)
		notes.push("Klipstack is still storing this article's images; try again shortly.")
	if (notes.length) lines.push(...(lines.length ? [""] : []), notes.join(" "))
	return `## Images\n\n${lines.join("\n")}`
}
