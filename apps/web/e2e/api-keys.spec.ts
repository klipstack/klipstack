import { apiKeys, db, eq, user } from "@klipstack/db"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { expect, test } from "@playwright/test"
import { createApiKey, signupUser } from "./helpers"

const PAGE = (marker: string) =>
	`<!doctype html><html><head><title>Saved with a key ${marker}</title></head><body><article><h1>Saved with a key</h1><p>${"A page the extension captured. ".repeat(20)}</p></article></body></html>`

/**
 * API keys work only where they are checked: the HTTP API (/api/v1) and MCP. Everywhere else a key
 * must not act as the user, including the browser's save endpoint: a leaked key could otherwise
 * delete the account, mint more keys or download the library.
 */
test("an API key reaches the API and MCP, and is signed out everywhere else", async ({
	page,
	request,
	baseURL,
}) => {
	const email = await signupUser(page, "Key Holder")
	const apiKey = await createApiKey(page, "Extension")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (!owner) throw new Error("no user")
	const auth = { authorization: `Bearer ${apiKey}` }
	const keyCount = async () =>
		(await db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.userId, owner.id))).length

	// `request` sends no cookies: the key is the only credential.
	const marker = `${Date.now()}`
	const saved = await request.post("/api/v1/articles", {
		headers: auth,
		data: { url: `https://example.com/key-${marker}`, html: PAGE(marker) },
	})
	expect(saved.status()).toBe(202)

	const mcp = new Client({ name: "klipstack-e2e", version: "1.0.0" })
	await mcp.connect(
		new StreamableHTTPClientTransport(new URL("/mcp", baseURL), { requestInit: { headers: auth } }),
	)
	expect((await mcp.listTools()).tools.length).toBeGreaterThan(0)
	await mcp.close()

	// Pages and browser endpoints treat the key as no credentials at all.
	const browserSave = await request.post("/api/documents", {
		headers: auth,
		data: { url: `https://example.com/key-${marker}-browser`, source: "extension" },
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
	const search = await request.get("/api/search?q=key", { headers: auth })
	expect(search.status()).toBe(401)

	const keysBefore = await keyCount()
	const deleted = await request.post("/settings/delete", {
		headers: auth,
		form: { confirmEmail: email },
		maxRedirects: 0,
	})
	expect(deleted.status()).toBe(302)
	expect(deleted.headers().location).toBe("/login?redirectTo=%2Fsettings%2Fdelete")
	expect(await db.query.user.findFirst({ where: eq(user.id, owner.id) })).toBeTruthy()

	const minted = await request.post("/settings/api-keys", {
		headers: auth,
		form: { intent: "create", name: "Stolen" },
		maxRedirects: 0,
	})
	expect(minted.status()).toBe(302)
	expect(await keyCount()).toBe(keysBefore)

	const disconnected = await request.post("/settings/connected-apps", {
		headers: auth,
		form: { intent: "disconnect", id: "any" },
		maxRedirects: 0,
	})
	expect(disconnected.status()).toBe(302)

	// The browser session is untouched, and still saves; a key sent along signs the request out.
	await page.goto("/settings/api-keys")
	await expect(page.getByText("Extension", { exact: true })).toBeVisible()
	const withCookies = await page.request.post("/api/documents", {
		data: { url: `https://example.com/key-${marker}-2`, html: PAGE(`${marker}-2`) },
	})
	expect(withCookies.status()).toBe(202)
	const cookiesAndKey = await page.request.post("/api/documents", {
		headers: auth,
		data: { url: `https://example.com/key-${marker}-3` },
	})
	expect(cookiesAndKey.status()).toBe(401)
})
