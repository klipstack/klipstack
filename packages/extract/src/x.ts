import { cleanArticleHtml } from "./clean"
import { ExtractError } from "./errors"
import { type ExtractedArticle, finishArticle } from "./pipeline"
import { parseXStatusUrl, xStatusUrl } from "./url"

/**
 * Posts on X (tweets, threads, long-form articles). X serves an empty JavaScript shell to
 * server fetches, so we read posts through the FxTwitter API instead of the page. The raw JSON
 * is stored like any other capture, so re-extraction never refetches.
 */

export const FXTWITTER_API = "https://api.fxtwitter.com"
export const X_RAW_CONTENT_TYPE = "application/json"

const EXTRACTOR = { name: "x", version: "1" }
const MAX_BYTES = 5 * 1024 * 1024

interface XFacet {
	type: string
	indices: [number, number]
	original?: string
	replacement?: string
	display?: string
}

interface XRawText {
	text: string
	display_text_range?: [number, number]
	facets?: XFacet[]
}

interface XAuthor {
	id: string
	name?: string
	screen_name: string
}

interface XMedia {
	type: string
	url: string
	thumbnail_url?: string
	width?: number
	height?: number
	altText?: string
}

interface XArticleMedia {
	media_id?: string
	media_info?: {
		original_img_url?: string
		original_img_width?: number
		original_img_height?: number
	}
}

interface DraftBlock {
	type: string
	text: string
	inlineStyleRanges?: Array<{ offset: number; length: number; style: string }>
	entityRanges?: Array<{ offset: number; length: number; key: number | string }>
}

interface DraftEntity {
	type: string
	data?: { url?: string; mediaItems?: Array<{ mediaId?: string }> }
}

interface XArticle {
	title?: string
	preview_text?: string
	cover_media?: XArticleMedia
	content?: {
		blocks?: DraftBlock[]
		entityMap?: Array<{ key: string; value: DraftEntity }> | Record<string, DraftEntity>
	}
	media_entities?: XArticleMedia[]
}

interface XStatus {
	id: string
	url?: string
	text?: string
	raw_text?: XRawText
	author: XAuthor
	created_timestamp?: number
	lang?: string | null
	media?: { all?: XMedia[]; photos?: XMedia[]; videos?: XMedia[] } | null
	quote?: XStatus | null
	article?: XArticle | null
}

interface XThreadResponse {
	code?: number
	status?: XStatus | null
	thread?: XStatus[] | null
}

/**
 * Fetch a post and, when it opens a thread, the author's follow-up posts. Returns the raw JSON.
 * The API answers `thread: [post]` for a lone post and `thread: null` when its thread lookup
 * failed, which happens on roughly one call in four; those calls are retried. `threadComplete`
 * is false when every attempt failed and the JSON holds the opening post only.
 */
export async function fetchXPost(
	url: string,
	{
		apiBase = FXTWITTER_API,
		timeoutMs = 15_000,
		attempts = 4,
		retryDelayMs = 750,
	}: { apiBase?: string; timeoutMs?: number; attempts?: number; retryDelayMs?: number } = {},
): Promise<{ json: string; status: number; threadComplete: boolean }> {
	const ref = parseXStatusUrl(url)
	if (!ref) throw new ExtractError("invalid_url", `Not a post on X: ${url}`)
	let last: { json: string; status: number } | null = null
	for (let attempt = 1; attempt <= attempts; attempt++) {
		if (attempt > 1)
			await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt - 1)))
		const { json, status, body } = await requestThread(apiBase, ref.id, timeoutMs)
		if (body.thread) return { json, status, threadComplete: true }
		last = { json, status }
	}
	return { ...(last as { json: string; status: number }), threadComplete: false }
}

/** The body as text, read up to MAX_BYTES: a larger one is refused before it is all in memory. */
async function boundedText(res: Response): Promise<string> {
	const reader = res.body?.getReader()
	if (!reader) return ""
	const chunks: Uint8Array[] = []
	let total = 0
	for (;;) {
		let next: ReadableStreamReadResult<Uint8Array>
		try {
			next = await reader.read()
		} catch (cause) {
			throw new ExtractError("fetch_failed", "The X API connection broke", { cause })
		}
		if (next.done) break
		total += next.value.byteLength
		if (total > MAX_BYTES) {
			await reader.cancel()
			throw new ExtractError("too_large", "X API response too large")
		}
		chunks.push(next.value)
	}
	return Buffer.concat(chunks).toString("utf8")
}

