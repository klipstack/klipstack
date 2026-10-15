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
beforeAll(async () => {
	await db.insert(user).values([
		{ id: userId, name: "Reader", email: `${userId}@example.com` },
		{ id: spanishId, name: "Lectora", email: `${spanishId}@example.com`, locale: "es" },
	])
})
beforeEach(() => {
	session.user = { id: userId, name: "Reader", locale: "en" }
})
afterAll(async () => {
	await db.delete(user).where(inArray(user.id, [userId, spanishId]))
})

const home = () =>
	loader({
		request: new Request("http://localhost/home"),
		context: {},
		params: {},
	} as never)
const slugs = async () => (await home()).starter?.map((item) => item.slug) ?? null

it("offers the starter texts while nothing is left to read, without the ones the reader has", async () => {
	// Nothing saved: the guide and the first essays, in the reader's language.
	expect(await slugs()).toEqual([
		"guide-en",
		"bacon-of-studies",
		"seneca-on-reading",
		"stevenson-books-influenced",
	])

	// The guide read and archived: Home is caught up, and still offers the rest.
	const guide = findStarterText("guide-en")!
	await db.insert(documents).values({
		userId,
		sourceUrl: guide.url,
		urlHash: starterUrlHash(guide),
		status: "ready",
		title: guide.title,
		readAt: new Date(),
		archivedAt: new Date(),
	})
	expect((await home()).emptyState?.kind).toBe("caughtUp")
	expect(await slugs()).toEqual([
		"bacon-of-studies",
		"seneca-on-reading",
		"stevenson-books-influenced",
		"hazlitt-familiar-style",
	])

	// Something to read: Home is about it, not the shelf.
	await db.insert(documents).values({
		userId,
		sourceUrl: "https://example.com/next",
		urlHash: newId(),
		status: "ready",
		title: "Next",
	})
	expect(await slugs()).toBeNull()
})

it("offers a Spanish reader the Spanish texts", async () => {
	session.user = { id: spanishId, name: "Lectora", locale: "es" }
	expect(await slugs()).toEqual([
		"guide-es",
		"becquer-cartas-literarias",
		"feijoo-prologo-al-lector",
		"cervantes-prologo-quijote",
	])
})
