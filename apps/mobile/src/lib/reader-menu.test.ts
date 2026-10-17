import { describe, expect, it } from "vitest"
import { readerActions } from "./reader-menu"

const article = (over: Partial<Parameters<typeof readerActions>[0]> = {}) => ({
	status: "ready" as const,
	trashedAt: null,
	finished: false,
	...over,
})

describe("readerActions", () => {
	it("offers everything for a ready article not finished yet", () => {
		expect([...readerActions(article())].sort()).toEqual(
			["archive", "delete", "finish", "rename", "shortlist", "star", "tags", "unread"].sort(),
		)
	})

	it("drops Mark as Finished once finished, and keeps Mark as Unread", () => {
		const shown = readerActions(article({ finished: true }))
		expect(shown.has("finish")).toBe(false)
		expect(shown.has("unread")).toBe(true)
	})

	it("offers only Restore and Delete Forever in the trash, whatever else it is", () => {
		const trashedAt = "2026-10-01T10:00:00.000Z"
		expect([...readerActions(article({ trashedAt }))]).toEqual(["restore", "purge"])
		expect([...readerActions(article({ trashedAt, status: "failed" }))]).toEqual([
			"restore",
			"purge",
		])
	})

	it("offers Try Again and Delete for a failed save, not Star or Archive", () => {
		expect([...readerActions(article({ status: "failed" }))]).toEqual(["retry", "delete"])
	})

	it("waits for a save under way to finish or unread it", () => {
		const shown = readerActions(article({ status: "processing" }))
		expect(shown.has("finish")).toBe(false)
		expect(shown.has("unread")).toBe(false)
		expect(shown.has("star")).toBe(true)
	})
})
