import { createHash } from "node:crypto"
import { canonicalText, countWords, plainText } from "@klipstack/anchor"
import { describeError, loggedHost } from "@klipstack/log"
import { JSDOM, VirtualConsole } from "jsdom"
import { cleanArticleHtml } from "./clean"
import { ExtractError } from "./errors"
import { defuddleExtractor, readabilityExtractor } from "./extractors"
import type { Extractor, ExtractorResult } from "./extractors/types"
import { cleanTitle, extractMetadata, parseDate } from "./metadata"
import { sanitizeHtml } from "./sanitize"

export interface ExtractInput {
	html: string
	url: string
	/** Override the extractor order (tests, admin re-runs). */
	extractors?: Extractor[]
}

export interface ExtractedArticle {
	/** A long-form article, or a short-form post (a tweet or a thread). */
	type: "article" | "post"
	title: string
	author: string | null
	siteName: string | null
	description: string | null
	language: string | null
	publishedAt: Date | null
	leadImageUrl: string | null
	canonicalUrl: string | null
	/** Sanitized HTML, rendered verbatim by the reader. */
	html: string
	/** Canonical text (offset coordinate space). */
	text: string
	textHash: string
	wordCount: number
	readingMinutes: number
	extractor: { name: string; version: string }
	/** Per-extractor measurements after cleaning, for diagnostics. */
	candidates: Array<{ name: string; textLength: number; junkLength: number }>
}

