import { connect } from "node:net"
import {
	CLI_CLIENT_ID,
	CLI_SCOPES,
	LIBRARY_WRITE_SCOPE,
	MOBILE_CLIENT_ID,
	MOBILE_REDIRECT_URI,
	MOBILE_SCOPES,
} from "@klipstack/api-contract/auth"
import { CLIENT_HEADER } from "@klipstack/api-contract/client"
import { db, documentRaw, eq } from "@klipstack/db"
import { createClient, KlipstackApiError, type KlipstackClient } from "@klipstack/sdk"
import { type APIRequestContext, expect, type Page, test } from "@playwright/test"
import {
	authorizeUrl,
	catchCallback,
	createApiKey,
	createOAuthClient,
	pkce,
	signupUser,
	waitForHydration,
} from "./helpers"

const MISSING = "00000000-0000-4000-8000-000000000000"

/**
 * The HTTP API at /api/v1 where it needs a real server: signing in through OAuth, and bodies the
 * server refuses before or while reading them. Everything else is in app/routes/api.v1.test.ts,
 * answered in process.
 */

const sdk = (baseURL: string, token: string) =>
	createClient({ baseUrl: baseURL, token: () => token, userAgent: "klipstack-e2e/1.0" })

async function tokens(
	api: APIRequestContext,
	client: { clientId: string; redirectUri: string },
	code: string,
	verifier: string,
	resource: string,
) {
	const res = await api.post("/api/auth/oauth2/token", {
		form: {
			grant_type: "authorization_code",
			code,
			redirect_uri: client.redirectUri,
			client_id: client.clientId,
			code_verifier: verifier,
			resource,
		},
	})
	expect(res.status(), await res.text()).toBe(200)
	return (await res.json()) as { access_token: string; refresh_token?: string; scope?: string }
}

/**
 * Signs the CLI in the way `klip auth login` does: the first-party client, a loopback redirect on
 * a random port, `prompt=consent` so the screen always shows, and tokens for the /api resource.
 */
async function cliLogin(
	page: Page,
	api: APIRequestContext,
	base: string,
	{ readOnly = false, declineWrite = false } = {},
) {
	const scope = CLI_SCOPES.filter((s) => !readOnly || s !== LIBRARY_WRITE_SCOPE).join(" ")
	// The registered redirect URI is portless; the CLI listens on any port.
	const client = { clientId: CLI_CLIENT_ID, redirectUri: "http://127.0.0.1:47123/callback" }
	const resource = `${base}/api`
	const { challenge, verifier } = pkce()
	const callback = catchCallback(page, client.redirectUri)
	await page.goto(authorizeUrl(client, { challenge, scope, resource, prompt: "consent" }))
	await expect(page).toHaveURL(/\/oauth\/consent\?/)
	await expect(
		page.getByText("Klipstack CLI wants to access your Klipstack account."),
	).toBeVisible()
	await expect(
		page.getByText("Only allow this if you just ran klip auth login on your computer."),
	).toBeVisible()
	await expect(page.getByText("Klipstack has not verified this app")).toHaveCount(0)
	await waitForHydration(page)
	if (declineWrite) await page.getByRole("checkbox", { name: /^Change your library/ }).uncheck()
	await page.getByRole("button", { name: "Allow" }).click()
	const code = (await callback).searchParams.get("code") ?? ""
	return tokens(api, client, code, verifier, resource)
}

/** An assistant's token, bound to /mcp, as e2e/mcp.spec.ts gets one. */
async function mcpLogin(page: Page, api: APIRequestContext, base: string) {
	const resource = `${base}/mcp`
	const client = await createOAuthClient("Assistant App", { resources: [resource] })
	const { challenge, verifier } = pkce()
	const callback = catchCallback(page, client.redirectUri)
	await page.goto(authorizeUrl(client, { challenge, scope: "library:read", resource }))
	await expect(page).toHaveURL(/\/oauth\/consent\?/)
	await waitForHydration(page)
	await page.getByRole("button", { name: "Allow" }).click()
	const code = (await callback).searchParams.get("code") ?? ""
	return tokens(api, client, code, verifier, resource)
}

const errorOf = (promise: Promise<unknown>) =>
	promise.then(
		() => {
			throw new Error("expected the call to fail")
		},
		(e: unknown) => e as KlipstackApiError,
	)

