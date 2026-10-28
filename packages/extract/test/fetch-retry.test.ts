import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { fetch as undiciFetch } from "undici"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchFeed } from "../src/feeds"
import { fetchPage } from "../src/fetch"

/**
 * A site behind a bot wall, served locally. The guard refuses loopback addresses, so the test
 * sends each request the fetcher makes for `https://site.example` here instead: the fetcher's own
 * checks still run on every address it is given.
 */
vi.mock("undici", async (original) => {
	const real = await original<typeof import("undici")>()
	return { ...real, fetch: vi.fn() }
})

const CHROME = /Chrome\//
const requests: { path: string; userAgent: string }[] = []
const RECAPTCHA = `<!doctype html><html><head><base href="https://www.google.com/recaptcha/challengepage/"><title>Checking your browser - reCAPTCHA</title></head><body></body></html>`
const CLOUDFLARE = `<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt = {cType: 'managed'};</script></body></html>`
const ANUBIS = `<!doctype html><html><head><title>Making sure you&#39;re not a bot!</title></head><body><script id="anubis_challenge" type="application/json">{}</script></body></html>`
const VERCEL = `<!DOCTYPE html><html><head><title>Vercel Security Checkpoint</title></head><body></body></html>`
const AWS_CAPTCHA = `<!DOCTYPE html><html><head><title></title><script>window.gokuProps = {"key":"x"};</script></head><body><div id="captcha-container"></div></body></html>`
const FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>A blog</title><item><title>Just a moment...</title><link>https://site.example/a</link></item></channel></rss>`

/** `reset`: the connection breaks after the headers. `stall`: the body never ends. */
type Answer = { status: number; headers?: object; body?: string; end?: "reset" | "stall" }
/** What the site answers a path: by the user agent asking. */
const routes: Record<string, (req: IncomingMessage) => Answer> = {
	// Refuses a browser's name that doesn't act like a browser; lets an honest client in.
	"/wall": (req) =>
		CHROME.test(req.headers["user-agent"] ?? "") ? { status: 403 } : { status: 200 },
	"/always-403": () => ({ status: 403 }),
	"/404": () => ({ status: 404 }),
	"/503": () => ({ status: 503 }),
	// Behind the wall, a redirect to an internal address.
	"/wall-to-internal": (req) =>
		CHROME.test(req.headers["user-agent"] ?? "")
			? { status: 403 }
			: { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } },
	// Google's challenge for everyone, with a 200.
	"/recaptcha": () => ({ status: 200, body: RECAPTCHA }),
	// Anubis checks clients that say they are browsers, and lets the others in.
	"/anubis": (req) =>
		CHROME.test(req.headers["user-agent"] ?? "") ? { status: 200, body: ANUBIS } : { status: 200 },
	"/cloudflare": () => ({ status: 403, body: CLOUDFLARE }),
	"/cloudflare-503": () => ({ status: 503, body: CLOUDFLARE }),
	"/vercel": () => ({ status: 429, headers: { "retry-after": "60" }, body: VERCEL }),
	"/aws-captcha": () => ({ status: 405, body: AWS_CAPTCHA }),
	// Checks the browser's name, and refuses the honest one outright.
	"/check-then-refuse": (req) =>
		CHROME.test(req.headers["user-agent"] ?? "")
			? { status: 200, body: RECAPTCHA }
			: { status: 403 },
	"/reset-403": () => ({ status: 403, body: "<html>", end: "reset" }),
	"/stall-503": () => ({ status: 503, body: "<html>", end: "stall" }),
	"/feed": () => ({ status: 200, headers: { "content-type": "application/xml" }, body: FEED }),
}

let server: Server
let origin = ""
beforeAll(async () => {
	server = createServer((req, res) => {
		requests.push({ path: req.url ?? "", userAgent: req.headers["user-agent"] ?? "" })
		const answer = routes[req.url ?? ""]?.(req) ?? { status: 404 }
		const { status, headers = {} } = answer
		res.writeHead(status, { "content-type": "text/html", ...headers })
		const through = "<html><title>Through</title><body>Hello</body></html>"
		const body = answer.body ?? (status === 200 ? through : "")
		if (!answer.end) return res.end(body)
		res.flushHeaders()
		res.write(body)
		if (answer.end === "reset") setTimeout(() => res.destroy(), 20)
	})
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	const real = (await vi.importActual<typeof import("undici")>("undici")).fetch
	vi.mocked(undiciFetch).mockImplementation(async (input, init) => {
		const url = new URL(String(input))
		if (url.hostname !== "site.example") throw new Error(`unexpected request to ${url.hostname}`)
		const { dispatcher: _guarded, ...rest } = init ?? {}
		return real(`${origin}${url.pathname}`, rest)
	})
})
beforeEach(() => {
	requests.length = 0
})
afterAll(async () => {
	server.closeAllConnections()
	await new Promise((resolve) => server.close(resolve))
})

