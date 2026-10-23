import { db, documents, eq, user } from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import type { KlipstackApiError } from "@klipstack/sdk"
import { afterAll, describe, expect, it } from "vitest"
import { apiUsers, request } from "~/test/api-harness"

/** The starter texts through /api/v1, as the iPhone's Discover screen and empty Home call them. */

const users = apiUsers("api-starter")
afterAll(async () => {
	await users.cleanup()
	await stopBoss()
})

const errorOf = (promise: Promise<unknown>) =>
	promise.then(
		() => {
			throw new Error("expected the call to fail")
		},
		(e: unknown) => e as KlipstackApiError,
	)

async function spanish() {
	const reader = await users.create("Lectora")
	await db.update(user).set({ locale: "es" }).where(eq(user.id, reader.id))
	return reader
}

describe("GET /starter-texts", () => {
	it("lists the shelves in the account's language, or the one asked, with the guide in the account's", async () => {
		const reader = await spanish()
		const own = await reader.client.starterTexts.list()
		expect(own).toMatchObject({
			language: "es",
			readerLanguage: "es",
			guide: { slug: "guide-es", kind: "guide", topic: null, articleId: null },
			guideFirst: true,
		})
		expect(own.shelves.map((shelf) => shelf.topic)).toEqual([
			"reading",
			"stories",
			"living",
			"ideas",
			"science",
			"society",
		])
		expect(own.shelves[1]!.items[0]).toMatchObject({
			slug: "dario-el-rey-burgues",
			kind: "text",
			language: "es",
			topic: "stories",
			author: "Rubén Darío",
			site: null,
			articleId: null,
		})

		const english = await reader.client.starterTexts.list("en")
		expect(english).toMatchObject({ language: "en", readerLanguage: "es" })
		// The guide is about the app: in the reader's language whichever texts are shown.
		expect(english.guide.slug).toBe("guide-es")
		expect(english.shelves.map((shelf) => shelf.topic)).toEqual([
			"reading",
			"stories",
			"living",
			"ideas",
			"science",
			"society",
		])
		const ideas = english.shelves.find((shelf) => shelf.topic === "ideas")!.items
		// A text on its author's site names the site.
		expect(ideas.find((item) => item.slug === "graham-do-things-that-dont-scale")).toMatchObject({
			kind: "link",
			site: "paulgraham.com",
			author: "Paul Graham",
			minutes: 19,
		})
	})

	it("marks the reader's own copies, and puts the guide last once they have it", async () => {
		const reader = await users.create("Reader")
		const other = await users.create("Other")
		const guide = await reader.client.starterTexts.save("guide-en")
		const story = await reader.client.starterTexts.save("poe-tell-tale-heart")

		const mine = await reader.client.starterTexts.list()
		expect(mine.guide.articleId).toBe(guide.articleId)
		expect(mine.guideFirst).toBe(false)
		const stories = mine.shelves.find((shelf) => shelf.topic === "stories")!.items
		expect(stories.find((item) => item.slug === "poe-tell-tale-heart")?.articleId).toBe(
			story.articleId,
		)
		expect(stories.find((item) => item.slug === "chopin-story-of-an-hour")?.articleId).toBeNull()

		// Someone else's copies are not theirs.
		const theirs = await other.client.starterTexts.list()
		expect(theirs.guide.articleId).toBeNull()
		expect(theirs.guideFirst).toBe(true)
	})

	it("refuses a language it doesn't have", async () => {
		const reader = await users.create("Reader")
		const answer = await request("/api/v1/starter-texts?language=fr", { token: reader.token })
		expect(answer.status).toBe(400)
		expect(await answer.json()).toMatchObject({ error: { code: "invalid_request" } })
	})
})

describe("GET /starter-texts/offer", () => {
	it("offers the guide and a text from each topic in turn, without the ones the reader has", async () => {
		const reader = await users.create("Reader")
		const slugs = async () => {
			const offer = await reader.client.starterTexts.offer()
			return { guide: offer.guide?.slug ?? null, texts: offer.texts.map((item) => item.slug) }
		}
		expect(await slugs()).toEqual({
			guide: "guide-en",
			texts: [
				"bacon-of-studies",
				"chopin-story-of-an-hour",
				"marcus-aurelius-book-two",
				"faraday-candle-lecture-one",
			],
		})
		await reader.client.starterTexts.save("guide-en")
		await reader.client.starterTexts.save("chopin-story-of-an-hour")
		expect(await slugs()).toEqual({
			guide: null,
			texts: [
				"bacon-of-studies",
				"ohenry-gift-of-the-magi",
				"marcus-aurelius-book-two",
				"faraday-candle-lecture-one",
			],
		})
	})

	it("offers them in the account's language", async () => {
		const reader = await spanish()
		const offer = await reader.client.starterTexts.offer()
		expect(offer.guide?.slug).toBe("guide-es")
		expect(offer.texts.map((item) => item.language)).toEqual(["es", "es", "es", "es"])
	})
})

describe("POST /starter-texts/:slug/save", () => {
	it("adds the text to the library as an API save, and finds the copy the second time", async () => {
		const reader = await users.create("Reader")
		const first = await reader.client.starterTexts.save("bacon-of-studies")
		expect(first.created).toBe(true)
		const [doc] = await db.select().from(documents).where(eq(documents.id, first.articleId))
		expect(doc).toMatchObject({
			userId: reader.id,
			sourceUrl: "https://en.wikisource.org/wiki/The_Essays_of_Francis_Bacon/L_Of_Studies",
			captureSource: "api",
		})
		expect(await reader.client.starterTexts.save("bacon-of-studies")).toEqual({
			articleId: first.articleId,
			created: false,
		})
	})

	it("answers not_found for a name that is no starter text", async () => {
		const reader = await users.create("Reader")
		const error = await errorOf(reader.client.starterTexts.save("no-such-text"))
		expect(error).toMatchObject({ status: 404, code: "not_found" })
	})
})
