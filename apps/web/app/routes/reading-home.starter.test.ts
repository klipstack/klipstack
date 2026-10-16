import { db, documents, inArray, newId, user } from "@klipstack/db"
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest"
import { findStarterText, starterUrlHash } from "~/lib/starter-texts.server"
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

const userId = `test-reading-home-starter-${newId()}`
const spanishId = `test-reading-home-starter-es-${newId()}`
const veteranId = `test-reading-home-starter-veteran-${newId()}`
beforeAll(async () => {
	await db.insert(user).values([
		{ id: userId, name: "Reader", email: `${userId}@example.com` },
		{ id: spanishId, name: "Lectora", email: `${spanishId}@example.com`, locale: "es" },
		{ id: veteranId, name: "Veteran", email: `${veteranId}@example.com` },
	])
})
beforeEach(() => {
	session.user = { id: userId, name: "Reader", locale: "en" }
})
afterAll(async () => {
	await db.delete(user).where(inArray(user.id, [userId, spanishId, veteranId]))
})

const home = () =>
	loader({
		request: new Request("http://localhost/home"),
		context: {},
		params: {},
	} as never)
const offer = async () => {
	const starter = (await home()).starter
	return starter
		? { guide: starter.guide?.slug ?? null, texts: starter.texts.map((item) => item.slug) }
		: null
}

async function save(slug: string, values: { readAt?: Date; archivedAt?: Date } = {}) {
	const text = findStarterText(slug)!
	await db.insert(documents).values({
		userId,
		sourceUrl: text.url,
		urlHash: starterUrlHash(text),
		status: "ready",
		title: text.title,
		...values,
	})
}

it("offers the starter texts while nothing is left to read, without the ones the reader has", async () => {
	// Nothing saved: the guide, and a text from each topic in turn, in the reader's language.
	expect(await offer()).toEqual({
		guide: "guide-en",
		texts: [
			"bacon-of-studies",
			"chopin-story-of-an-hour",
			"marcus-aurelius-book-two",
			"darwin-earthworms",
		],
	})

	// The guide and a story read and archived: Home is caught up, and offers the next ones.
	await save("guide-en", { readAt: new Date(), archivedAt: new Date() })
	await save("chopin-story-of-an-hour", { readAt: new Date(), archivedAt: new Date() })
	expect((await home()).emptyState?.kind).toBe("caughtUp")
	expect(await offer()).toEqual({
		guide: null,
		texts: [
			"bacon-of-studies",
			"ohenry-gift-of-the-magi",
			"marcus-aurelius-book-two",
			"darwin-earthworms",
		],
	})

	// Something to read: Home is about it, not the shelf.
	await db.insert(documents).values({
		userId,
		sourceUrl: "https://example.com/next",
		urlHash: newId(),
		status: "ready",
		title: "Next",
	})
	expect(await offer()).toBeNull()
})

it("offers a Spanish reader the Spanish texts", async () => {
	session.user = { id: spanishId, name: "Lectora", locale: "es" }
	expect(await offer()).toEqual({
		guide: "guide-es",
		texts: [
			"becquer-cartas-literarias",
			"dario-el-rey-burgues",
			"balmes-la-atencion",
			"sastre-la-avispa-solitaria",
		],
	})
})

it("leaves the guide out for a reader who has saved 10 articles", async () => {
	session.user = { id: veteranId, name: "Veteran", locale: "en" }
	const read = (n: number, deletedAt: Date | null = null) =>
		Array.from({ length: n }, (_, i) => ({
			userId: veteranId,
			sourceUrl: `https://example.com/read-${newId()}-${i}`,
			urlHash: newId(),
			status: "ready" as const,
			title: "Read",
			readAt: new Date(),
			archivedAt: new Date(),
			deletedAt,
		}))
	// Nine, and one in the trash: still new to it.
	await db.insert(documents).values([...read(9), ...read(1, new Date())])
	expect((await home()).emptyState?.kind).toBe("caughtUp")
	expect((await offer())?.guide).toBe("guide-en")
	// The tenth: the books, without the guide.
	await db.insert(documents).values(read(1))
	expect(await offer()).toEqual({
		guide: null,
		texts: [
			"bacon-of-studies",
			"chopin-story-of-an-hour",
			"marcus-aurelius-book-two",
			"darwin-earthworms",
		],
	})
})
