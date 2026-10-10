import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { gunzipSync, gzipSync } from "node:zlib"
import {
	extractArticle,
	fetchBytes,
	fetchPage,
	normalizeUrl,
	unsupportedReason,
	type FetchedBytes,
	type FetchedPage,
} from "@klipstack/extract"
import { JSDOM } from "jsdom"
import { z } from "zod"

export const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")
export const blobSchema = z.object({
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
	contentType: z.string().nullable(),
	finalUrl: z.string().url(),
})
export const captureSchema = z.object({
	format: z.literal(1),
	url: z.string().url(),
	capturedAt: z.string().datetime(),
	page: blobSchema.extend({ status: z.number() }),
	title: z.string(),
	words: z.number(),
	images: z.record(z.string(), z.union([blobSchema, z.object({ error: z.string() })])),
})
export type Capture = z.infer<typeof captureSchema>
export type CachedBlob = z.infer<typeof blobSchema>

export async function readJson(path: string): Promise<unknown | null> {
	try {
		return JSON.parse(await readFile(path, "utf8"))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
		throw error
	}
}
export async function writeJson(path: string, value: unknown) {
	await mkdir(dirname(path), { recursive: true })
	const temp = `${path}.${randomUUID()}.tmp`
	await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
	await rename(temp, path)
}
export function parseUrls(text: string): string[] {
	const urls = new Set<string>()
	for (const [i, line] of text.split(/\r?\n/).entries()) {
		const input = line.trim()
		if (!input || input.startsWith("#")) continue
		try {
			const url = normalizeUrl(input)
			const parsed = new URL(url)
			if (
				!/^https?:$/.test(parsed.protocol) ||
				parsed.username ||
				parsed.password ||
				unsupportedReason(url)
			)
				throw new Error("unsupported URL")
			urls.add(url)
		} catch {
			throw new Error(`Invalid article URL at line ${i + 1}`)
		}
	}
	return [...urls]
}
export const capturePath = (root: string, url: string) =>
	join(root, "captures", `${hash(url)}.json`)
export async function loadCapture(root: string, url: string): Promise<Capture | null> {
	const raw = await readJson(capturePath(root, url))
	if (!raw) return null
	const capture = captureSchema.parse(raw)
	if (capture.url !== url) throw new Error(`Capture URL mismatch: ${url}`)
	return capture
}
export async function putBlob(root: string, bytes: Buffer): Promise<string> {
	const sha256 = hash(bytes)
	const path = join(root, "blobs", `${sha256}.gz`)
	await mkdir(dirname(path), { recursive: true })
	const temp = `${path}.${randomUUID()}.tmp`
	await writeFile(temp, gzipSync(bytes), { mode: 0o600 })
	await rename(temp, path)
	return sha256
}
export async function getBlob(root: string, blob: CachedBlob): Promise<Buffer> {
	const bytes = gunzipSync(await readFile(join(root, "blobs", `${blob.sha256}.gz`)))
	if (hash(bytes) !== blob.sha256) throw new Error(`Corrupt cache blob: ${blob.sha256}`)
	return bytes
}
/** Includes the same first 60 content images and card thumbnail as the worker. */
export function imageUrls(html: string, lead: string | null): string[] {
	const dom = new JSDOM(`<body>${html}</body>`)
	const urls = [
		...new Set(
			Array.from(
				dom.window.document.querySelectorAll("img"),
				(img) => img.getAttribute("src") ?? "",
			).filter((url) => /^https?:\/\//i.test(url)),
		),
	].slice(0, 60)
	dom.window.close()
	if (lead && !urls.includes(lead)) urls.push(lead)
	return urls
}

/** One complete manifest is committed last; an interrupted capture is safe to repeat. */
export async function captureUrl(
	root: string,
	url: string,
	deps = { fetchPage, fetchBytes },
): Promise<Capture> {
	const page: FetchedPage = await deps.fetchPage(url, { timeoutMs: 20_000 })
	const article = await extractArticle({ html: page.html, url: page.finalUrl })
	const images: Capture["images"] = {}
	const urls = imageUrls(article.html, article.leadImageUrl)
	// Bounded concurrency, including image-heavy long reads.
	let next = 0
	await Promise.all(
		Array.from({ length: Math.min(3, urls.length) }, async () => {
			while (next < urls.length) {
				const imageUrl = urls[next++]!
				try {
					const image = await deps.fetchBytes(imageUrl, {
						maxBytes: 10 * 1024 * 1024,
						timeoutMs: 12_000,
					})
					images[imageUrl] = {
						sha256: await putBlob(root, image.bytes),
						contentType: image.contentType,
						finalUrl: image.finalUrl,
					}
				} catch (error) {
					images[imageUrl] = { error: error instanceof Error ? error.message : String(error) }
				}
			}
		}),
	)
	const capture: Capture = {
		format: 1,
		url,
		capturedAt: new Date().toISOString(),
		page: {
			sha256: await putBlob(root, Buffer.from(page.html)),
			contentType: page.contentType,
			finalUrl: page.finalUrl,
			status: page.status,
		},
		title: article.title,
		words: article.wordCount,
		images,
	}
	await writeJson(capturePath(root, url), capture)
	return capture
}

/** Known download failures return null. Missing entries are a stale corpus, never a network fallback. */
export async function cachedImage(
	root: string,
	capture: Capture,
	url: string,
): Promise<FetchedBytes | null> {
	const image = capture.images[url]
	if (!image) throw new Error(`Image missing from capture; refresh ${capture.url}`)
	if ("error" in image) return null
	return {
		bytes: await getBlob(root, image),
		contentType: image.contentType,
		finalUrl: image.finalUrl,
	}
}
