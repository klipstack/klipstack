import { describe, expect, it, vi } from "vitest"
import { loader, sharedUrl } from "./add"

// Stands in for the save itself: the document row and the extraction job that fetches the URL
// (commands/saving.server.test.ts covers those). These tests only need to see whether the route
// got that far, and the session below names a user with no row for the real one to save under.
const saved = vi.fn().mockResolvedValue({ document: { id: "document" }, created: true })
vi.mock("~/services/documents.server", async (original) => ({
	...(await original<typeof import("~/services/documents.server")>()),
	saveDocument: (...args: unknown[]) => saved(...args),
}))
vi.mock("~/lib/session.server", () => ({ requireUser: () => ({ id: "add-quota-test" }) }))

it("opens the Save link dialog with a shared link, without saving it", async () => {
	const request = new Request(
		"http://localhost/add?title=Post&text=Look%20at%20https://example.com/article%3Fid=1",
		{ headers: { "sec-fetch-site": "cross-site" } },
	)
	let answer: Response | null = null
	try {
		loader({ request } as never)
	} catch (thrown) {
		answer = thrown as Response
	}
	expect(answer?.status).toBe(302)
	expect(answer?.headers.get("location")).toBe(
		"/library?save=https%3A%2F%2Fexample.com%2Farticle%3Fid%3D1",
	)
	expect(saved).not.toHaveBeenCalled()
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
