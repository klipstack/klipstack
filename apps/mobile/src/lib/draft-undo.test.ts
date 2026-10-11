import { describe, expect, it, vi } from "vitest"
import { currentToast, onChange, settled, showToast } from "./article-changes"
import { showUnmarked } from "./draft-undo"

const back = { id: "a", shortlisted: true }

function client(undo: () => Promise<unknown> = async () => ({ items: [back] })) {
	return { articles: { undo: vi.fn(undo) } } as unknown as Parameters<typeof showUnmarked>[0]
}

describe("showUnmarked", () => {
	it("offers Undo when unmarking took the article out of the draft, which puts it back", async () => {
		const c = client()
		const reload = vi.fn()
		const undone = vi.fn()
		const off = onChange(reload)
		showUnmarked(c, { undo: ["token"], removedFromDraft: ["a"] }, undone)
		const toast = currentToast()
		expect(toast?.message).toBe("Removed from your next edition")
		expect(toast?.action?.label).toBe("Undo")
		toast?.action?.run()
		await settled()
		expect(c.articles.undo).toHaveBeenCalledWith("token")
		expect(undone).toHaveBeenCalledWith([back])
		expect(reload).toHaveBeenCalledTimes(1)
		off()
	})

	it("says nothing when no draft lost it, or from a server that doesn't say", () => {
		const before = showToast({ message: "Before" })
		showUnmarked(client(), { undo: ["token"], removedFromDraft: [] })
		showUnmarked(client(), { undo: ["token"] })
		showUnmarked(client(), { undo: [], removedFromDraft: ["a"] })
		expect(currentToast()?.id).toBe(before)
	})

	it("says so when the undo fails", async () => {
		const c = client(async () => {
			throw new Error("offline")
		})
		const undone = vi.fn()
		showUnmarked(c, { undo: ["token"], removedFromDraft: ["a"] }, undone)
		currentToast()?.action?.run()
		await settled()
		await Promise.resolve()
		expect(undone).not.toHaveBeenCalled()
		expect(currentToast()?.message).toBe("Couldn't put it back in your next edition.")
	})
})
