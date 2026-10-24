import { MOBILE_CLIENT_ID } from "@klipstack/api-contract/auth"
import { db, eq, oauthClient, oauthRefreshToken, user as userTable } from "@klipstack/db"
import { afterAll, describe, expect, it, vi } from "vitest"
import { newsForSidebar } from "./news.server"

// The shipped entries change with every release: these tests bring entries of their own.
vi.mock("~/news", () => {
	const page = (title: string) =>
		`<html><head><title>${title}</title><meta name="description" content="${title}, in short."></head><body><article><p>${title}</p></article></body></html>`
	return {
		NEWS: [
			{ slug: "app", date: "2026-10-02", audience: { unless: "iphone-app" } },
			{ slug: "web", date: "2026-10-01" },
		],
		NEWS_PAGES: Object.fromEntries(
			["app", "web"].flatMap((slug) => [
				[`./${slug}/en.html`, page(`EN ${slug}`)],
				[`./${slug}/es.html`, page(`ES ${slug}`)],
			]),
		),
	}
})

const stamp = `test-news-sidebar-${Date.now()}`
const users: string[] = []
const clients: string[] = []
const now = new Date("2026-10-24T12:00:00Z")

async function reader(prefs: Record<string, unknown> = {}) {
	const id = `${stamp}-${users.length}`
	users.push(id)
	const [row] = await db
		.insert(userTable)
		.values({
			id,
			name: "Reader",
			email: `${id}@example.com`,
			createdAt: new Date("2026-09-01T00:00:00Z"),
			prefs,
		})
		.returning()
	return row!
}

async function signedInTo(userId: string, clientId: string) {
	await db
		.insert(oauthClient)
		.values({ id: `${stamp}-${clientId}`, clientId, name: clientId, redirectUris: [] })
		.onConflictDoNothing({ target: oauthClient.clientId })
	if (clientId !== MOBILE_CLIENT_ID) clients.push(clientId)
	await db.insert(oauthRefreshToken).values({
		id: `${userId}-${clientId}`,
		token: `${userId}-${clientId}`,
		clientId,
		userId,
		scopes: [],
	})
}

const slugs = async (user: Awaited<ReturnType<typeof reader>>) =>
	(await newsForSidebar(user, new Headers(), now)).map((item) => item.slug)

afterAll(async () => {
	for (const id of users) await db.delete(userTable).where(eq(userTable.id, id))
	for (const id of clients) await db.delete(oauthClient).where(eq(oauthClient.clientId, id))
})

describe("newsForSidebar", () => {
	it("is in the reader's language, newest first, without what they closed", async () => {
		const user = await reader({ newsClosed: ["web"] })
		expect(await newsForSidebar({ ...user, locale: "es" }, new Headers(), now)).toEqual([
			{
				slug: "app",
				date: "2026-10-02T00:00:00.000Z",
				title: "ES app",
				description: "ES app, in short.",
			},
		])
		expect(await slugs(await reader())).toEqual(["app", "web"])
	})

	it("leaves out the iPhone app's news for that reader alone, once they signed in to the app", async () => {
		const uses = await reader()
		const other = await reader()
		await signedInTo(uses.id, MOBILE_CLIENT_ID)
		// Another app's sign-in is not the iPhone app's.
		await signedInTo(other.id, `${stamp}-other`)
		expect(await slugs(uses)).toEqual(["web"])
		expect(await slugs(other)).toEqual(["app", "web"])
	})
})
