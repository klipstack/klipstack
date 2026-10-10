import { createHash } from "node:crypto"
import { ExtractError } from "./errors"

const TRACKING_PARAMS = [
	/^utm_/i,
	/^fbclid$/i,
	/^gclid$/i,
	/^dclid$/i,
	/^msclkid$/i,
	/^yclid$/i,
	/^igshid$/i,
	/^mc_(cid|eid)$/i,
	/^_hs(enc|mi)$/i,
	/^mkt_tok$/i,
	/^ref$/i,
	/^ref_src$/i,
	/^source$/i,
	/^s$/i,
	/^cmpid$/i,
	/^ncid$/i,
	/^ocid$/i,
	/^twclid$/i,
	/^_ga$/i,
	/^spm$/i,
]

export function isHttpUrl(input: string): boolean {
	try {
		const u = new URL(input)
		return u.protocol === "http:" || u.protocol === "https:"
	} catch {
		return false
	}
}

/**
 * Canonical form used for per-user dedupe: lowercase host, no fragment, no tracking params,
 * no default port, no trailing slash on non-root paths, "www." kept (sites differ on it).
 */
export function normalizeUrl(input: string): string {
	let u: URL
	try {
		u = new URL(input.trim())
	} catch {
		throw new ExtractError("invalid_url", "Not a valid URL")
	}
	if (u.protocol !== "http:" && u.protocol !== "https:")
		throw new ExtractError("invalid_url", "Only http(s) URLs are supported")
	// One form per post, whatever host, share params or /photo/1 suffix it came with.
	const post = parseXStatusUrl(u.toString())
	if (post) return xStatusUrl(post)
	u.hash = ""
	u.hostname = u.hostname.toLowerCase()
	if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443"))
		u.port = ""
	for (const key of Array.from(u.searchParams.keys())) {
		if (TRACKING_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key)
	}
	if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "")
	let out = u.toString()
	if (out.endsWith("?")) out = out.slice(0, -1)
	return out
}

export function urlHash(normalizedUrl: string): string {
	return createHash("sha256").update(normalizedUrl).digest("hex")
}

/** X and the embed-fixer mirrors people share its links through. */
const X_HOSTS = new Set([
	"x.com",
	"twitter.com",
	"mobile.x.com",
	"mobile.twitter.com",
	"fxtwitter.com",
	"fixupx.com",
	"vxtwitter.com",
	"fixvx.com",
])

export function isXHost(hostname: string): boolean {
	return X_HOSTS.has(hostname.toLowerCase().replace(/^www\./, ""))
}

export interface XStatusRef {
	/** Lowercased screen name; null for /i/status/ links. */
	handle: string | null
	id: string
}

/** A post on X: /{handle}/status/{id}, /i/status/{id} or /i/web/status/{id}, any trailing path. */
export function parseXStatusUrl(url: string): XStatusRef | null {
	let u: URL
	try {
		u = new URL(url)
	} catch {
		return null
	}
	if (!isXHost(u.hostname)) return null
	const m = /^\/(?:i\/web|i|([A-Za-z0-9_]{1,15}))\/status(?:es)?\/(\d{1,20})(?:\/|$)/.exec(
		u.pathname,
	)
	if (!m?.[2]) return null
	return { handle: m[1]?.toLowerCase() ?? null, id: m[2] }
}

export function xStatusUrl({ handle, id }: XStatusRef): string {
	return `https://x.com/${handle ?? "i"}/status/${id}`
}

/** Sites we know we cannot turn into an article (yet). Returns a reason key or null. */
export function unsupportedReason(url: string): "twitter" | "youtube" | null {
	const host = new URL(url).hostname.replace(/^www\./, "")
	if (isXHost(host) && !parseXStatusUrl(url)) return "twitter"
	if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") return "youtube"
	return null
}
