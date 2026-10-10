export interface PageMetadata {
	title: string | null
	author: string | null
	/** Author from JSON-LD; lower confidence than meta tags or the extractor byline. */
	ldAuthor: string | null
	/** @handle from twitter:creator; last resort. */
	twitterHandle: string | null
	siteName: string | null
	description: string | null
	language: string | null
	publishedAt: Date | null
	leadImageUrl: string | null
	canonicalUrl: string | null
}

function meta(doc: Document, ...names: string[]): string | null {
	for (const name of names) {
		const el = doc.querySelector(`meta[name="${name}" i], meta[property="${name}" i]`)
		const content = el?.getAttribute("content")?.trim()
		if (content) return content
	}
	return null
}

function jsonLd(doc: Document): Array<Record<string, unknown>> {
	const out: Array<Record<string, unknown>> = []
	for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
		try {
			const parsed = JSON.parse(script.textContent ?? "")
			const items = Array.isArray(parsed)
				? parsed
				: parsed?.["@graph"] && Array.isArray(parsed["@graph"])
					? parsed["@graph"]
					: [parsed]
			for (const item of items)
				if (item && typeof item === "object") out.push(item as Record<string, unknown>)
		} catch {
			// ignore malformed JSON-LD
		}
	}
	return out
}

function articleLd(doc: Document): Record<string, unknown> | null {
	const types = /article|blogposting|newsarticle|report|webpage/i
	for (const item of jsonLd(doc)) {
		const t = item["@type"]
		const typeStr = Array.isArray(t) ? t.join(" ") : String(t ?? "")
		if (types.test(typeStr)) return item
	}
	return null
}

function ldAuthor(ld: Record<string, unknown> | null): string | null {
	if (!ld) return null
	const a = ld.author
	const pick = (v: unknown): string | null => {
		if (!v) return null
		if (typeof v === "string") return v
		if (Array.isArray(v)) return v.map(pick).filter(Boolean).slice(0, 3).join(", ") || null
		if (typeof v === "object" && "name" in v && typeof (v as { name: unknown }).name === "string")
			return (v as { name: string }).name
		return null
	}
	return pick(a)
}

export function parseDate(value: string | null | undefined): Date | null {
	if (typeof value !== "string" || !value) return null
	const v = value.trim()
	if (!v) return null
	const ts = Date.parse(v)
	if (!Number.isNaN(ts)) {
		const d = new Date(ts)
		if (d.getFullYear() > 1990 && d.getFullYear() < 2100) return d
	}
	return null
}

function dateFromPath(url: string): Date | null {
	const m =
		/\/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/.exec(new URL(url).pathname) ??
		/\/(\d{4})-(\d{2})-(\d{2})/.exec(new URL(url).pathname)
	if (!m) return null
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
	return Number.isNaN(d.getTime()) ? null : d
}

const TITLE_SEPARATORS = [" | ", " – ", " — ", " - ", " · ", " • ", " :: ", " » "]

/** Strip a trailing/leading site name from a document title. */
function siteCandidates(siteName: string | null, hostname: string | null): string[] {
	const out = new Set<string>()
	const site = (siteName ?? "").toLowerCase().replace(/\s+/g, "").trim()
	if (site.length >= 3) out.add(site)
	if (hostname) {
		const labels = hostname
			.toLowerCase()
			.replace(/^www\./, "")
			.split(".")
		// drop TLD (and a country second-level like co.uk)
		let core = labels.slice(0, -1)
		if (core.length > 1 && (core[core.length - 1] as string).length <= 3 && labels.length > 2)
			core = core.slice(0, -1)
		if (core.length) out.add(core.join("."))
		for (const l of core) if (l.length >= 4) out.add(l)
	}
	return Array.from(out)
}

