import { db, documents, eq, newId, readingCompletions, user } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { loader } from "./reading-home"

const session = vi.hoisted(() => ({ user: { id: "", name: "Reader", locale: "en" } }))
vi.mock("~/lib/session.server", () => ({ requireUser: () => session.user }))
vi.mock("~/lib/i18n.server", async () => {
	const { createInstance } = await import("i18next")
	const { resources } = await import("@klipstack/i18n")
	const i18n = createInstance()
	await i18n.init({ resources, fallbackLng: "en", interpolation: { escapeValue: false } })
	return { getInstance: () => i18n }
})

const userId = `test-reading-home-${newId()}`
beforeAll(async () => {
	session.user.id = userId
	await db.insert(user).values({ id: userId, name: "Reader", email: `${userId}@example.com` })
	for (const [title, completedAt] of [
		// Monday 5 October, 00:30 in Santiago: the first day of the week before Sunday the 11th.
		["First day", "2026-10-05T03:30:00Z"],
		// Sunday 4 October, 23:30 in Santiago, but already Monday the 5th in UTC.
		["Before", "2026-10-05T02:30:00Z"],
	] as const) {
		const [doc] = await db
			.insert(documents)
			.values({
				userId,
				sourceUrl: "https://example.com/home",
				urlHash: newId(),
				status: "ready",
				title,
			})
			.returning()
		await db.insert(readingCompletions).values({
			userId,
			documentId: doc!.id,
			cycle: 0,
			completedAt: new Date(completedAt),
			source: "manual",
		})
	}
	// Sunday 11 October 2026, 09:00 in Santiago. Only Date: the database driver keeps its timers.
	vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-11T12:00:00Z") })
})
afterAll(async () => {
	vi.useRealTimers()
	await db.delete(user).where(eq(user.id, userId))
})

const home = (cookie?: string) =>
	loader({
		request: new Request("http://localhost/home", { headers: cookie ? { cookie } : {} }),
		context: {},
		params: {},
	} as never)

describe("Home loader", () => {
	it("counts the past week in the reader's time zone, from their cookie", async () => {
		expect((await home("klip_tz=America%2FSantiago")).finished).toEqual({
			count: 1,
			title: "First day",
		})
	})

	it("counts by UTC days without the cookie", async () => {
		expect((await home()).finished).toEqual({ count: 2, title: null })
	})
})