const agents = () => requests.map((r) => (CHROME.test(r.userAgent) ? "chrome" : r.userAgent))

describe("a page behind a wall that refuses the browser's name", () => {
	it("is fetched again, once, under Klipstack's own name", async () => {
		const page = await fetchPage("https://site.example/wall")
		expect(page.status).toBe(200)
		expect(page.html).toContain("Through")
		expect(agents()).toEqual(["chrome", "Klipstack/1.0 (+https://klipstack.com)"])
	})

	it("is refused when the honest name is refused too, after one retry", async () => {
		await expect(fetchPage("https://site.example/always-403")).rejects.toMatchObject({
			code: "http_error",
			status: 403,
		})
		expect(requests).toHaveLength(2)
	})

	it.each(["/404", "/503"])("is not retried for %s", async (path) => {
		await expect(fetchPage(`https://site.example${path}`)).rejects.toMatchObject({
			code: "http_error",
		})
		expect(requests).toHaveLength(1)
	})

	it("checks the addresses the retry is redirected to", async () => {
		await expect(fetchPage("https://site.example/wall-to-internal")).rejects.toMatchObject({
			code: "blocked_host",
		})
		expect(requests.map((r) => r.path)).toEqual(["/wall-to-internal", "/wall-to-internal"])
	})

	it("keeps a user agent the caller chose", async () => {
		await expect(
			fetchPage("https://site.example/always-403", { userAgent: "Klipstack/1.0 (feed reader)" }),
		).rejects.toMatchObject({ status: 403 })
		expect(agents()).toEqual(["Klipstack/1.0 (feed reader)"])
	})
})

describe("a bot check sent in place of the page", () => {
	it("is a bot_check, after one retry under Klipstack's own name", async () => {
		await expect(fetchPage("https://site.example/recaptcha")).rejects.toMatchObject({
			code: "bot_check",
			status: 200,
		})
		expect(agents()).toEqual(["chrome", "Klipstack/1.0 (+https://klipstack.com)"])
	})

	it("lets the page through when the wall lets Klipstack's own name in", async () => {
		const page = await fetchPage("https://site.example/anubis")
		expect(page.html).toContain("Through")
		expect(agents()).toEqual(["chrome", "Klipstack/1.0 (+https://klipstack.com)"])
	})

	it("is a bot_check when it comes with an error status", async () => {
		await expect(fetchPage("https://site.example/cloudflare")).rejects.toMatchObject({
			code: "bot_check",
			status: 403,
		})
		await expect(fetchPage("https://site.example/cloudflare-503")).rejects.toMatchObject({
			code: "bot_check",
			status: 503,
		})
		await expect(fetchPage("https://site.example/vercel")).rejects.toMatchObject({
			code: "bot_check",
			status: 429,
			retryAfter: 60,
		})
		await expect(fetchPage("https://site.example/aws-captcha")).rejects.toMatchObject({
			code: "bot_check",
			status: 405,
		})
		expect(requests).toHaveLength(8)
	})

	it("stays the reason when the honest name is refused outright", async () => {
		await expect(fetchPage("https://site.example/check-then-refuse")).rejects.toMatchObject({
			code: "bot_check",
			status: 200,
		})
		expect(agents()).toEqual(["chrome", "Klipstack/1.0 (+https://klipstack.com)"])
	})

	it("is not looked for in an error page that breaks or stalls: the status is the answer", async () => {
		await expect(fetchPage("https://site.example/reset-403")).rejects.toMatchObject({
			code: "http_error",
			status: 403,
		})
		expect(requests).toHaveLength(2)
		const started = Date.now()
		await expect(fetchPage("https://site.example/stall-503")).rejects.toMatchObject({
			code: "http_error",
			status: 503,
		})
		expect(Date.now() - started).toBeLessThan(5_000)
	})

	it("is not looked for in a feed, nor by a caller that turns it off", async () => {
		expect((await fetchPage("https://site.example/feed")).html).toContain("Just a moment...")
		const page = await fetchPage("https://site.example/recaptcha", { botChecks: false })
		expect(page.html).toContain("Checking your browser")
		// A wall on a home page may spare its feed: resolveFeed goes on to the common paths.
		expect((await fetchFeed("https://site.example/recaptcha")).html).toContain("reCAPTCHA")
		expect(requests).toHaveLength(3)
	})

	it("keeps a user agent the caller chose", async () => {
		await expect(
			fetchPage("https://site.example/recaptcha", { userAgent: "Klipstack/1.0 (feed reader)" }),
		).rejects.toMatchObject({ code: "bot_check" })
		expect(agents()).toEqual(["Klipstack/1.0 (feed reader)"])
	})
})