/** First plausible author: short, at most two names, not a URL or handle. */
function pickAuthor(...candidates: Array<string | null | undefined>): string | null {
	for (const raw of candidates) {
		if (!raw) continue
		const a = raw
			.replace(/^\s*by\s+/i, "")
			.replace(/\s+/g, " ")
			.trim()
		if (!a || a.length > 80) continue
		if (/^https?:\/\//i.test(a)) continue
		if ((a.match(/,|\band\b|&/g) ?? []).length > 2) continue
		return a
	}
	return null
}

const WORDS_PER_MINUTE = 230
const MIN_WORDS = 30
/** Candidates with less cleaned text than this are treated as "found nothing". */
const MIN_CANDIDATE_CHARS = 200

function quietDom(html: string, url: string) {
	const virtualConsole = new VirtualConsole()
	virtualConsole.on("jsdomError", () => {})
	return new JSDOM(html, { url, virtualConsole, pretendToBeVisual: true })
}

const LEAF_BLOCKS =
	"p,li,td,th,dd,dt,h2,h3,h4,h5,h6,pre,blockquote,figcaption,div,section,header,footer,aside,nav"

interface Measure {
	/** Characters of text in the candidate. */
	total: number
	/** Characters in short, link-dominated blocks or nav/header/footer/aside: boilerplate. */
	junk: number
}

/** Measure a cleaned candidate: how much text, and how much of it looks like navigation. */
function measure(html: string): Measure {
	const body = new JSDOM(`<!doctype html><body>${html}</body>`).window.document.body
	let total = 0
	let junk = 0
	for (const el of Array.from(body.querySelectorAll(LEAF_BLOCKS))) {
		if (el.querySelector(LEAF_BLOCKS)) continue
		const text = (el.textContent ?? "").replace(/\s+/g, " ").trim()
		if (!text) continue
		total += text.length
		if (/^(PRE|H[2-6]|FIGCAPTION|BLOCKQUOTE)$/.test(el.tagName)) continue
		const inChrome = Boolean(el.closest("nav, header, footer, aside"))
		let linkText = 0
		for (const a of Array.from(el.querySelectorAll("a")))
			linkText += (a.textContent ?? "").replace(/\s+/g, " ").trim().length
		if (inChrome || (text.length < 120 && linkText >= text.length * 0.5)) junk += text.length
	}
	return { total, junk }
}

/** Junk counts three times against a candidate: menus and footers inflate length, not value. */
function score(m: Measure): number {
	return m.total - m.junk - 3 * m.junk
}

interface Candidate {
	extractor: Extractor
	result: ExtractorResult
	cleaned: string
	textLength: number
	junkLength: number
	score: number
}

export async function extractArticle({
	html,
	url,
	extractors = [defuddleExtractor, readabilityExtractor],
}: ExtractInput): Promise<ExtractedArticle> {
	const dom = quietDom(html, url)
	const doc = dom.window.document
	const metadata = extractMetadata(doc, url)
	const hostname = new URL(url).hostname
	const titleFor = (result: ExtractorResult) =>
		metadata.title ?? (result.title ? cleanTitle(result.title, metadata.siteName, hostname) : null)

	// Run every extractor and score by the text that survives cleaning, so script blobs,
	// JSON payloads and page chrome score zero.
	const candidates: Candidate[] = []
	for (const extractor of extractors) {
		try {
			const result = await extractor.extract(doc, url)
			if (!result?.contentHtml) continue
			const cleaned = cleanArticleHtml(result.contentHtml, { url, title: titleFor(result) })
			const m = measure(cleaned)
			candidates.push({
				extractor,
				result,
				cleaned,
				textLength: m.total,
				junkLength: m.junk,
				score: score(m),
			})
		} catch (error) {
			// An extractor that throws has a bug, or met a page it can't parse: keep the frames.
			console.warn(
				`[extract] ${extractor.name} failed on ${loggedHost(url)}: ${describeError(error)}`,
			)
		}
	}
	dom.window.close()

	const viable = candidates.filter((c) => c.textLength - c.junkLength >= MIN_CANDIDATE_CHARS)
	if (viable.length === 0) throw new ExtractError("no_content", "No article content found")

	// Highest score wins; the first extractor keeps ties within 3% so behaviour is predictable.
	const best = viable.reduce((a, b) => (b.score > a.score ? b : a))
	const first = viable[0] as Candidate
	const { extractor, result, cleaned } = first.score >= best.score * 0.97 ? first : best

	return finishArticle({
		html: cleaned,
		fields: {
			title: titleFor(result) ?? hostname,
			author: pickAuthor(metadata.author, result.author, metadata.ldAuthor, metadata.twitterHandle),
			siteName: metadata.siteName ?? result.siteName ?? null,
			description: metadata.description ?? result.excerpt?.trim() ?? null,
			language: metadata.language ?? (result.language?.split(/[-_]/)[0]?.toLowerCase() || null),
			publishedAt: metadata.publishedAt ?? parseDate(result.publishedAt),
			leadImageUrl: metadata.leadImageUrl ?? result.leadImageUrl ?? null,
			canonicalUrl: metadata.canonicalUrl,
		},
		extractor,
		candidates: candidates.map((c) => ({
			name: c.extractor.name,
			textLength: c.textLength,
			junkLength: c.junkLength,
		})),
	})
}

export type ArticleFields = Pick<
	ExtractedArticle,
	| "title"
	| "author"
	| "siteName"
	| "description"
	| "language"
	| "publishedAt"
	| "leadImageUrl"
	| "canonicalUrl"
>

/** Sanitize cleaned content and derive the canonical text every reader offset points into. */
export function finishArticle({
	html,
	fields,
	extractor,
	candidates = [],
	minWords = MIN_WORDS,
	type = "article",
}: {
	type?: ExtractedArticle["type"]
	html: string
	fields: ArticleFields
	extractor: { name: string; version: string }
	candidates?: ExtractedArticle["candidates"]
	minWords?: number
}): ExtractedArticle {
	const safe = sanitizeHtml(html)

	// Compute text exactly the way the reader's DOM will see it.
	const body = new JSDOM(`<!doctype html><body>${safe}</body>`).window.document.body
	const text = canonicalText(body)
	const plain = plainText(body)
	const wordCount = countWords(plain)
	if (wordCount < minWords)
		throw new ExtractError("no_content", `Only ${wordCount} words extracted`)

	return {
		...fields,
		type,
		html: safe,
		text,
		textHash: createHash("sha256").update(text).digest("hex"),
		wordCount,
		readingMinutes: Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)),
		extractor: { name: extractor.name, version: extractor.version },
		candidates,
	}
}
