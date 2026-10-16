import dns from "node:dns"
import { BlockList, isIP } from "node:net"
import { Agent, buildConnector, fetch as undiciFetch } from "undici"
import { ExtractError } from "./errors"

export interface FetchedPage {
	/** The decoded body; empty for a 304. */
	html: string
	finalUrl: string
	status: number
	contentType: string | null
	/** Cache validators, for a conditional request next time. */
	etag: string | null
	lastModified: string | null
}

export interface FetchOptions {
	timeoutMs?: number
	maxBytes?: number
	maxRedirects?: number
	userAgent?: string
}

export interface FetchPageOptions extends FetchOptions {
	/** Read only the head (or at most maxBytes), cancelling the rest of the response. */
	headOnly?: boolean
	/** Sent as-is, over the defaults (`accept`, conditional `if-none-match`…). */
	headers?: Record<string, string>
	/** Content types accepted as a page. Defaults to HTML, XML and plain text. */
	contentTypes?: RegExp
}

const PAGE_TYPES = /text\/html|application\/xhtml\+xml|text\/plain|application\/xml|text\/xml/i

const DEFAULT_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

/**
 * Klipstack's own name. Some bot walls (Cloudflare's) refuse a request that says it is Chrome but
 * doesn't act like a browser, and let an honest client in: a page refused with a 403 under the
 * default name is asked for once more under this one.
 */
const HONEST_UA = "Klipstack/1.0 (+https://klipstack.com)"

/**
 * Address ranges a server-side fetcher must never talk to: private, loopback, link-local (cloud
 * metadata), shared, documentation, benchmarking, multicast and reserved ranges. In IPv6, also the
 * transition ranges that reach IPv4 hosts (compatible, NAT64, 6to4, Teredo); a mapped address
 * (`::ffff:a.b.c.d`) is judged by its IPv4 address. One list per family: a `BlockList` matches
 * IPv4 addresses against IPv6 mapped rules too.
 */
const BLOCKED_V4 = new BlockList()
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 3], // multicast and reserved, up to 255.255.255.255
] as const)
	BLOCKED_V4.addSubnet(network, prefix, "ipv4")
const BLOCKED_V6 = new BlockList()
for (const [network, prefix] of [
	["::", 96], // unspecified, loopback, IPv4-compatible
	["64:ff9b::", 96], // NAT64
	["64:ff9b:1::", 48], // local NAT64
	["100::", 64], // discard
	["2001::", 32], // Teredo
	["2001:db8::", 32], // documentation
	["2002::", 16], // 6to4
	["fc00::", 7], // unique local
	["fe80::", 10], // link-local
	["fec0::", 10], // site-local (deprecated)
	["ff00::", 8], // multicast
] as const)
	BLOCKED_V6.addSubnet(network, prefix, "ipv6")
const MAPPED = new BlockList()
MAPPED.addSubnet("::ffff:0:0", 96, "ipv6")

/** True for addresses a server-side fetcher must never talk to (anything that is not an IP too). */
export function isPrivateAddress(address: string): boolean {
	const family = isIP(address)
	if (family === 4) return BLOCKED_V4.check(address, "ipv4")
	if (family !== 6) return true
	if (MAPPED.check(address, "ipv6")) {
		const v4 = mappedIPv4(address)
		return v4 === null || BLOCKED_V4.check(v4, "ipv4")
	}
	return BLOCKED_V6.check(address, "ipv6")
}

/** The IPv4 address inside a mapped IPv6 one, from its canonical form (`::ffff:7f00:1`). */
function mappedIPv4(address: string): string | null {
	try {
		const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1)
		const [hi, lo] = canonical
			.split(":")
			.slice(-2)
			.map((group) => Number.parseInt(group, 16))
		if (hi === undefined || lo === undefined || Number.isNaN(hi) || Number.isNaN(lo)) return null
		return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".")
	} catch {
		return null
	}
}

/**
 * Whether a URL's hostname is refused before connecting. IPv6 literals keep their brackets in
 * `URL.hostname` (`[::1]`), and connecting to a literal skips the DNS lookup and its check.
 */
