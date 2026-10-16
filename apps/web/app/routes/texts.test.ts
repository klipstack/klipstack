import { db, documents, eq, inArray, newId, user } from "@klipstack/db"
import { afterAll, beforeAll, expect, it, vi } from "vitest"
import { findStarterText, starterGuide, starterUrlHash } from "~/lib/starter-texts.server"
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

it("puts the guide last once the reader has it, or has saved 10 articles", async () => {
	const saved = (n: number) =>
		Array.from({ length: n }, () => ({
			userId,
			sourceUrl: `https://example.com/saved-${newId()}`,
			urlHash: newId(),
			status: "ready" as const,
			title: "Saved",
		}))
	try {
		// The guide saved: last, though new.
		const guide = starterGuide("en")
		await db.insert(documents).values({
			userId,
			sourceUrl: guide.url,
			urlHash: starterUrlHash(guide),
			status: "ready",
			title: guide.title,
		})
		expect(await texts("")).toMatchObject({ guide: "guide-en", guideFirst: false })
		await db.delete(documents).where(eq(documents.userId, userId))

		// Nine saved: still first. The tenth: last, without the guide.
		await db.insert(documents).values(saved(9))
		expect((await texts("")).guideFirst).toBe(true)
		await db.insert(documents).values(saved(1))
		expect(await texts("")).toMatchObject({ guide: "guide-en", guideFirst: false })
	} finally {
		await db.delete(documents).where(eq(documents.userId, userId))
	}
})

it("names a linked text's site, and knows when the reader has it", async () => {
	const link = findStarterText("graham-keep-your-identity-small")!
	const book = async () =>
		(
			await loader({
				request: new Request("http://localhost/texts"),
				context: {},
				params: {},
			} as never)
		).shelves
			.flatMap((shelf) => shelf.items)
			.find((item) => item.slug === link.slug)!
	expect(await book()).toMatchObject({ kind: "link", site: "paulgraham.com", articleId: null })
	try {
		const [doc] = await db
			.insert(documents)
			.values({
				userId,
				sourceUrl: link.url,
				urlHash: starterUrlHash(link),
				status: "queued",
				title: "",
			})
			.returning({ id: documents.id })
		expect((await book()).articleId).toBe(doc!.id)
	} finally {
		await db.delete(documents).where(eq(documents.userId, userId))
	}
})
