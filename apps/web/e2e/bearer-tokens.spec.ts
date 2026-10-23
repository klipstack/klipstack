import { db, eq, user } from "@klipstack/db"
import { expect, test } from "@playwright/test"
import { connectApp, signupUser } from "./helpers"

const PAGE = (marker: string) =>
	`<!doctype html><html><head><title>Saved by an app ${marker}</title></head><body><article><h1>Saved by an app</h1><p>${"A page the extension captured. ".repeat(20)}</p></article></body></html>`

/**
 * An app's access token works only where it is checked: the HTTP API (/api/v1) and MCP. Everywhere
 * else it must not act as the user, including the browser's save endpoint, even sent along with the
 * session's cookies: a leaked token could otherwise delete the account or download the library.
 */
test("an app's token reaches the API, and is signed out everywhere else", async ({
	page,
	request,
	baseURL,
}) => {
	const email = await signupUser(page, "Token Holder")
	const token = await connectApp(page, request, baseURL ?? "", "Token App")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (!owner) throw new Error("no user")
	const auth = { authorization: `Bearer ${token}` }

	// `request` sends no cookies: the token is the only credential.
	const marker = `${Date.now()}`
	const saved = await request.post("/api/v1/articles", {
		headers: auth,
		data: { url: `https://example.com/token-${marker}`, html: PAGE(marker) },
	})
	expect(saved.status()).toBe(202)

	// Pages and browser endpoints treat the token as no credentials at all.
	const browserSave = await request.post("/api/documents", {
		headers: auth,
		data: { url: `https://example.com/token-${marker}-browser`, source: "extension" },
	})
	expect(browserSave.status()).toBe(401)
	for (const path of [
		"/settings",
		"/library",
		"/export?format=json",
		"/assets/00000000-0000-7000-8000-000000000000",
	]) {
		const res = await request.get(path, { headers: auth, maxRedirects: 0 })
		expect(res.status(), path).toBe(302)
		expect(res.headers().location, path).toMatch(/^\/login\?redirectTo=/)
	}
	const search = await request.get("/api/search?q=token", { headers: auth })
	expect(search.status()).toBe(401)

	const deleted = await request.post("/settings/delete", {
		headers: auth,
		form: { confirmEmail: email },
		maxRedirects: 0,
	})
	expect(deleted.status()).toBe(302)
	expect(deleted.headers().location).toBe("/login?redirectTo=%2Fsettings%2Fdelete")
	expect(await db.query.user.findFirst({ where: eq(user.id, owner.id) })).toBeTruthy()

	const disconnected = await request.post("/settings/connected-apps", {
		headers: auth,
		form: { intent: "disconnect", id: "any" },
		maxRedirects: 0,
	})
	expect(disconnected.status()).toBe(302)

	// The browser session is untouched: where API keys were, older iPhone builds land on Connected
	// apps, which still lists the app.
	await page.goto("/settings/api-keys")
	await expect(page).toHaveURL(/\/settings\/connected-apps$/)
	await expect(page.getByText("Token App", { exact: true })).toBeVisible()
	// The session still saves; a token sent along signs the request out.
	const withCookies = await page.request.post("/api/documents", {
		data: { url: `https://example.com/token-${marker}-2`, html: PAGE(`${marker}-2`) },
	})
	expect(withCookies.status()).toBe(202)
	const cookiesAndToken = await page.request.post("/api/documents", {
		headers: auth,
		data: { url: `https://example.com/token-${marker}-3` },
	})
	expect(cookiesAndToken.status()).toBe(401)
})
