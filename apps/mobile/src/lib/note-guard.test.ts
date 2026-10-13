import { KlipstackApiError } from "@klipstack/sdk"
import { describe, expect, it } from "vitest"
import { guardNoteSaves, type SavedNote } from "./note-guard"

const changed = (now: SavedNote) =>
	new KlipstackApiError(409, "note_changed", "The note changed since it was read.", {
		details: now,
	})

describe("guardNoteSaves", () => {
	it("says which note each save replaces, moving on with every save", async () => {
		const sent: unknown[] = []
		let n = 0
		const guard = guardNoteSaves({
			at: null,
			send: async (_text, expected) => {
				sent.push(expected)
				return { note: "x", noteUpdatedAt: `t${++n}` }
			},
			onChanged: () => {},
		})
		await guard.save("One.")
		await guard.save("Two.")
		expect(sent).toEqual([{ expectedUpdatedAt: null }, { expectedUpdatedAt: "t1" }])
	})

	it("checks nothing while it doesn't know which note it has", async () => {
		const sent: unknown[] = []
		const guard = guardNoteSaves({
			at: undefined,
			send: async (_text, expected) => {
				sent.push(expected)
				return { note: "x", noteUpdatedAt: "t1" }
			},
			onChanged: () => {},
		})
		await guard.save("One.")
		expect(sent).toEqual([{}])
	})

	it("hands a note changed elsewhere to the reader, fails, and goes over it once told to", async () => {
		const now = { note: "From the web.", noteUpdatedAt: "2026-10-13T05:31:22.765Z" }
		const seen: SavedNote[] = []
		const sent: unknown[] = []
		const guard = guardNoteSaves({
			at: "t1",
			send: async (_text, expected) => {
				sent.push(expected)
				if (expected.expectedUpdatedAt !== "2026-10-13T05:31:22.765Z") throw changed(now)
				return { note: "Mine.", noteUpdatedAt: "t10" }
			},
			onChanged: (n) => seen.push(n),
		})
		await expect(guard.save("Mine.")).rejects.toThrow("changed")
		expect(seen).toEqual([now])
		guard.replaces(now.noteUpdatedAt)
		await guard.save("Mine.")
		expect(sent.at(-1)).toEqual({ expectedUpdatedAt: "2026-10-13T05:31:22.765Z" })
	})

	it("passes other failures on without asking", async () => {
		const seen: SavedNote[] = []
		const guard = guardNoteSaves({
			at: "t1",
			send: async () => {
				throw new Error("offline")
			},
			onChanged: (n) => seen.push(n),
		})
		await expect(guard.save("Mine.")).rejects.toThrow("offline")
		expect(seen).toEqual([])
	})
})