test("the CLI signs in through OAuth with forced consent; tokens are bound to /api", async ({
	page,
	request,
	baseURL,
}) => {
	test.setTimeout(90_000)
	const base = baseURL ?? ""
	const email = await signupUser(page, "CLI Person")

	const full = await cliLogin(page, request, base)
	expect(full.access_token.split(".")).toHaveLength(3)
	expect(full.refresh_token).toBeTruthy()
	expect(await sdk(base, full.access_token).me()).toMatchObject({
		email,
		access: "write",
		via: "oauth",
		client: { id: CLI_CLIENT_ID, name: "Klipstack CLI" },
	})

	// Consent is already on file; prompt=consent shows the screen again (cliLogin checks it).
	// The user clears write access: the token can only read.
	const readOnly = await cliLogin(page, request, base, { declineWrite: true })
	expect(readOnly.scope?.split(" ")).not.toContain("library:write")
	const reader = sdk(base, readOnly.access_token)
	expect(await reader.me()).toMatchObject({ access: "read" })
	expect((await reader.articles.list()).items).toEqual([])
	expect(await errorOf(reader.articles.trash([MISSING]))).toMatchObject({
		status: 403,
		code: "insufficient_scope",
	})
	const refused = await request.post("/api/v1/articles", {
		headers: { authorization: `Bearer ${readOnly.access_token}` },
		data: { url: "https://example.com/read-only" },
	})
	expect(refused.status()).toBe(403)
	expect(refused.headers()["www-authenticate"]).toBe(
		'Bearer realm="klipstack", error="insufficient_scope", scope="library:write"',
	)
	// The latest consent is what counts: the first token, and tokens refreshed from its grant, can
	// no longer write either.
	const downgraded = sdk(base, full.access_token)
	expect(await downgraded.me()).toMatchObject({ access: "read" })
	expect(await errorOf(downgraded.articles.trash([MISSING]))).toMatchObject({ status: 403 })
	const refreshed = await request.post("/api/auth/oauth2/token", {
		form: {
			grant_type: "refresh_token",
			refresh_token: full.refresh_token ?? "",
			client_id: CLI_CLIENT_ID,
			resource: `${base}/api`,
		},
	})
	expect(refreshed.status(), await refreshed.text()).toBe(200)
	const { access_token: refreshedToken } = (await refreshed.json()) as { access_token: string }
	expect(await sdk(base, refreshedToken).me()).toMatchObject({ access: "read" })

	// Allowing writes again gives them back, to old tokens and new ones.
	const again = await cliLogin(page, request, base)
	expect(await downgraded.me()).toMatchObject({ access: "write" })
	const writer = sdk(base, again.access_token)
	const saved = await writer.articles.save({ url: `https://example.com/cli-${Date.now()}` })
	expect(saved).toMatchObject({ created: true, article: { status: "queued" } })
	expect((await writer.articles.trash([saved.article.id])).trashed).toEqual([saved.article.id])

	// The SDK asks for a fresh token once after a 401 and retries.
	const asked: boolean[] = []
	const refreshing = createClient({
		baseUrl: base,
		token: ({ refresh }) => {
			asked.push(refresh)
			return refresh ? full.access_token : "expired"
		},
	})
	expect((await refreshing.me()).email).toBe(email)
	expect(asked).toEqual([false, true])

	// Tokens do not cross over: /mcp tokens are rejected here, and /api tokens there.
	const assistant = await mcpLogin(page, request, base)
	const crossed = await errorOf(sdk(base, assistant.access_token).me())
	expect(crossed).toBeInstanceOf(KlipstackApiError)
	expect(crossed).toMatchObject({ status: 401, code: "unauthorized" })
	// A bearer token does not open the web app either.
	const settings = await request.get("/settings", {
		headers: { authorization: `Bearer ${full.access_token}` },
		maxRedirects: 0,
	})
	expect(settings.status()).toBe(302)
	const reverse = await request.post("/mcp", {
		headers: {
			authorization: `Bearer ${full.access_token}`,
			accept: "application/json, text/event-stream",
		},
		data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
	})
	expect(reverse.status()).toBe(401)
})