async function requestThread(apiBase: string, id: string, timeoutMs: number) {
	let res: Response
	try {
		res = await fetch(`${apiBase}/2/thread/${id}`, {
			signal: AbortSignal.timeout(timeoutMs),
			headers: { accept: "application/json", "user-agent": "Klipstack (read-it-later)" },
		})
	} catch (cause) {
		if ((cause as Error)?.name === "TimeoutError")
			throw new ExtractError("timeout", `Timed out after ${timeoutMs}ms`, { cause })
		throw new ExtractError("fetch_failed", "Could not reach the X API", { cause })
	}
	const json = await boundedText(res)
	let body: XThreadResponse
	try {
		body = JSON.parse(json) as XThreadResponse
	} catch (cause) {
		if (!res.ok) throw new ExtractError("http_error", `HTTP ${res.status}`, { status: res.status })
		throw new ExtractError("fetch_failed", "X API returned invalid JSON", { cause })
	}
	// The API mirrors the post's state in `code` (404 deleted, 401 protected).
	const code = res.ok ? (body.code ?? res.status) : res.status
	if (code !== 200) throw new ExtractError("http_error", `X API ${code}`, { status: code })
	if (!body.status) throw new ExtractError("no_content", "X API returned no post")
	return { json, status: res.status, body }
}

/** Turn a stored FxTwitter response into an article: a long-form article, a thread or one post. */
export function extractXPost(json: string, url: string): ExtractedArticle {
	let body: XThreadResponse
	try {
		body = JSON.parse(json) as XThreadResponse
	} catch {
		throw new ExtractError("no_content", "Stored X capture is not valid JSON")
	}
	const status = body.status
	if (!status) throw new ExtractError("no_content", "Stored X capture has no post")
	const ref = parseXStatusUrl(status.url ?? url)
	const canonicalUrl = ref ? xStatusUrl({ ...ref, handle: status.author.screen_name }) : url

	const article = status.article
	let html: string
	let title: string
	let description: string | null
	let leadImageUrl: string | null
	const isArticle = Boolean(article?.content?.blocks?.length)
	if (article && isArticle) {
		const cover = article.cover_media?.media_info?.original_img_url ?? null
		html = (cover ? figure(cover) : "") + renderArticle(article)
		title = article.title?.trim() || titleFromText(status, article.preview_text)
		description = article.preview_text?.trim() || null
		leadImageUrl = cover
	} else {
		const posts = threadPosts(status, body.thread)
		html = posts.map((post) => renderPost(post, true)).join("")
		title = titleFromText(status)
		description = summary(status.text ?? "", 300) || null
		leadImageUrl = posts.flatMap(mediaOf).map((m) => m.thumbnail_url ?? m.url)[0] ?? null
	}

	const lang = status.lang && /^[a-z]{2,3}$/.test(status.lang) ? status.lang : null
	return finishArticle({
		html: cleanArticleHtml(html, { url: canonicalUrl, title: null, trimEdges: false }),
		fields: {
			title,
			author: status.author.name?.trim() || `@${status.author.screen_name}`,
			// "X" alone reads like a close button.
			siteName: "X.com",
			description,
			language: lang === "zxx" || lang === "und" ? null : lang,
			publishedAt: status.created_timestamp ? new Date(status.created_timestamp * 1000) : null,
			leadImageUrl,
			canonicalUrl,
		},
		extractor: EXTRACTOR,
		type: isArticle ? "article" : "post",
		minWords: 1,
	})
}

/** The opening post plus the author's consecutive replies to themselves. */
function threadPosts(status: XStatus, thread: XStatus[] | null | undefined): XStatus[] {
	if (!thread?.length) return [status]
	const posts: XStatus[] = []
	for (const post of thread) {
		if (post.author.id !== status.author.id) break
		posts.push(post)
	}
	return posts.length ? posts : [status]
}

