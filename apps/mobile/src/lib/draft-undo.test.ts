import { describe, expect, it, vi } from "vitest"
import { currentToast, onChange, settled, showToast } from "./article-changes"
import { afterMarking, withUndone } from "./draft-undo"

const back = { id: "a", shortlisted: true }
const unmarked = { id: "a", shortlisted: false }
type Answer = Parameters<typeof afterMarking>[2]
// Only the fields the toast reads.
const answer = (more: { [K in keyof Answer]?: unknown } = {}) =>
	({ items: [unmarked], undo: ["token"], removedFromDraft: ["a"], ...more }) as Answer

function client(undo: () => Promise<unknown> = async () => ({ items: [back] })) {
	return { articles: { undo: vi.fn(undo) } } as unknown as Parameters<typeof afterMarking>[0]
}

describe("afterMarking", () => {
	it("offers Undo when unmarking took the article out of the draft, which puts it back", async () => {
		const c = client()
		const reload = vi.fn()
		const undone = vi.fn()
		const off = onChange(reload)
		afterMarking(c, { shortlisted: false }, answer(), undone)
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

	it("says nothing when no draft lost it, from a server that doesn't say, or for other changes", () => {
		const before = showToast({ message: "Before" })
		afterMarking(client(), { shortlisted: false }, answer({ removedFromDraft: [] }))
		afterMarking(client(), { shortlisted: false }, answer({ removedFromDraft: undefined }))
		afterMarking(client(), { shortlisted: false }, answer({ undo: [] }))
		afterMarking(client(), { starred: true }, answer())
		afterMarking(client(), { shortlisted: true }, answer({ items: [back] }))
		expect(currentToast()?.id).toBe(before)
	})

	it("takes the offer away when the article is marked again: the undo would restore nothing", () => {
		afterMarking(client(), { shortlisted: false }, answer())
		const offer = currentToast()
		afterMarking(client(), { shortlisted: true }, answer({ items: [{ ...back, id: "b" }] }))
		expect(currentToast()).toBe(offer)
		afterMarking(client(), { shortlisted: true }, answer({ items: [back], removedFromDraft: [] }))
		expect(currentToast()).toBeNull()
	})

	it("says so when the undo fails", async () => {
		const c = client(async () => {
			throw new Error("offline")
		})
		const undone = vi.fn()
		afterMarking(c, { shortlisted: false }, answer(), undone)
		currentToast()?.action?.run()
		await settled()
		await Promise.resolve()
		expect(undone).not.toHaveBeenCalled()
		expect(currentToast()?.message).toBe("Couldn't put it back in your next edition.")
	})
})

describe("withUndone", () => {
	it("marks the reader's article again, and leaves another's alone", () => {
		const article = { id: "a", shortlisted: false, title: "Kept" }
		expect(withUndone(article, [back])).toEqual({ id: "a", shortlisted: true, title: "Kept" })
		expect(withUndone(article, [{ id: "b", shortlisted: true }])).toBe(article)
		expect(withUndone(null, [back])).toBeNull()
	})
})
