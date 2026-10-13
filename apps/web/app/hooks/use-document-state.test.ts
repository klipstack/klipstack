import { describe, expect, it } from "vitest"
import { reloaded } from "./use-document-state"

const none = { starred: false, shortlisted: false, archived: false, finished: false }

describe("reloaded", () => {
	it("keeps a change this page made since the last load, and asks again, when the row predates it", () => {
		// Marked for the edition while the load after opening was on its way, with the old row.
		const confirmed = { ...none, shortlisted: true }
		expect(reloaded(confirmed, ["shortlisted"], none)).toEqual({ shown: confirmed, recheck: true })
	})

	it("takes the row for every flag this page did not change since the last load", () => {
		// Starred here before the last load; unstarred elsewhere since: the row is the truth.
		const confirmed = { ...none, starred: true, shortlisted: true }
		const now = { ...none, archived: true }
		expect(reloaded(confirmed, ["shortlisted"], now)).toEqual({
			shown: { ...none, shortlisted: true, archived: true },
			recheck: true,
		})
		expect(reloaded(confirmed, [], now)).toEqual({ shown: now, recheck: false })
	})

	it("asks nothing again when the row agrees", () => {
		const confirmed = { ...none, shortlisted: true }
		expect(reloaded(confirmed, ["shortlisted"], confirmed)).toEqual({
			shown: confirmed,
			recheck: false,
		})
	})
})