function renderPost(post: XStatus, withQuote: boolean): string {
	const raw = post.raw_text ?? { text: post.text ?? "" }
	const [start, end] = raw.display_text_range ?? [0, raw.text.length]
	const marks = (raw.facets ?? []).map((f) => facetMark(raw.text, f)).filter(isMark)
	let html = paragraphs(raw.text, start, end)
		.map(([s, e]) => `<p>${renderSpan(raw.text, s, e, marks).trim()}</p>`)
		.join("")
	const postUrl = post.url ?? `https://x.com/${post.author.screen_name}/status/${post.id}`
	for (const media of mediaOf(post)) {
		if (media.type === "photo") html += figure(media.url, media.altText, media)
		else if (media.thumbnail_url)
			html += `<figure><a href="${attr(postUrl)}"><img src="${attr(media.thumbnail_url)}" alt="Video"></a><figcaption><a href="${attr(postUrl)}">Watch the video on X</a></figcaption></figure>`
	}
	if (withQuote && post.quote) {
		const q = post.quote
		const qUrl = q.url ?? `https://x.com/${q.author.screen_name}/status/${q.id}`
		const who = q.author.name ? `${escapeHtml(q.author.name)} ` : ""
		html += `<blockquote><p>${who}<a href="${attr(qUrl)}">@${escapeHtml(q.author.screen_name)}</a></p>${renderPost(q, false)}</blockquote>`
	}
	return html
}

function mediaOf(post: XStatus): XMedia[] {
	const m = post.media
	if (!m) return []
	return m.all ?? [...(m.photos ?? []), ...(m.videos ?? [])]
}

type Mark =
	| { start: number; end: number; kind: "strong" | "em" | "s" }
	| { start: number; end: number; kind: "link"; href: string; label?: string }
	| { start: number; end: number; kind: "drop" }

function isMark(m: Mark | null): m is Mark {
	return m !== null
}

function facetMark(text: string, f: XFacet): Mark | null {
	const [start, end] = f.indices
	switch (f.type) {
		case "bold":
			return { start, end, kind: "strong" }
		case "italic":
			return { start, end, kind: "em" }
		case "strikethrough":
			return { start, end, kind: "s" }
		case "url": {
			const href = f.replacement ?? f.original
			return href ? { start, end, kind: "link", href, label: f.display ?? href } : null
		}
		case "mention":
			return {
				start,
				end,
				kind: "link",
				href: `https://x.com/${text.slice(start, end).replace(/^[@＠]/, "")}`,
			}
		case "hashtag":
			return {
				start,
				end,
				kind: "link",
				href: `https://x.com/hashtag/${encodeURIComponent(text.slice(start, end).replace(/^[#＃]/, ""))}`,
			}
		case "media":
			return { start, end, kind: "drop" }
		default:
			return null
	}
}

/**
 * Render text[start, end) with marks. Links and drops replace their range (overlaps skipped);
 * styles wrap each plain segment separately so tags always nest.
 */
function renderSpan(text: string, start: number, end: number, marks: Mark[]): string {
	const within = marks.filter((m) => m.end > start && m.start < end)
	const styles = within.filter((m) => m.kind === "strong" || m.kind === "em" || m.kind === "s")
	const replaced = within
		.filter((m) => m.kind === "link" || m.kind === "drop")
		.sort((a, b) => a.start - b.start)

	const styled = (from: number, to: number): string => {
		if (to <= from) return ""
		const cuts = new Set([from, to])
		for (const m of styles) {
			if (m.start > from && m.start < to) cuts.add(m.start)
			if (m.end > from && m.end < to) cuts.add(m.end)
		}
		const points = [...cuts].sort((a, b) => a - b)
		let out = ""
		for (let i = 0; i < points.length - 1; i++) {
			const a = points[i] as number
			const b = points[i + 1] as number
			let seg = escapeHtml(text.slice(a, b)).replace(/\n/g, "<br>")
			for (const m of styles) if (m.start <= a && m.end >= b) seg = `<${m.kind}>${seg}</${m.kind}>`
			out += seg
		}
		return out
	}

	let out = ""
	let pos = start
	for (const m of replaced) {
		const from = Math.max(m.start, start)
		const to = Math.min(m.end, end)
		if (from < pos) continue
		out += styled(pos, from)
		if (m.kind === "link") {
			const inner = m.label !== undefined ? escapeHtml(m.label) : styled(from, to)
			out += `<a href="${attr(m.href)}">${inner}</a>`
		}
		pos = to
	}
	return out + styled(pos, end)
}

