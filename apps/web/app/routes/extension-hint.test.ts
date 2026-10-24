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

// Safari's extension until it is in the Mac App Store (`null`), or once it is.
const safari = vi.hoisted(() => ({ store: null as string | null }))
vi.mock("@klipstack/email/extension-url", async (original) => {
	const actual = await original<typeof import("@klipstack/email/extension-url")>()
	return {
		...actual,
		get SAFARI_STORE() {
			return safari.store
		},
	}
})

const PAGE = "https://klipstack.com/extension"
const ids: string[] = []
let userId: string

beforeEach(async () => {
	server.appUrl = "https://klipstack.com"
	safari.store = null
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
		expect(empty.extensionHint).toBe(PAGE)

		await save({ readAt: new Date(), archivedAt: new Date() })
		const caughtUp = await home()
		expect(caughtUp.emptyState?.kind).toBe("caughtUp")
		expect(caughtUp.extensionHint).toBe(PAGE)
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
		expect((await inbox()).extensionHint).toBe(PAGE)
		expect((await inbox("?show=unread")).extensionHint).toBeNull()
	})

	it("stays off on a phone, in another browser, and on a server the extension doesn't save to", async () => {
		expect((await home({ ...chrome, "sec-ch-ua-mobile": "?1" })).extensionHint).toBeNull()
		expect((await home({})).extensionHint).toBeNull()
		server.appUrl = "https://read.example.com"
		expect((await home()).extensionHint).toBeNull()
		expect((await inbox()).extensionHint).toBeNull()
	})

	it("shows in Safari on a Mac only once its extension is in the Mac App Store", async () => {
		const mac = {
			"user-agent":
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
		}
		const iphone = {
			"user-agent":
				"Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
		}
		expect((await home(mac)).extensionHint).toBeNull()
		safari.store = "https://apps.apple.com/app/id1"
		expect((await home(mac)).extensionHint).toBe(PAGE)
		expect((await home(iphone)).extensionHint).toBeNull()
	})
})
