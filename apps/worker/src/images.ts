import { createHash } from "node:crypto"
import { and, assets, db, eq } from "@klipstack/db"
import { fetchBytes as fetchImageBytes } from "@klipstack/extract"
import { assetKey, getStorage } from "@klipstack/storage"
import sharp from "sharp"

export interface StoredAsset {
	id: string
	width: number | null
	height: number | null
}

export interface ProcessedImage {
	data: Buffer
	width: number
	height: number
}

const MAX_SOURCE_BYTES = 10 * 1024 * 1024

/**
 * The worker's memory limit (1200 MB in docs/self-hosting/compose.yml) is shared with extraction.
 * A decoded image takes 4 bytes a pixel: at most 40 million pixels (160 MB, a 1200 × 33,000
 * screenshot still fits), two decodes at a time across jobs, and no libvips cache of past ones.
 */
const MAX_INPUT_PIXELS = 40_000_000
const DECODES = 2
sharp.cache(false)
let decoding = 0
const waiting: Array<() => void> = []

async function withDecodeSlot<T>(work: () => Promise<T>): Promise<T> {
	if (decoding >= DECODES) await new Promise<void>((resolve) => waiting.push(resolve))
	decoding++
	try {
		return await work()
	} finally {
		decoding--
		waiting.shift()?.()
	}
}
/** Skip tiny images (icons, trackers) below this many pixels on the long side. */
const MIN_DIMENSION = 48

/**
 * Download an image, normalize it to WebP (max `maxWidth`), store it content-addressed for the
 * user and return the asset row. Returns null for images that are too small or unusable.
 */
export async function ingestImage(
	{ userId, url, maxWidth }: { userId: string; url: string; maxWidth: number },
	fetchBytes: typeof fetchImageBytes = fetchImageBytes,
): Promise<StoredAsset | null> {
	const fetched = await fetchBytes(url, { maxBytes: MAX_SOURCE_BYTES })
	const processed = await processImage(fetched.bytes, {
		maxWidth,
		contentType: fetched.contentType,
	})
	if (!processed) return null
	return storeProcessedImage({ userId, url, ...processed })
}

/** Normalize any supported image to WebP, downscaled to `maxWidth`. Null when too small. */
export function processImage(
	source: Buffer,
	options: { maxWidth: number; contentType?: string | null },
): Promise<ProcessedImage | null> {
	return withDecodeSlot(() => convert(source, options))
}

async function convert(
	source: Buffer,
	{ maxWidth, contentType }: { maxWidth: number; contentType?: string | null },
): Promise<ProcessedImage | null> {
	const isAnimated =
		/image\/gif|image\/webp|image\/apng/i.test(contentType ?? "") || looksLikeGif(source)
	let pipeline = sharp(source, { animated: isAnimated, limitInputPixels: MAX_INPUT_PIXELS })
	const meta = await pipeline.metadata()
	const w = meta.width ?? 0
	const h = meta.pageHeight ?? meta.height ?? 0
	if (Math.max(w, h) < MIN_DIMENSION) return null

	pipeline = pipeline.rotate().resize({ width: maxWidth, withoutEnlargement: true })
	const { data, info } = await pipeline
		.webp({ quality: 82, effort: 4 })
		.toBuffer({ resolveWithObject: true })
	const height =
		isAnimated && meta.pageHeight
			? Math.round((meta.pageHeight * info.width) / (meta.width ?? info.width))
			: info.height
	return { data, width: info.width, height }
}

async function storeProcessedImage({
	userId,
	url,
	data,
	width,
	height,
}: { userId: string; url: string } & ProcessedImage): Promise<StoredAsset | null> {
	const sha256 = createHash("sha256").update(data).digest("hex")
	const existing = await db.query.assets.findFirst({
		where: and(eq(assets.userId, userId), eq(assets.sha256, sha256)),
	})
	if (existing) {
		// The purge counts an asset's age from its last use: this one is in use again.
		await db.update(assets).set({ createdAt: new Date() }).where(eq(assets.id, existing.id))
		return { id: existing.id, width: existing.width, height: existing.height }
	}

	const key = assetKey(userId, sha256, "webp")
	await getStorage().put(key, data, "image/webp")
	const [row] = await db
		.insert(assets)
		.values({
			userId,
			sha256,
			storageKey: key,
			contentType: "image/webp",
			width,
			height,
			bytes: data.byteLength,
			originalUrl: url,
		})
		.onConflictDoNothing()
		.returning({ id: assets.id, width: assets.width, height: assets.height })
	if (row) return row
	const again = await db.query.assets.findFirst({
		where: and(eq(assets.userId, userId), eq(assets.sha256, sha256)),
	})
	return again ? { id: again.id, width: again.width, height: again.height } : null
}

function looksLikeGif(buf: Buffer): boolean {
	return buf.length > 6 && buf.subarray(0, 6).toString("latin1").startsWith("GIF8")
}
