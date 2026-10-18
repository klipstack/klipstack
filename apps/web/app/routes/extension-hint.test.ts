import { db, documents, inArray, newId, user } from "@klipstack/db"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { loader as libraryLoader } from "./library"
import { loader as homeLoader } from "./reading-home"

const session = vi.hoisted(() => ({ user: { id: "", name: "Reader", locale: "en" } }))
vi.mock("~/lib/session.server", () => ({ requireUser: () => session.user }))
vi.mock("~/lib/i18n.server", async () => {
	const { createInstance } = await import("i18next")
	const { resources } = await import("@klipstack/i18n")
	const i18n = createInstance()
	await i18n.init({ resources, fallbackLng: "en", interpolation: { escapeValue: false } })
	return { getInstance: () => i18n }
})
// The store's extension saves to klipstack.com only: the server these loaders think they are.
const server = vi.hoisted(() => ({ appUrl: "https://klipstack.com" }))
vi.mock("~/lib/env.server", async (original) => {
	const actual = await original<typeof import("~/lib/env.server")>()
	return {
		...actual,
		env: new Proxy(actual.env, {
			get: (target, key) => (key === "APP_URL" ? server.appUrl : Reflect.get(target, key)),
		}),
	}
})

const STORE = /^https:\/\/chromewebstore\.google\.com\//
const ids: string[] = []
let userId: string

beforeEach(async () => {
	server.appUrl = "https://klipstack.com"
	userId = `test-extension-hint-route-${newId()}`
	ids.push(userId)
	session.user = { id: userId, name: "Reader", locale: "en" }
	await db.insert(user).values({ id: userId, name: "Reader", email: `${userId}@example.com` })
})
afterAll(async () => {
	await db.delete(user).where(inArray(user.id, ids))
})

/** Desktop Chrome, which the store's extension installs in. */
const chrome = {
	"sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142"',
	"sec-ch-ua-mobile": "?0",
}
const args = (url: string, headers: Record<string, string> = chrome) =>
	({ request: new Request(url, { headers }), context: {}, params: {} }) as never
const home = (headers?: Record<string, string>) =>
	homeLoader(args("http://localhost/home", headers))
const inbox = (search = "") => libraryLoader(args(`http://localhost/library${search}`))

const save = (fields: Partial<typeof documents.$inferInsert> = {}) =>
	db.insert(documents).values({
		userId,
		sourceUrl: `https://example.com/${newId()}`,
		urlHash: newId(),
		status: "ready",
		title: "An article",
		...fields,
	})

describe("the extension hint on empty screens", () => {
	it("shows on Home with nothing saved, and once everything is read", async () => {
		const empty = await home()
		expect(empty.emptyState?.kind).toBe("new")
		expect(empty.extensionHint).toMatch(STORE)

		await save({ readAt: new Date(), archivedAt: new Date() })
		const caughtUp = await home()
		expect(caughtUp.emptyState?.kind).toBe("caughtUp")
		expect(caughtUp.extensionHint).toMatch(STORE)
	})

	it("stays off Home while articles are being prepared, and when there is something to read", async () => {
		await save({ status: "queued" })
		const processing = await home()
		expect(processing.emptyState?.kind).toBe("processing")
		expect(processing.extensionHint).toBeNull()

		await save()
		const reading = await home()
		expect(reading.emptyState).toBeNull()
		expect(reading.extensionHint).toBeNull()
	})

	it("shows on the empty Inbox, not on a filtered one", async () => {
		expect((await inbox()).extensionHint).toMatch(STORE)
		expect((await inbox("?show=unread")).extensionHint).toBeNull()
	})

	it("stays off on a phone, in another browser, and on a server the extension doesn't save to", async () => {
		expect((await home({ ...chrome, "sec-ch-ua-mobile": "?1" })).extensionHint).toBeNull()
		expect((await home({})).extensionHint).toBeNull()
		server.appUrl = "https://read.example.com"
		expect((await home()).extensionHint).toBeNull()
		expect((await inbox()).extensionHint).toBeNull()
	})
})