export function hostIsBlocked(hostname: string): boolean {
	const h = hostname.toLowerCase().replace(/\.$/, "")
	const literal = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h
	if (isIP(literal)) return isPrivateAddress(literal)
	if (h.startsWith("[")) return true
	return (
		h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")
	)
}

/**
 * DNS lookup that refuses private results. Wired into the undici connector so the address
 * checked is the address connected to (no rebinding window between resolve and connect).
 */
const guardedLookup: typeof dns.lookup = ((
	hostname: string,
	options: unknown,
	callback: unknown,
) => {
	const cb = (typeof options === "function" ? options : callback) as (
		err: NodeJS.ErrnoException | null,
		address?: unknown,
		family?: number,
	) => void
	const opts =
		typeof options === "object" && options !== null ? (options as dns.LookupAllOptions) : {}
	dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
		if (err) return cb(err)
		const list = Array.isArray(addresses) ? addresses : [addresses as unknown as dns.LookupAddress]
		if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
			const e: NodeJS.ErrnoException = new Error(`blocked host: ${hostname}`)
			e.code = "EBLOCKED"
			return cb(e)
		}
		if ((opts as { all?: boolean }).all) return cb(null, list)
		const first = list[0] as dns.LookupAddress
		return cb(null, first.address, first.family)
	})
}) as typeof dns.lookup

const blockedError = (what: string) =>
	Object.assign(new Error(`blocked address: ${what}`), { code: "EBLOCKED" })

/**
 * A connector that resolves with `lookup` (the guarded one), then checks the address actually
 * connected to: the last word, whatever path (a literal, a lookup) led there. Nothing is sent
 * before it passes, except a TLS handshake.
 */
export function publicConnector(
	lookup: typeof dns.lookup = guardedLookup,
): buildConnector.connector {
	const connect = buildConnector({ lookup, timeout: 10_000 })
	return (options, callback) => {
		connect(options, (error, socket) => {
			if (error) return callback(error, null)
			const address = socket.remoteAddress
			if (!address || isPrivateAddress(address)) {
				socket.destroy()
				return callback(blockedError(options.hostname), null)
			}
			callback(null, socket)
		})
	}
}

let agent: Agent | undefined
function getAgent() {
	if (!agent) {
		agent = new Agent({ connect: publicConnector(), headersTimeout: 15_000, bodyTimeout: 15_000 })
	}
	return agent
}

/**
 * Decode a response body. Honors the HTTP charset, then a `<meta charset>` sniffed from the head;
 * with nothing declared, strict UTF-8 first and windows-1252 as the legacy fallback.
 */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
	let charset = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1]
	if (!charset) {
		const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096))
		charset =
			/<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
			/<\?xml[^>]+encoding=["']([\w-]+)/i.exec(head)?.[1]
	}
	if (charset) {
		try {
			return new TextDecoder(charset, { fatal: false }).decode(bytes)
		} catch {
			// unknown label; fall through to sniffing
		}
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
	} catch {
		return new TextDecoder("windows-1252").decode(bytes)
	}
}

/**
 * Fetch a public web page with SSRF protection, redirect re-validation, timeout and size caps.
 * A conditional request (validators in `headers`) can come back as a 304 with an empty body.
 */
/** The next piece of a body. A timeout or a broken connection partway is an ExtractError too. */
async function nextChunk(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	deadline: AbortSignal,
	timeoutMs: number,
) {
	try {
		return await reader.read()
	} catch (cause) {
		if (deadline.aborted)
			throw new ExtractError("timeout", `Timed out after ${timeoutMs}ms`, { cause })
		throw new ExtractError("fetch_failed", "The connection broke while the page came in", { cause })
	}
}

export async function fetchPage(url: string, options: FetchPageOptions = {}): Promise<FetchedPage> {
	try {
		return await fetchPageAs(url, options)
	} catch (error) {
		// Only under the default name: a name the caller chose is theirs to keep.
		const refused = error instanceof ExtractError && error.status === 403
		if (!refused || options.userAgent) throw error
		// From the start, through every check again.
		return fetchPageAs(url, { ...options, userAgent: HONEST_UA })
	}
}