/** Strip a trailing/leading site name from a document title. */
export function cleanTitle(
	rawTitle: string,
	siteName: string | null,
	hostname: string | null,
): string {
	let title = rawTitle.replace(/\s+/g, " ").trim()
	const candidates = siteCandidates(siteName, hostname)
	const isSite = (p: string) => {
		const l = p.toLowerCase().replace(/\s+/g, "")
		return candidates.some((c) => l === c || l.includes(c) || (c.length >= 6 && c.includes(l)))
	}
	for (const sep of TITLE_SEPARATORS) {
		if (!title.includes(sep)) continue
		const parts = title
			.split(sep)
			.map((p) => p.trim())
			.filter(Boolean)
		if (parts.length < 2) continue
		const first = parts[0] as string
		const last = parts[parts.length - 1] as string
		if (isSite(last)) title = parts.slice(0, -1).join(sep)
		else if (isSite(first)) title = parts.slice(1).join(sep)
		else if (last.length <= 3 || (last.length < 25 && last.length * 3 < first.length))
			title = parts.slice(0, -1).join(sep)
	}
	return title.trim()
}

export function extractMetadata(doc: Document, url: string): PageMetadata {
	const hostname = new URL(url).hostname
	const ld = articleLd(doc)
	const siteName = meta(doc, "og:site_name", "application-name") ?? null

	const rawTitle =
		meta(doc, "og:title", "twitter:title") ??
		(typeof ld?.headline === "string" ? ld.headline : null) ??
		doc.querySelector("title")?.textContent ??
		doc.querySelector("h1")?.textContent ??
		""
	const title = cleanTitle(rawTitle, siteName, hostname) || null

	const author =
		meta(
			doc,
			"author",
			"article:author",
			"parsely-author",
			"dc.creator",
			"sailthru.author",
		)?.replace(/^https?:\/\/\S+$/, "") || null
	const twitterHandle = meta(doc, "twitter:creator")?.replace(/^@/, "") ?? null

	const description =
		meta(doc, "description", "og:description", "twitter:description") ??
		(typeof ld?.description === "string" ? (ld.description as string) : null)

	const langAttr = doc.documentElement.getAttribute("lang") ?? meta(doc, "og:locale", "dc.language")
	const language = langAttr ? langAttr.split(/[-_]/)[0]?.toLowerCase() || null : null

	const publishedAt =
		parseDate(
			meta(
				doc,
				"article:published_time",
				"datePublished",
				"date",
				"dc.date",
				"dc.date.issued",
				"parsely-pub-date",
				"sailthru.date",
				"pubdate",
				"publish-date",
			),
		) ??
		parseDate(ld?.datePublished as string | undefined) ??
		parseDate(doc.querySelector("time[datetime]")?.getAttribute("datetime")) ??
		dateFromPath(url)

	const image =
		meta(doc, "og:image", "og:image:url", "twitter:image", "twitter:image:src") ??
		(typeof ld?.image === "string"
			? (ld.image as string)
			: Array.isArray(ld?.image)
				? (ld.image[0] as string | undefined)
				: (ld?.image as { url?: string } | undefined)?.url) ??
		null
	let leadImageUrl: string | null = null
	if (image) {
		try {
			const abs = new URL(image, url)
			if (abs.protocol === "http:" || abs.protocol === "https:") leadImageUrl = abs.toString()
		} catch {
			leadImageUrl = null
		}
	}

	let canonicalUrl: string | null = null
	const canonicalHref =
		doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? meta(doc, "og:url")
	if (canonicalHref) {
		try {
			const abs = new URL(canonicalHref, url)
			if (abs.protocol === "http:" || abs.protocol === "https:") canonicalUrl = abs.toString()
		} catch {
			canonicalUrl = null
		}
	}

	return {
		title,
		author: author?.trim() || null,
		ldAuthor: ldAuthor(ld),
		twitterHandle,
		siteName: siteName || hostname.replace(/^www\./, ""),
		description: description?.trim() || null,
		language,
		publishedAt,
		leadImageUrl,
		canonicalUrl,
	}
}
