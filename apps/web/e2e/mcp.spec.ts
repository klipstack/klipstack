import { db, eq, user } from "@klipstack/db"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { type APIRequestContext, expect, type Page, test } from "@playwright/test"
import {
	authorizeUrl,
	catchCallback,
	createOAuthClient,
	pkce,
	signupUser,
	waitForHydration,
	ownClientAddress,
} from "./helpers"
import { insertArticle } from "./seed"

// The OAuth token endpoint's limit is per address: see ownClientAddress.
test.use(ownClientAddress)

/**
 * MCP where it needs a real server: discovery through /.well-known, and OAuth tokens (a browser
 * consent, and our key set fetched over HTTP). The tools themselves are tested with an API key in
 * app/routes/mcp.test.ts, answered in process.
 */

type TextResult = { content: { type: string; text?: string }[]; isError?: boolean }

function text(result: unknown): string {
	return (result as TextResult).content.map((c) => c.text ?? "").join("")
}

/** Calls a tool and parses its JSON result; fails the test on a tool error. */
async function call(mcp: Client, name: string, args: Record<string, unknown> = {}) {
	const result = await mcp.callTool({ name, arguments: args })
	expect((result as TextResult).isError, text(result)).toBeFalsy()
	return JSON.parse(text(result))
}

function toolCall(name: string, args: Record<string, unknown>) {
	return { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }
}

async function connect(baseURL: string, token: string) {
	const client = new Client({ name: "klipstack-e2e", version: "1.0.0" })
	const transport = new StreamableHTTPClientTransport(new URL("/mcp", baseURL), {
		requestInit: { headers: { authorization: `Bearer ${token}` } },
	})
	await client.connect(transport)
	return client
}

/** A signed-up user with one article, for tokens to read. */
async function setupLibrary(page: Page) {
	const email = await signupUser(page, "MCP Reader")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	const articleId = await insertArticle(owner!.id, "Joel", "<p>Do you use source control?</p>")
	return { articleId }
}

/**
 * Runs the OAuth flow for a new app in the signed-in page and returns the token response. With a
 * base URL, the tokens are requested for the /mcp resource. `api` has no cookies, like an app.
 */
async function oauthTokens(
	page: Page,
	api: APIRequestContext,
	name: string,
	scope: string,
	baseURL?: string,
	{
		declineWrite = false,
		client: existing,
	}: { declineWrite?: boolean; client?: { clientId: string; redirectUri: string } } = {},
) {
	const resource = baseURL ? new URL("/mcp", baseURL).href : undefined
	// Registration through a metadata document links the client to /mcp; do the same here.
	const client =
		existing ?? (await createOAuthClient(name, { resources: resource ? [resource] : [] }))
	const { challenge, verifier } = pkce()
	const callback = catchCallback(page, client.redirectUri)
	// prompt=consent: the same app asking again still shows the screen.
	await page.goto(authorizeUrl(client, { challenge, scope, resource, prompt: "consent" }))
	await expect(page).toHaveURL(/\/oauth\/consent\?/)
	await waitForHydration(page)
	if (declineWrite) await page.getByRole("checkbox", { name: /^Change your library/ }).uncheck()
	await page.getByRole("button", { name: "Allow" }).click()
	const code = (await callback).searchParams.get("code") ?? ""
	const res = await api.post("/api/auth/oauth2/token", {
		form: {
			grant_type: "authorization_code",
			code,
			redirect_uri: client.redirectUri,
			client_id: client.clientId,
			code_verifier: verifier,
			...(resource ? { resource } : {}),
		},
	})
	expect(res.status(), await res.text()).toBe(200)
	const tokens = (await res.json()) as {
		access_token: string
		refresh_token?: string
		scope?: string
	}
	return { ...tokens, client }
}

test("unauthenticated requests get a discovery challenge", async ({ request }) => {
	const res = await request.post("/mcp", {
		headers: { accept: "application/json, text/event-stream" },
		data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
	})
	expect(res.status()).toBe(401)
	const challenge = res.headers()["www-authenticate"] ?? ""
	expect(challenge).toContain('resource_metadata="')
	expect(challenge).toContain("/.well-known/oauth-protected-resource/mcp")
	expect(challenge).toContain('scope="library:read"')

	const meta = await request.get("/.well-known/oauth-protected-resource/mcp")
	expect(meta.status()).toBe(200)
	expect(await meta.json()).toMatchObject({
		resource: expect.stringMatching(/\/mcp$/),
		authorization_servers: [expect.stringMatching(/\/api\/auth$/)],
		scopes_supported: ["library:read", "library:write"],
	})

	const badKey = await request.post("/mcp", {
		headers: { authorization: "Bearer klip_not-a-real-key-at-all" },
		data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
	})
	expect(badKey.status()).toBe(401)
})