async function fetchPageAs(url: string, options: FetchPageOptions): Promise<FetchedPage> {
	const {
		timeoutMs = 15_000,
		maxBytes = 5 * 1024 * 1024,
		maxRedirects = 5,
		userAgent = DEFAULT_UA,
		headers = {},
		contentTypes = PAGE_TYPES,
		headOnly = false,
	} = options
	const deadline = AbortSignal.timeout(timeoutMs)
	let current = url

	for (let hop = 0; hop <= maxRedirects; hop++) {
		let target: URL
		try {
			target = new URL(current)
		} catch {
			throw new ExtractError("invalid_url", `Invalid URL: ${current}`)
		}
		if (target.protocol !== "http:" && target.protocol !== "https:")
			throw new ExtractError("invalid_url", "Only http(s) URLs are supported")
		if (hostIsBlocked(target.hostname))
			throw new ExtractError("blocked_host", `Refusing to fetch ${target.hostname}`)

		let res: Awaited<ReturnType<typeof undiciFetch>>
		try {
			res = await undiciFetch(target, {
				dispatcher: getAgent(),
				redirect: "manual",
				signal: deadline,
				headers: {
					"user-agent": userAgent,
					accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					"accept-language": "en-US,en;q=0.9",
					"accept-encoding": "gzip, deflate, br",
					"upgrade-insecure-requests": "1",
					...headers,
				},
			})
		} catch (cause) {
			if (deadline.aborted)
				throw new ExtractError("timeout", `Timed out after ${timeoutMs}ms`, { cause })
			const code =
				(cause as { cause?: { code?: string } })?.cause?.code ?? (cause as { code?: string })?.code
			if (code === "EBLOCKED")
				throw new ExtractError("blocked_host", `Refusing to fetch ${target.hostname}`, { cause })
			throw new ExtractError("fetch_failed", `Could not fetch ${target.hostname}`, { cause })
		}

		const validators = {
			etag: res.headers.get("etag"),
			lastModified: res.headers.get("last-modified"),
		}
		if (res.status === 304) {
			await res.body?.cancel()
			return {
				html: "",
				finalUrl: res.url || target.toString(),
				status: 304,
				contentType: null,
				...validators,
			}
		}
		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get("location")
			await res.body?.cancel()
			if (!location)
				throw new ExtractError("http_error", `Redirect without location (${res.status})`, {
					status: res.status,
				})
			current = new URL(location, target).toString()
			continue
		}
		if (!res.ok) {
			await res.body?.cancel()
			throw new ExtractError("http_error", `HTTP ${res.status}`, {
				status: res.status,
				retryAfter: parseRetryAfter(res.headers.get("retry-after")),
			})
		}
		const contentType = res.headers.get("content-type")
		if (contentType && !contentTypes.test(contentType)) {
			await res.body?.cancel()
			throw new ExtractError("not_html", `Unsupported content type: ${contentType}`)
		}
		const declared = Number(res.headers.get("content-length") ?? 0)
		if (!headOnly && declared > maxBytes) {
			await res.body?.cancel()
			throw new ExtractError("too_large", `Response is ${declared} bytes (limit ${maxBytes})`)
		}

		const chunks: Uint8Array[] = []
		let total = 0
		const reader = res.body?.getReader()
		if (reader) {
			for (;;) {
				const { done, value } = await nextChunk(reader, deadline, timeoutMs)
				if (done) break
				const chunk = headOnly ? value.subarray(0, maxBytes - total) : value
				total += chunk.byteLength
				if (total > maxBytes) {
					await reader.cancel()
					throw new ExtractError("too_large", `Response exceeded ${maxBytes} bytes`)
				}
				chunks.push(chunk)
				if (headOnly) {
					const head = decodeBody(Buffer.concat(chunks), contentType)
					if (total >= maxBytes || /<\/head\s*>|<body(?:\s|>)/i.test(head)) {
						await reader.cancel()
						break
					}
				}
			}
		}
		const bytes = new Uint8Array(total)
		let offset = 0
		for (const c of chunks) {
			bytes.set(c, offset)
			offset += c.byteLength
		}
		const html = decodeBody(bytes, contentType)
		const headEnd = headOnly ? html.search(/<\/head\s*>|<body(?:\s|>)/i) : -1
		return {
			html: headEnd < 0 ? html : html.slice(0, headEnd),
			finalUrl: res.url || target.toString(),
			status: res.status,
			contentType,
			...validators,
		}
	}
	throw new ExtractError("too_many_redirects", `More than ${maxRedirects} redirects`)
}

