import { describe, expect, it, vi } from "vitest"
import { safeRedirect, sessionMiddleware } from "./session.server"

vi.mock("./auth.server", () => ({ auth: { api: { getSession: async () => null } } }))

/** The headers a response leaves with, after the route set `routeHeaders`. */
async function headersFor(path: string, routeHeaders: Record<string, string> = {}) {
	const response = (await sessionMiddleware(
		{ request: new Request(`http://localhost${path}`), context: { set: () => {} } } as never,
		async () => new Response("", { headers: routeHeaders }),
	)) as Response
	return response.headers
}

describe("sessionMiddleware headers", () => {
	it("keeps every page but home out of search results", async () => {
		expect((await headersFor("/")).get("X-Robots-Tag")).toBeNull()
		for (const path of ["/login", "/library", "/e/Abc123def456/x", "/x"])
			expect((await headersFor(path)).get("X-Robots-Tag")).toBe("noindex")
	})

	it("sends referrers to this site only, unless a public page asks for its origin", async () => {
		expect((await headersFor("/library")).get("Referrer-Policy")).toBe("same-origin")
		const edition = await headersFor("/e/Abc123def456/x", {
			"Referrer-Policy": "strict-origin-when-cross-origin",
		})
		expect(edition.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin")
		const leaky = await headersFor("/library", { "Referrer-Policy": "unsafe-url" })
		expect(leaky.get("Referrer-Policy")).toBe("same-origin")
	})
})

describe("safeRedirect", () => {
	it("lands on Home when no page asked for another", () => {
		expect(safeRedirect(null)).toBe("/home")
		expect(safeRedirect("")).toBe("/home")
	})

	it("keeps a same-origin path and refuses everything else", () => {
		expect(safeRedirect("/read/abc?x=1")).toBe("/read/abc?x=1")
		for (const to of [
			"https://evil.example",
			"//evil.example",
			"/\\evil.example",
			"library",
			"/\t/evil.example",
			"/\n/evil.example",
			"/\r\n/evil.example",
		])
			expect(safeRedirect(to)).toBe("/home")
	})
})
