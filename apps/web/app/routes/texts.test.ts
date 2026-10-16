import { db, documents, inArray, newId, user } from "@klipstack/db"
import { afterAll, beforeAll, expect, it, vi } from "vitest"
import { loader } from "./texts"

const session = vi.hoisted(() => ({ user: { id: "", name: "Reader", locale: "en" } }))
vi.mock("~/lib/session.server", () => ({ requireUser: () => session.user }))

const userId = `test-texts-${newId()}`
beforeAll(async () => {
	session.user = { id: userId, name: "Reader", locale: "en" }
	await db.insert(user).values({ id: userId, name: "Reader", email: `${userId}@example.com` })
})
afterAll(async () => {
	await db.delete(user).where(inArray(user.id, [userId]))
})

const texts = async (query: string) => {
	const data = await loader({
		request: new Request(`http://localhost/texts${query}`),
		context: {},
		params: {},
	} as never)
	return {
		shown: data.shown,
		guide: data.guide.slug,
		languages: [...new Set(data.shelves.flatMap((shelf) => shelf.items.map((i) => i.language)))],
		first: data.shelves[0]!.items[0]!.slug,
		guideFirst: data.guideFirst,
	}
}

it("shows the texts in the language asked for, and the guide in the reader's", async () => {
	expect(await texts("")).toEqual({
		shown: "en",
		guide: "guide-en",
		languages: ["en"],
		first: "bacon-of-studies",
		guideFirst: true,
	})
	expect(await texts("?lang=es")).toEqual({
		shown: "es",
		guide: "guide-en",
		languages: ["es"],
		first: "becquer-cartas-literarias",
		guideFirst: true,
	})
	// A language there are no texts in: the reader's own.
	expect((await texts("?lang=fr")).shown).toBe("en")
})

it("puts the guide last for a reader who has saved 10 articles, without it", async () => {
	await db.insert(documents).values(
		Array.from({ length: 10 }, (_, i) => ({
			userId,
			sourceUrl: `https://example.com/saved-${i}`,
			urlHash: newId(),
			status: "ready" as const,
			title: "Saved",
		})),
	)
	expect(await texts("")).toMatchObject({ guide: "guide-en", guideFirst: false })
})
