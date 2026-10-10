import type { assets } from "@klipstack/db"
import { getStorage } from "@klipstack/storage"
import type { CallToolResult } from "@modelcontextprotocol/server"
import sharp from "sharp"
import { getDocumentForReader } from "../documents.server"
import { numberImages } from "../images"
import { findAssets } from "../images.server"
import { describeImage, fitForModel } from "./images"
import { appOrigin, toolError } from "./results.server"

/** Images view_images sends as they are; anything else is converted to WebP. */
const MODEL_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])
/** Stored copies are small WebPs; this only guards against surprises. */
const MAX_STORED_BYTES = 15 * 1024 * 1024

type AssetRow = Pick<typeof assets.$inferSelect, "id" | "storageKey" | "contentType" | "bytes">

/** view_images: the requested images as image content, each after a line saying which it is. */
export async function viewImages(
	userId: string,
	articleId: string,
	numbers: number[],
): Promise<CallToolResult> {
	const found = await getDocumentForReader(userId, articleId)
	if (!found) return toolError("No article with that id in the library.")
	const numbered = found.version
		? numberImages(found.version.html, appOrigin)
		: { html: "", images: [], notStored: 0 }
	const { images } = numbered
	if (images.length === 0)
		return toolError(
			found.version?.imagesDone === false
				? "Klipstack is still storing this article's images; try again shortly."
				: "This article has no images stored in Klipstack.",
		)

	const byId = new Map((await findAssets(userId, numbered)).map((r) => [r.id, r]))
	const content: CallToolResult["content"] = []
	let shown = 0
	for (const n of numbers) {
		const image = images[n - 1]
		if (!image) {
			content.push({
				type: "text",
				text: `Image ${n}: no such image; the article has ${images.length} (see get_article).`,
			})
			continue
		}
		const asset = byId.get(image.assetId)
		const prepared = asset ? await forModel(asset) : null
		if (!prepared) {
			content.push({ type: "text", text: `${describeImage(image)}: no longer available.` })
			continue
		}
		content.push(
			{
				type: "text",
				text: `${describeImage(image)} (${prepared.width}×${prepared.height})`,
			},
			{
				type: "image",
				data: prepared.data.toString("base64"),
				mimeType: prepared.mimeType,
				annotations: { audience: ["assistant", "user"] },
			},
		)
		shown++
	}
	return shown > 0 ? { content } : { isError: true, content }
}

/** The stored copy, first frame only, no larger than the model would take it. Null if unreadable. */
async function forModel(asset: AssetRow) {
	if (asset.bytes > MAX_STORED_BYTES) return null
	const object = await getStorage().get(asset.storageKey)
	if (!object) return null
	try {
		const bytes = Buffer.concat(await object.body.toArray())
		const meta = await sharp(bytes).metadata()
		const width = meta.width
		const height = meta.pageHeight ?? meta.height
		const size = fitForModel(width, height)
		const animated = (meta.pages ?? 1) > 1
		const type = object.contentType ?? asset.contentType
		if (!size && !animated && MODEL_TYPES.has(type))
			return { data: bytes, mimeType: type, width, height }
		// sharp reads only the first frame unless told otherwise.
		const { data, info } = await sharp(bytes)
			.resize(size ? { ...size, fit: "inside" } : undefined)
			.webp({ quality: 82 })
			.toBuffer({ resolveWithObject: true })
		return { data, mimeType: "image/webp", width: info.width, height: info.height }
	} catch {
		return null
	}
}
