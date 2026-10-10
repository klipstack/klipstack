import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createNoteAutosave, type NoteSaveStatus } from "./note-autosave"

function setup(initial = "") {
	const sent: string[] = []
	const statuses: NoteSaveStatus[] = []
	let release: (() => void) | null = null
	let fail = false
	let hold = false
	const save = vi.fn(async (text: string) => {
		sent.push(text)
		if (hold) await new Promise<void>((r) => (release = r))
		if (fail) throw new Error("offline")
	})
	const autosave = createNoteAutosave({ initial, save, onStatus: (s) => statuses.push(s) })
	return {
		autosave,
		sent,
		statuses,
		save,
		failNext: (v: boolean) => (fail = v),
		holdNext: (v: boolean) => (hold = v),
		release: () => release?.(),
	}
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("note autosave", () => {
	it("saves once after typing stops", async () => {
		const t = setup()
		t.autosave.change("a")
		await vi.advanceTimersByTimeAsync(500)
		t.autosave.change("ab")
		await vi.advanceTimersByTimeAsync(500)
		expect(t.sent).toEqual([])
		await vi.advanceTimersByTimeAsync(300)
		expect(t.sent).toEqual(["ab"])
		expect(t.statuses).toEqual(["saving", "saved"])
	})

	it("flush saves at once and skips unchanged text", async () => {
		const t = setup("same")
		await t.autosave.flush()
		expect(t.save).not.toHaveBeenCalled()
		t.autosave.change("new")
		await t.autosave.flush()
		expect(t.sent).toEqual(["new"])
		await vi.advanceTimersByTimeAsync(1000)
		expect(t.sent).toEqual(["new"])
	})

	it("sends edits made during a save after it returns", async () => {
		const t = setup()
		t.holdNext(true)
		t.autosave.change("one")
		const first = t.autosave.flush()
		t.holdNext(false)
		t.autosave.change("one two")
		await t.autosave.flush()
		expect(t.sent).toEqual(["one"])
		t.release()
		await first
		expect(t.sent).toEqual(["one", "one two"])
		expect(t.autosave.dirty).toBe(false)
	})

	it("keeps the text dirty and reports an error when a save fails", async () => {
		const t = setup()
		t.failNext(true)
		t.autosave.change("lost?")
		await t.autosave.flush()
		expect(t.statuses.at(-1)).toBe("error")
		expect(t.autosave.dirty).toBe(true)
		t.failNext(false)
		await t.autosave.flush()
		expect(t.statuses.at(-1)).toBe("saved")
		expect(t.autosave.dirty).toBe(false)
	})
})
