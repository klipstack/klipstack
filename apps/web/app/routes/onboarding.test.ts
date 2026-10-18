import { db, documents, eq, inArray, newId, user } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { starterGuide } from "~/lib/starter-texts.server"
import { action } from "./onboarding"
import { loader } from "./reading-home"

// The welcome on, for this file: the settings are read when the server starts.
const session = vi.hoisted(() => {
	process.env.WELCOME_FROM_NAME = "Ernesto"
	process.env.WELCOME_FROM_EMAIL = "ernesto@example.com"
	process.env.WELCOME_FROM_PHOTO = "/ernesto.jpg"
	return { user: { id: "", name: "", locale: "en", prefs: {} as Record<string, unknown> } }
})
vi.mock("~/lib/session.server", () => ({ requireUser: () => session.user }))
vi.mock("~/lib/i18n.server", async () => {
	const { createInstance } = await import("i18next")
	const { resources } = await import("@klipstack/i18n")
	const i18n = createInstance()
	await i18n.init({ resources, fallbackLng: "en", interpolation: { escapeValue: false } })
	return { getInstance: () => i18n }
})

const ids = [`test-welcome-route-${newId()}`, `test-welcome-route-es-${newId()}`]
beforeAll(async () => {
	await db.insert(user).values(
		ids.map((id) => ({
			id,
			name: "Ada Lovelace",
			email: `${id}@example.com`,
			prefs: { onboarding: { note: "due" } },
		})),
	)
})
afterAll(async () => {
	await db.delete(user).where(inArray(user.id, ids))
})

const signIn = (
	id: string,
	fields: { name?: string; locale?: string; prefs?: Record<string, unknown> } = {},
) => {
	session.user = {
		id,
		name: "Ada Lovelace",
		locale: "en",
		prefs: { onboarding: { note: "due" } },
		...fields,
	}
}
const home = async () =>
	(
		await loader({
			request: new Request("http://localhost/home"),
			context: {},
			params: {},
		} as never)
	).welcome
const post = (intent: string) =>
	action({
		request: new Request("http://localhost/onboarding", {
			method: "POST",
			body: new URLSearchParams({ intent }),
		}),
		context: {},
		params: {},
	} as never)

describe("POST /onboarding", () => {
	it("refuses an intent it does not know", async () => {
		signIn(ids[0]!)
		expect(await post("something-else")).toMatchObject({ data: { ok: false } })
	})
})

describe("Home's welcome note", () => {
	it("shows while the account has it to come, signed, greeting the reader by first name", async () => {
		signIn(ids[0]!)
		expect(await home()).toEqual({
			name: "Ernesto",
			email: "ernesto@example.com",
			photo: "/ernesto.jpg",
			firstName: "Ada",
		})
		signIn(ids[0]!, { name: "  " })
		expect((await home())?.firstName).toBe("")
		signIn(ids[0]!, { prefs: { onboarding: { note: "2026-10-18T00:00:00.000Z" } } })
		expect(await home()).toBeNull()
		signIn(ids[0]!, { prefs: {} })
		expect(await home()).toBeNull()
	})

	it("closes for good when the reader looks around alone", async () => {
		signIn(ids[0]!)
		expect(await post("explore")).toEqual({ ok: true, articleId: null })
		const [row] = await db.select().from(user).where(eq(user.id, ids[0]!))
		expect(row!.prefs.onboarding?.note).toMatch(/^\d{4}-\d\d-\d\dT/)
	})

	it("opens the guide, in the reader's language, when they ask to be shown around", async () => {
		signIn(ids[1]!, { locale: "es" })
		const answer = await post("guide").catch((thrown: unknown) => thrown)
		expect(answer).toBeInstanceOf(Response)
		const location = (answer as Response).headers.get("location")
		const [doc] = await db.select().from(documents).where(eq(documents.userId, ids[1]!))
		expect(doc!.sourceUrl).toBe(starterGuide("es").url)
		expect(location).toBe(`/read/${doc!.id}`)
	})
})