test("the mobile app signs in with its own client, gets write access, and names its version", async ({
	page,
	request,
	baseURL,
}) => {
	test.setTimeout(60_000)
	const base = baseURL ?? ""
	const email = await signupUser(page, "Phone Person")
	const client = { clientId: MOBILE_CLIENT_ID, redirectUri: MOBILE_REDIRECT_URI }
	const resource = `${base}/api`
	const { challenge, verifier } = pkce()
	const scope = MOBILE_SCOPES.join(" ")
	await page.goto(authorizeUrl(client, { challenge, scope, resource, prompt: "consent" }))
	await expect(page).toHaveURL(/\/oauth\/consent\?/)
	await expect(
		page.getByText("Klipstack app wants to access your Klipstack account."),
	).toBeVisible()
	await expect(
		page.getByText("Only allow this if you just tapped Sign in in the Klipstack app."),
	).toBeVisible()
	await expect(
		page.getByText("Confirm it is you and see your name and email address"),
	).toBeVisible()
	// Sharing needs to save: no read-only checkbox. Its redirect is fixed: no "return to" line.
	await expect(page.getByRole("checkbox")).toHaveCount(0)
	await expect(page.getByText(/You will return to/)).toHaveCount(0)
	await expect(page.getByText("Klipstack has not verified this app")).toHaveCount(0)

	// The browser can't follow the app's scheme, so post the form (no `grant` fields, as the page
	// sends none) and read the redirect it answers with.
	const oauthQuery = await page.locator('#oauth-consent input[name="oauthQuery"]').inputValue()
	const allowed = await page.request.post("/oauth/consent", {
		form: { oauthQuery, intent: "allow" },
		headers: { origin: base },
		maxRedirects: 0,
	})
	expect(allowed.status()).toBe(302)
	const back = new URL(allowed.headers().location ?? "")
	expect(`${back.protocol}${back.pathname}`).toBe(MOBILE_REDIRECT_URI)
	expect(back.searchParams.get("state")).toBe("state-123")
	const issued = await tokens(
		request,
		client,
		back.searchParams.get("code") ?? "",
		verifier,
		resource,
	)
	expect(issued.scope?.split(" ")).toContain(LIBRARY_WRITE_SCOPE)
	expect(await sdk(base, issued.access_token).me()).toMatchObject({
		email,
		access: "write",
		client: { id: MOBILE_CLIENT_ID, name: "Klipstack app" },
	})

	// Every request names the app's version; one below the minimum is turned away first.
	const me = (client: string) =>
		request.get("/api/v1/me", {
			headers: { authorization: `Bearer ${issued.access_token}`, [CLIENT_HEADER]: client },
		})
	const old = await me("ios/0.0.1")
	expect(old.status()).toBe(426)
	expect((await old.json()).error).toMatchObject({ code: "client_outdated" })
	expect((await me("ios/0.1.0")).status()).toBe(200)
})

/** Waits until the worker has extracted the article. */
async function waitUntilReady(client: KlipstackClient, id: string) {
	await expect
		.poll(async () => (await client.articles.get(id)).status, { timeout: 60_000 })
		.toBe("ready")
}

// A body the server refuses on its content-length alone gets its 413 over a raw socket, in
// "uploads refused before their body is read get an answer, and the connection closes". Sending
// all those megabytes through a client instead would race the server's close: it answers and
// closes after draining a bounded part of the body, so whether the client reads the answer or a
// broken connection is up to the socket buffers.
test("large bodies refused early still get their answer through Node's fetch", async ({
	page,
	baseURL,
}) => {
	test.setTimeout(120_000)
	const base = baseURL ?? ""
	await signupUser(page, "Big Uploader")
	const apiKey = await createApiKey(page, "Big")
	// Bodies with a URL the server refuses after reading them: nothing is saved or extracted.
	const notAUrl = "not a url"
	const big = JSON.stringify({ url: notAUrl, html: "a".repeat(9 * 1024 * 1024) })
	const upload = (token: string, body: BodyInit = big, init: RequestInit = {}) =>
		fetch(`${base}/api/v1/articles`, {
			method: "POST",
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body,
			...init,
		})

	// A bad token is refused before the body is read. The server reads only a small body before
	// sign-in, so a client sending 9 MB may see a broken connection: the SDK then asks whether its
	// token is the problem, refreshes, and sends the large body again.
	const tokens: boolean[] = []
	const client = createClient({
		baseUrl: base,
		token: ({ refresh }) => {
			tokens.push(refresh)
			return refresh ? apiKey : "klip_expired-key-expired-key-xx"
		},
	})
	expect(
		await errorOf(client.articles.save({ url: notAUrl, html: "a".repeat(9 * 1024 * 1024) })),
	).toMatchObject({ status: 422, code: "invalid_url" })
	expect(tokens).toEqual([false, true])

	// Two uploads that declare 5 MB and stall hold this user's large-upload slots (raw sockets, so
	// the stall is exact): the next large one gets a 429.
	const stall = () =>
		openUpload(base, "/api/v1/articles", {
			"content-type": "application/json",
			authorization: `Bearer ${apiKey}`,
			"content-length": String(5 * 1024 * 1024),
		})
	const stalled = [stall(), stall()]
	// A probe just over the large-body size: 422 while a slot is free, 429 once both are taken.
	// A probe that reaches the server while the stalled uploads sign in can take a slot first, and
	// one of them is refused. Its answer comes only once the server stops reading its body (30 s
	// idle), and the upload is then opened again. Probes wait a moment, so this is rare.
	const probe = JSON.stringify({ url: notAUrl, html: "a".repeat(300 * 1024) })
	const probeHeld = async () => {
		stalled.forEach((socket, i) => {
			if (socket.destroyed) stalled[i] = stall()
		})
		await new Promise((resolve) => setTimeout(resolve, 500))
		return (await upload(apiKey, probe)).status
	}
	await expect.poll(probeHeld, { timeout: 50_000 }).toBe(429)
	const busy = await upload(apiKey)
	expect(busy.status).toBe(429)
	expect(busy.headers.get("retry-after")).toBe("2")
	expect((await busy.json()).error.code).toBe("rate_limited")

	// Abandoned uploads free their slots.
	for (const socket of stalled) socket.destroy()
	await expect.poll(async () => (await upload(apiKey, probe)).status, { timeout: 20_000 }).toBe(422)
})

