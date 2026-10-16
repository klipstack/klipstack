import type { Highlight } from "@klipstack/sdk"
import { describe, expect, it, vi } from "vitest"
import { currentToast } from "./article-changes"
import { offerHighlightUndo } from "./highlight-undo"

const back = { id: "h", quote: "a passage", note: "mine" } as Highlight
type Client = Parameters<typeof offerHighlightUndo>[0]

function client(restore: () => Promise<unknown> = async () => ({ highlight: back })) {
	return { highlights: { restore: vi.fn(restore) } } as unknown as Client & {
		highlights: { restore: ReturnType<typeof vi.fn> }
	}
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("offerHighlightUndo", () => {
	it("brings the highlight back once the delete has landed", async () => {
		const c = client()
		const restored = vi.fn()
		let landed!: () => void
		const deleting = new Promise<void>((resolve) => (landed = resolve))
		offerHighlightUndo(c, { id: "h", note: null }, deleting, restored)
		expect(currentToast()?.message).toBe("Highlight deleted")
		currentToast()?.action?.run()
		await flush()
		// Not before: the restore would find nothing deleted yet.
		expect(c.highlights.restore).not.toHaveBeenCalled()
		landed()
		await flush()
		expect(c.highlights.restore).toHaveBeenCalledWith("h")
		expect(restored).toHaveBeenCalledWith(back)
	})

	it("says the note went too, and keeps the toast longer for it", () => {
		vi.useFakeTimers()
		try {
			offerHighlightUndo(client(), { id: "h", note: "mine" }, Promise.resolve(), vi.fn())
			expect(currentToast()?.message).toBe("Highlight and its note deleted")
			vi.advanceTimersByTime(10_000)
			expect(currentToast()).not.toBeNull()
			vi.advanceTimersByTime(5_000)
			expect(currentToast()).toBeNull()
		} finally {
			vi.useRealTimers()
		}
	})

	it("takes the toast away when the delete fails, and never restores", async () => {
		const c = client()
		offerHighlightUndo(c, { id: "h", note: null }, Promise.reject(new Error("offline")), vi.fn())
		const offer = currentToast()
		await flush()
		expect(currentToast()).toBeNull()
		offer?.action?.run()
		await flush()
		expect(c.highlights.restore).not.toHaveBeenCalled()
	})

	it("says so when the restore fails", async () => {
		const c = client(async () => {
			throw new Error("offline")
		})
		const restored = vi.fn()
		offerHighlightUndo(c, { id: "h", note: null }, Promise.resolve(), restored)
		currentToast()?.action?.run()
		await flush()
		expect(restored).not.toHaveBeenCalled()
		expect(currentToast()?.message).toBe("Couldn't bring the highlight back.")
	})
})
