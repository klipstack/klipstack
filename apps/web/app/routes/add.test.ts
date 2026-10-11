import { describe, expect, it, vi } from "vitest"
import { rateLimit, SAVE_LIMIT } from "~/lib/rate-limit.server"
import { action, loader, sharedUrl } from "./add"

// Stands in for the save itself: the document row and the extraction job that fetches the URL
// (commands/saving.server.test.ts covers those). These tests only need to see whether the route
// got that far, and the session below names a user with no row for the real one to save under.
const saved = vi.fn().mockResolvedValue({ document: { id: "document" }, created: true })
vi.mock("~/services/documents.server", async (original) => ({
	...(await original<typeof import("~/services/documents.server")>()),
	saveDocument: (...args: unknown[]) => saved(...args),
}))
vi.mock("~/lib/session.server", () => ({ requireUser: () => ({ id: "add-quota-test" }) }))

it("prefills a cross-site GET without saving or enqueueing work", async () => {
	const request = new Request("http://localhost/add?url=https://example.com/article", {
		headers: { "sec-fetch-site": "cross-site" },
	})
	expect(await loader({ request } as never)).toEqual({ url: "https://example.com/article" })
	expect(saved).not.toHaveBeenCalled()
})

it("requires POST and shares the existing save bucket", async () => {
	const request = () =>
		new Request("http://localhost/add", {
			method: "POST",
			body: new URLSearchParams({ url: "https://example.com/article" }),
		})
	await expect(action({ request: request() } as never)).rejects.toMatchObject({ status: 302 })
	expect(saved).toHaveBeenCalledTimes(1)
	for (let i = 1; i < SAVE_LIMIT.limit; i++)
		rateLimit("save:add-quota-test", SAVE_LIMIT.limit, SAVE_LIMIT.windowMs)
	// Past the limit, the form says so, with the URL still in it.
	expect(await action({ request: request() } as never)).toMatchObject({
		data: { ok: false, error: { code: "rate_limited" }, url: "https://example.com/article" },
		init: { status: 429 },
	})
	expect(saved).toHaveBeenCalledTimes(1)
})

describe("sharedUrl", () => {
	it("prefers an explicit url", () => {
		expect(sharedUrl(new URLSearchParams({ url: "https://a.com/x", text: "https://b.com" }))).toBe(
			"https://a.com/x",
		)
	})
	it("finds the link inside shared text (Android share sheets)", () => {
		expect(
			sharedUrl(new URLSearchParams({ text: "Look at this https://a.com/post?id=1 amazing" })),
		).toBe("https://a.com/post?id=1")
		expect(sharedUrl(new URLSearchParams({ title: "Post", text: "no link here" }))).toBeNull()
	})
})