test("large uploads refused after sign-in get their 403 or 429 through Node's fetch", async ({
	page,
	request,
	baseURL,
}) => {
	test.setTimeout(90_000)
	const base = baseURL ?? ""
	await signupUser(page, "Refused Uploader")
	const apiKey = await createApiKey(page, "Refused")
	const body = JSON.stringify({ url: "not a url", html: "a".repeat(3 * 1024 * 1024) })
	const upload = (token: string) =>
		fetch(`${base}/api/v1/articles`, {
			method: "POST",
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body,
		})

	// A read-only login: 403, with the answer read, several times over.
	const readOnly = await cliLogin(page, request, base, { readOnly: true })
	for (let i = 0; i < 5; i++) {
		const res = await upload(readOnly.access_token)
		expect(res.status).toBe(403)
		expect((await res.json()).error.code).toBe("insufficient_scope")
	}

	// Deterministic, over a raw socket: half the body, a pause, then the rest. The server waits
	// for all of it before answering, and keeps the connection.
	const staged = await stagedUpload(
		base,
		"/api/v1/articles",
		{
			"content-type": "application/json",
			authorization: `Bearer ${readOnly.access_token}`,
			"content-length": String(Buffer.byteLength(body)),
		},
		[body.slice(0, 1536 * 1024), body.slice(1536 * 1024)],
	)
	expect(staged.beforeRest).toBe("")
	expect(staged.response).toMatch(/^HTTP\/1\.1 403/)
	expect(staged.response.toLowerCase()).not.toContain("connection: close")

	// Over the per-minute limit: 429 with its Retry-After, several times over.
	const client = sdk(base, apiKey)
	for (let i = 0; i < 12; i++) await Promise.all(Array.from({ length: 25 }, () => client.me()))
	for (let i = 0; i < 5; i++) {
		const res = await upload(apiKey)
		expect(res.status).toBe(429)
		expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
		expect((await res.json()).error.retryAfter).toBeGreaterThan(0)
	}
})

test("a multi-megabyte capture is saved and extracted", async ({ page, baseURL }) => {
	test.setTimeout(120_000)
	await signupUser(page, "Big Saver")
	const client = sdk(baseURL ?? "", await createApiKey(page, "Big save"))
	const marker = `big-${Date.now()}`
	// About 2 MB, nearly all of it in a comment the extractor drops: cheap to extract.
	const html = `<!doctype html><html><head><title>A big capture ${marker}</title></head><body><!-- ${"padding ".repeat(256 * 1024)} --><article><h1>A big capture ${marker}</h1>${"<p>The part worth reading, again and again.</p>".repeat(40)}</article></body></html>`
	expect(html.length).toBeGreaterThan(2 * 1024 * 1024)
	const url = `https://example.com/${marker}`
	const { article, created } = await client.articles.save({ url, html, source: "extension" })
	expect(created).toBe(true)
	const captures = await db
		.select({ source: documentRaw.source })
		.from(documentRaw)
		.where(eq(documentRaw.documentId, article.id))
	expect(captures).toEqual([{ source: "extension" }])
	await waitUntilReady(client, article.id)
	expect((await client.articles.get(article.id)).title).toBe(`A big capture ${marker}`)
	const markdown = await client.articles.markdown(article.id)
	expect(markdown).toContain("The part worth reading, again and again.")
	expect(markdown).not.toContain("padding")
})

/**
 * Sends a request in parts over a raw socket, pausing after the first: what came back during the
 * pause, and the response once everything was sent.
 */