/** Paragraph ranges: split on blank lines, trimmed. */
function paragraphs(text: string, start: number, end: number): Array<[number, number]> {
	const out: Array<[number, number]> = []
	const re = /\n[ \t]*\n\s*/g
	re.lastIndex = start
	let from = start
	for (;;) {
		const m = re.exec(text)
		const stop = m && m.index < end ? m.index : end
		let a = from
		let b = stop
		while (a < b && /\s/.test(text[a] as string)) a++
		while (b > a && /\s/.test(text[b - 1] as string)) b--
		if (b > a) out.push([a, b])
		if (!m || m.index >= end) break
		from = re.lastIndex
	}
	return out
}

function renderArticle(article: XArticle): string {
	const content = article.content
	const entities = new Map<string, DraftEntity>()
	const map = content?.entityMap
	if (Array.isArray(map)) for (const e of map) entities.set(String(e.key), e.value)
	else if (map) for (const [k, v] of Object.entries(map)) entities.set(k, v)
	const images = new Map<string, XArticleMedia>()
	for (const m of article.media_entities ?? []) if (m.media_id) images.set(m.media_id, m)

	let html = ""
	let list: "ul" | "ol" | null = null
	for (const block of content?.blocks ?? []) {
		const listType =
			block.type === "unordered-list-item" ? "ul" : block.type === "ordered-list-item" ? "ol" : null
		if (list && listType !== list) {
			html += `</${list}>`
			list = null
		}
		if (listType && !list) {
			html += `<${listType}>`
			list = listType
		}

		const text = block.text ?? ""
		const marks: Mark[] = []
		for (const r of block.inlineStyleRanges ?? []) {
			const kind = { Bold: "strong", Italic: "em", Strikethrough: "s" }[r.style] as
				| "strong"
				| "em"
				| "s"
				| undefined
			if (kind) marks.push({ start: r.offset, end: r.offset + r.length, kind })
		}
		for (const r of block.entityRanges ?? []) {
			const entity = entities.get(String(r.key))
			if (entity?.type === "LINK" && entity.data?.url)
				marks.push({
					start: r.offset,
					end: r.offset + r.length,
					kind: "link",
					href: entity.data.url,
				})
		}
		const inline = () => renderSpan(text, 0, text.length, marks)

		switch (block.type) {
			case "unordered-list-item":
			case "ordered-list-item":
				html += `<li>${inline()}</li>`
				break
			case "header-one":
			case "header-two":
				html += `<h2>${inline()}</h2>`
				break
			case "header-three":
				html += `<h3>${inline()}</h3>`
				break
			case "header-four":
			case "header-five":
			case "header-six":
				html += `<h4>${inline()}</h4>`
				break
			case "blockquote":
				html += `<blockquote><p>${inline()}</p></blockquote>`
				break
			case "code-block":
				html += `<pre><code>${escapeHtml(text)}</code></pre>`
				break
			case "atomic":
				for (const r of block.entityRanges ?? []) {
					const entity = entities.get(String(r.key))
					if (entity?.type === "DIVIDER") html += "<hr>"
					if (entity?.type === "MEDIA")
						for (const item of entity.data?.mediaItems ?? []) {
							const info = item.mediaId ? images.get(item.mediaId)?.media_info : undefined
							if (info?.original_img_url)
								html += figure(info.original_img_url, undefined, {
									width: info.original_img_width,
									height: info.original_img_height,
								})
						}
				}
				break
			default:
				if (text.trim()) html += `<p>${inline()}</p>`
		}
	}
	if (list) html += `</${list}>`
	return html
}

function figure(src: string, alt?: string, size?: { width?: number; height?: number }): string {
	const dims = size?.width && size.height ? ` width="${size.width}" height="${size.height}"` : ""
	return `<figure><img src="${attr(src)}" alt="${attr(alt ?? "")}"${dims}></figure>`
}

/** First line of the post, cut at a word boundary. */
function titleFromText(status: XStatus, fallback?: string): string {
	const text = (status.text ?? fallback ?? "").replace(/https?:\/\/\S+/g, "").trim()
	const firstLine = text.split(/\n/).find((l) => l.trim()) ?? ""
	return summary(firstLine, 100) || `Post by @${status.author.screen_name}`
}

function summary(text: string, max: number): string {
	const clean = text.replace(/\s+/g, " ").trim()
	if (clean.length <= max) return clean
	const cut = clean.slice(0, max)
	const space = cut.lastIndexOf(" ")
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function attr(s: string): string {
	return escapeHtml(s).replace(/"/g, "&quot;")
}
