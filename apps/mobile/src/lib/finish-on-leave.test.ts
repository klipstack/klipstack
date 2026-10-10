import { describe, expect, it, vi } from "vitest"
import { currentToast, onChange, settled } from "./article-changes"
import { finishOnLeave } from "./finish-on-leave"

function client(undo: string[] = ["token"]) {
	return {
		articles: {
			update: vi.fn(async () => ({ items: [], notFound: [], undo })),
			undo: vi.fn(async () => ({ items: [] })),
		},
	} as unknown as Parameters<typeof finishOnLeave>[0]
}

describe("finishOnLeave", () => {
	it("finishes, lists wait for it, and the toast undoes it", async () => {
		const c = client()
		const reload = vi.fn()
		const off = onChange(reload)
		void finishOnLeave(c, "a", false)
		await settled()
		expect(c.articles.update).toHaveBeenCalledWith(["a"], { finished: true })
		expect(reload).toHaveBeenCalledTimes(1)
		const toast = currentToast()
		expect(toast?.message).toBe("Finished and Archived")
		toast?.action?.run()
		await settled()
		expect(c.articles.undo).toHaveBeenCalledWith("token")
		expect(reload).toHaveBeenCalledTimes(2)
		off()
	})

	it("says only finished for an archived article, and nothing when nothing changed", async () => {
		void finishOnLeave(client(), "a", true)
		await settled()
		expect(currentToast()?.message).toBe("Marked as Finished")
		const before = currentToast()
		void finishOnLeave(client([]), "b", false)
		await settled()
		expect(currentToast()).toBe(before)
	})
})