function stagedUpload(
	base: string,
	path: string,
	headers: Record<string, string>,
	[first, rest]: [string, string],
	pauseMs = 1_500,
) {
	const { hostname, port } = new URL(base)
	return new Promise<{ beforeRest: string; response: string }>((resolve) => {
		const socket = connect(Number(port), hostname)
		let received = ""
		let beforeRest = ""
		socket.on("error", () => {})
		socket.on("data", (chunk) => {
			received += chunk.toString("utf8")
			if (/\r\n\r\n/.test(received)) {
				setTimeout(() => {
					socket.destroy()
					resolve({ beforeRest, response: received })
				}, 300)
			}
		})
		socket.on("connect", () => {
			const head = Object.entries({ host: `${hostname}:${port}`, ...headers })
				.map(([name, value]) => `${name}: ${value}\r\n`)
				.join("")
			socket.write(`POST ${path} HTTP/1.1\r\n${head}\r\n${first}`)
			setTimeout(() => {
				beforeRest = received
				if (!socket.destroyed) socket.write(rest)
			}, pauseMs)
		})
		setTimeout(() => {
			socket.destroy()
			resolve({ beforeRest, response: received })
		}, pauseMs + 10_000)
	})
}

/**
 * Starts an upload over a raw socket and leaves it hanging; destroy the socket to abandon it. The
 * server answers such an upload only to refuse it, and the socket is then destroyed.
 */
function openUpload(base: string, path: string, headers: Record<string, string>) {
	const { hostname, port } = new URL(base)
	const socket = connect(Number(port), hostname)
	socket.on("error", () => {})
	socket.on("data", () => socket.destroy())
	socket.on("connect", () => {
		const head = Object.entries({ host: `${hostname}:${port}`, ...headers })
			.map(([name, value]) => `${name}: ${value}\r\n`)
			.join("")
		socket.write(`POST ${path} HTTP/1.1\r\n${head}\r\n{"url":"not a url","html":"`)
		socket.write("a".repeat(64 * 1024))
	})
	return socket
}

/**
 * Sends a request's head and the start of its body over a raw socket, and returns what came back
 * within `waitMs`, and whether the server closed the connection.
 */
function rawUpload(
	base: string,
	path: string,
	headers: Record<string, string>,
	bodyStart: string,
	waitMs = 8_000,
) {
	const { hostname, port } = new URL(base)
	return new Promise<{ response: string; closed: boolean }>((resolve) => {
		const socket = connect(Number(port), hostname)
		let response = ""
		const timer = setTimeout(() => {
			socket.destroy()
			resolve({ response, closed: false })
		}, waitMs)
		socket.on("connect", () => {
			const head = Object.entries({ host: `${hostname}:${port}`, ...headers })
				.map(([name, value]) => `${name}: ${value}\r\n`)
				.join("")
			socket.write(`POST ${path} HTTP/1.1\r\n${head}\r\n${bodyStart}`)
		})
		socket.on("data", (chunk) => {
			response += chunk.toString("utf8")
		})
		socket.on("error", () => {})
		socket.on("close", () => {
			clearTimeout(timer)
			resolve({ response, closed: true })
		})
	})
}

test("uploads refused before their body is read get an answer, and the connection closes", async ({
	page,
	baseURL,
}) => {
	const base = baseURL ?? ""
	await signupUser(page, "Raw Uploader")
	const apiKey = await createApiKey(page, "Raw")
	const json = { "content-type": "application/json" }
	const start = `{"url":"https://example.com/raw","html":"${"a".repeat(4096)}`

	// Declared 20 MB, with a bad key: refused before sign-in, not read, closed.
	const anonymous = await rawUpload(
		base,
		"/api/v1/articles",
		{
			...json,
			authorization: "Bearer klip_not-a-real-key-at-all-xx",
			"content-length": String(20 * 1024 * 1024),
		},
		start,
	)
	expect(anonymous.response).toMatch(/^HTTP\/1\.1 401/)
	expect(anonymous.response.toLowerCase()).toContain("connection: close")
	expect(anonymous.closed).toBe(true)

	// Declared over the save limit, signed in: 413 without reading, closed.
	const oversized = await rawUpload(
		base,
		"/api/v1/articles",
		{
			...json,
			authorization: `Bearer ${apiKey}`,
			"content-length": String(20 * 1024 * 1024),
		},
		start,
	)
	expect(oversized.response).toMatch(/^HTTP\/1\.1 413/)
	expect(oversized.response.toLowerCase()).toContain("connection: close")
	expect(oversized.closed).toBe(true)
	expect(oversized.response).toContain('"code":"too_large"')
})
