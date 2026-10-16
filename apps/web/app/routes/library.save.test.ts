import { describe, expect, it, vi } from "vitest"
import { action } from "./library"

// Stands in for the save itself: the document row and the extraction job that fetches the URL
// (commands/saving.server.test.ts covers those). These tests only need to see whether the route
// got that far, and the session below names a user with no row for the real one to save under.
const saved = vi.fn().mockResolvedValue({ document: { id: "document" }, created: true })
vi.mock("~/services/documents.server", async (original) => ({
	...(await original<typeof import("~/services/documents.server")>()),
	saveDocument: (...args: unknown[]) => saved(...args),
}))
vi.mock("~/lib/session.server", () => ({ requireUser: () => ({ id: "library-save-test" }) }))

/** What the Save link dialog posts. */
const post = (url: string) =>
	action({
		request: new Request("http://localhost/library", {
			method: "POST",
			body: new URLSearchParams({ url }),
		}),
	} as never)

describe("several links", () => {
	it("saves each one and answers with their outcomes", async () => {
		saved.mockClear()
		const answer = await post("https://example.com/one\n  https://example.com/two \n\n")
		expect(answer).toMatchObject({
			ok: true,
			batch: [
				{ url: "https://example.com/one", ok: true },
				{ url: "https://example.com/two", ok: true },
			],
		})
		expect(saved).toHaveBeenCalledTimes(2)
	})

	it("refuses more than ten, keeping what was typed", async () => {
		saved.mockClear()
		const links = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`).join("\n")
		expect(await post(links)).toMatchObject({
			data: { ok: false, error: { code: "invalid_request" }, url: links },
			init: { status: 400 },
		})
		expect(saved).not.toHaveBeenCalled()
	})
})