test("an OAuth token needs library:read and must be issued for /mcp", async ({
	page,
	request,
	baseURL,
}) => {
	test.setTimeout(120_000)
	const { articleId } = await setupLibrary(page)
	const base = baseURL ?? ""

	// A token without library:read is refused with a step-up challenge.
	const idOnly = await oauthTokens(page, request, "Identity App", "openid", base)
	const forbidden = await request.post("/mcp", {
		headers: {
			authorization: `Bearer ${idOnly.access_token}`,
			accept: "application/json, text/event-stream",
		},
		data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
	})
	expect(forbidden.status()).toBe(403)
	expect(forbidden.headers()["www-authenticate"]).toContain('error="insufficient_scope"')
	expect(forbidden.headers()["www-authenticate"]).toContain('scope="library:read"')

	const tokens = await oauthTokens(
		page,
		request,
		"Library App",
		"library:read offline_access",
		base,
	)
	expect(tokens.access_token.split(".")).toHaveLength(3) // a JWT bound to /mcp
	const mcp = await connect(base, tokens.access_token)
	const list = JSON.parse(text(await mcp.callTool({ name: "list_library", arguments: {} })))
	expect(list.items[0].id).toBe(articleId)
	await mcp.close()

	// A token not issued for /mcp (no resource: an opaque token for userinfo) is not accepted here.
	const unbound = await oauthTokens(page, request, "Unbound App", "openid library:read")
	expect(unbound.access_token.split(".")).not.toHaveLength(3)
	const wrongAudience = await request.post("/mcp", {
		headers: { authorization: `Bearer ${unbound.access_token}` },
		data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
	})
	expect(wrongAudience.status()).toBe(401)
})

test("write tools need library:write: a step-up challenge, and the user can decline it", async ({
	page,
	request,
	baseURL,
}) => {
	test.setTimeout(120_000)
	const { articleId: id } = await setupLibrary(page)
	const base = baseURL ?? ""
	const headers = (token: string) => ({
		authorization: `Bearer ${token}`,
		accept: "application/json, text/event-stream",
	})

	// Read-only token: every tool is listed and reads work, but a write asks for library:write.
	const readOnly = await oauthTokens(page, request, "Reader App", "library:read", base)
	const reader = await connect(base, readOnly.access_token)
	expect((await reader.listTools()).tools.map((t) => t.name)).toContain("update_articles")
	expect((await call(reader, "list_library")).items[0].id).toBe(id)
	await expect(
		reader.callTool({ name: "update_articles", arguments: { ids: [id], starred: true } }),
	).rejects.toThrow(/Insufficient scope: required "library:write"/)
	await reader.close()
	const stepUp = await request.post("/mcp", {
		headers: headers(readOnly.access_token),
		data: toolCall("update_articles", { ids: [id], starred: true }),
	})
	expect(stepUp.status()).toBe(403)
	const challenge = stepUp.headers()["www-authenticate"] ?? ""
	expect(challenge).toContain('error="insufficient_scope"')
	expect(challenge).toContain('scope="library:write"')
	expect(challenge).toContain("resource_metadata=")

	// Asked for both, the user clears the write checkbox: the token can only read.
	const declined = await oauthTokens(
		page,
		request,
		"Cautious App",
		"library:read library:write",
		base,
		{ declineWrite: true },
	)
	expect(declined.scope?.split(" ")).toEqual(["library:read"])
	const refused = await request.post("/mcp", {
		headers: headers(declined.access_token),
		data: toolCall("trash_articles", { ids: [id] }),
	})
	expect(refused.status()).toBe(403)
	const feedWrite = await request.post("/mcp", {
		headers: headers(declined.access_token),
		data: toolCall("dismiss_feed_items", { ids: [id] }),
	})
	expect(feedWrite.status()).toBe(403)
	const feedRead = await request.post("/mcp", {
		headers: headers(declined.access_token),
		data: toolCall("list_feed", {}),
	})
	expect(feedRead.status()).not.toBe(403)

	// Granted: writes go through.
	const writer = await oauthTokens(page, request, "Writer App", "library:read library:write", base)
	expect(writer.scope?.split(" ").sort()).toEqual(["library:read", "library:write"])
	const mcp = await connect(base, writer.access_token)
	expect(await call(mcp, "update_articles", { ids: [id], starred: true })).toMatchObject({
		items: [expect.objectContaining({ starred: true })],
	})
	await mcp.close()
})