/** Seconds from a `Retry-After` header (delta seconds or an HTTP date); null when absent or bad. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
	if (!value) return null
	const trimmed = value.trim()
	if (/^\d+$/.test(trimmed)) return Number(trimmed)
	const at = Date.parse(trimmed)
	return Number.isNaN(at) ? null : Math.max(0, Math.round((at - now) / 1000))
}

export interface FetchedBytes {
	bytes: Buffer
	finalUrl: string
	contentType: string | null
}

/**
 * Fetch a binary resource (images) with the same SSRF guard, redirect re-validation, timeout and
 * size cap as `fetchPage`. Rejects non-image content types.
 */
export async function fetchBytes(
	url: string,
	options: FetchOptions & { accept?: RegExp } = {},
): Promise<FetchedBytes> {
	const {
		timeoutMs = 15_000,
		maxBytes = 10 * 1024 * 1024,
		maxRedirects = 5,
		userAgent = DEFAULT_UA,
		accept = /^image\//i,
	} = options
	const deadline = AbortSignal.timeout(timeoutMs)
	let current = url

	for (let hop = 0; hop <= maxRedirects; hop++) {
		let target: URL
		try {
			target = new URL(current)
		} catch {
			throw new ExtractError("invalid_url", `Invalid URL: ${current}`)
		}
		if (target.protocol !== "http:" && target.protocol !== "https:")
			throw new ExtractError("invalid_url", "Only http(s) URLs are supported")
		if (hostIsBlocked(target.hostname))
			throw new ExtractError("blocked_host", `Refusing to fetch ${target.hostname}`)

		let res: Awaited<ReturnType<typeof undiciFetch>>
		try {
			res = await undiciFetch(target, {
				dispatcher: getAgent(),
				redirect: "manual",
				signal: deadline,
				headers: {
					"user-agent": userAgent,
					accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
					referer: `${target.origin}/`,
				},
			})
		} catch (cause) {
			if (deadline.aborted)
				throw new ExtractError("timeout", `Timed out after ${timeoutMs}ms`, { cause })
			const code =
				(cause as { cause?: { code?: string } })?.cause?.code ?? (cause as { code?: string })?.code
			if (code === "EBLOCKED")
				throw new ExtractError("blocked_host", `Refusing to fetch ${target.hostname}`, { cause })
			throw new ExtractError("fetch_failed", `Could not fetch ${target.hostname}`, { cause })
		}

		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get("location")
			await res.body?.cancel()
			if (!location)
				throw new ExtractError("http_error", `Redirect without location (${res.status})`, {
					status: res.status,
				})
			current = new URL(location, target).toString()
			continue
		}
		if (!res.ok) {
			await res.body?.cancel()
			throw new ExtractError("http_error", `HTTP ${res.status}`, { status: res.status })
		}
		const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? null
		if (contentType && !accept.test(contentType)) {
			await res.body?.cancel()
			throw new ExtractError("not_html", `Unsupported content type: ${contentType}`)
		}
		const declared = Number(res.headers.get("content-length") ?? 0)
		if (declared > maxBytes) {
			await res.body?.cancel()
			throw new ExtractError("too_large", `Response is ${declared} bytes (limit ${maxBytes})`)
		}
		const chunks: Uint8Array[] = []
		let total = 0
		const reader = res.body?.getReader()
		if (reader) {
			for (;;) {
				const { done, value } = await nextChunk(reader, deadline, timeoutMs)
				if (done) break
				total += value.byteLength
				if (total > maxBytes) {
					await reader.cancel()
					throw new ExtractError("too_large", `Response exceeded ${maxBytes} bytes`)
				}
				chunks.push(value)
			}
		}
		return {
			bytes: Buffer.concat(chunks.map((c) => Buffer.from(c))),
			finalUrl: res.url || target.toString(),
			contentType,
		}
	}
	throw new ExtractError("too_many_redirects", `More than ${maxRedirects} redirects`)
}
