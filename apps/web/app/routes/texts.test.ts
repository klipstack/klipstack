import { db, inArray, newId, user } from "@klipstack/db"
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
	}
}

it("shows the texts in the language asked for, and the guide in the reader's", async () => {
	expect(await texts("")).toEqual({
		shown: "en",
		guide: "guide-en",
		languages: ["en"],
		first: "bacon-of-studies",
	})
	expect(await texts("?lang=es")).toEqual({
		shown: "es",
		guide: "guide-en",
		languages: ["es"],
		first: "becquer-cartas-literarias",
	})
	// A language there are no texts in: the reader's own.
	expect((await texts("?lang=fr")).shown).toBe("en")
})
