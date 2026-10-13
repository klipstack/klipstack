import { describe, expect, it } from "vitest"
import { reloaded } from "./use-document-state"

const none = { starred: false, shortlisted: false, archived: false, finished: false }

describe("reloaded", () => {
	it("keeps a change this page confirmed when the new load predates it", () => {
		// Marked for the edition while the load after opening was on its way, with the old row.
		const confirmed = { ...none, shortlisted: true }
		expect(reloaded(none, confirmed, none)).toEqual(confirmed)
	})

	it("takes what the server's row changed", () => {
		const confirmed = { ...none, shortlisted: true }
		const now = { ...none, starred: true, archived: true }
		expect(reloaded(none, confirmed, now)).toEqual({
			starred: true,
			shortlisted: true,
			archived: true,
			finished: false,
		})
		// Unmarked elsewhere: the row says so, against what this page last saw.
		const marked = { ...none, shortlisted: true }
		expect(reloaded(marked, marked, none)).toEqual(none)
	})
})
