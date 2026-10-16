import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { fetch as undiciFetch } from "undici"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
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
/** What the site answers a path: by the user agent asking. */
const routes: Record<string, (req: IncomingMessage) => { status: number; headers?: object }> = {
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
}

let server: Server
let origin = ""
beforeAll(async () => {
	server = createServer((req, res) => {
		requests.push({ path: req.url ?? "", userAgent: req.headers["user-agent"] ?? "" })
		const { status, headers = {} } = routes[req.url ?? ""]?.(req) ?? { status: 404 }
		res.writeHead(status, { "content-type": "text/html", ...headers })
		res.end(status === 200 ? "<html><title>Through</title><body>Hello</body></html>" : "")
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

	it("keeps the address checks on the retry", async () => {
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
