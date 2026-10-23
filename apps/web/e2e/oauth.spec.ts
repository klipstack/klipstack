import { db, desc, eq, oauthRefreshToken, session, sql, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import {
	authorizeUrl,
	catchCallback,
	createOAuthClient,
	PASSWORD,
	pkce,
	signupUser,
	waitForHydration,
	ownClientAddress,
} from "./helpers"

// The OAuth token endpoint's limit is per address: see ownClientAddress.
test.use(ownClientAddress)

async function signup(page: Page) {
	return signupUser(page, "OAuth Person")
}

test("discovery advertises the authorization server without open registration", async ({
	request,
}) => {
	const res = await request.get("/.well-known/oauth-authorization-server/api/auth")
	expect(res.status()).toBe(200)
	const meta = await res.json()
	expect(meta.issuer).toMatch(/\/api\/auth$/)
	expect(meta.code_challenge_methods_supported).toEqual(["S256"])
	expect(meta.client_id_metadata_document_supported).toBe(true)
	expect(meta.registration_endpoint).toBeUndefined()
	expect((await request.get("/api/auth/token")).status()).toBe(404)
})

test("old API and MCP tokens stay revoked after reconnecting the same client", async ({
	page,
	request,
	baseURL,
}) => {
	await signup(page)
	const resources = [`${baseURL}/api`, `${baseURL}/mcp`]
	const client = await createOAuthClient("Reconnect App", { resources })
	async function issue(resource: string) {
		const { challenge, verifier } = pkce()
		const callback = catchCallback(page, client.redirectUri)
		await page.goto(
			authorizeUrl(client, {
				challenge,
				scope: "library:read offline_access",
				resource,
				prompt: "consent",
			}),
		)
		await expect(page).toHaveURL(/\/oauth\/consent\?/)
		await waitForHydration(page)
		await page.getByRole("button", { name: "Allow", exact: true }).click()
		const code = (await callback).searchParams.get("code") ?? ""
		const response = await request.post("/api/auth/oauth2/token", {
			form: {
				grant_type: "authorization_code",
				code,
				code_verifier: verifier,
				client_id: client.clientId,
				redirect_uri: client.redirectUri,
				resource,
			},
		})
		expect(response.status()).toBe(200)
		return response.json()
	}
	async function check(token: string, mcp: boolean) {
		const headers = {
			authorization: `Bearer ${token}`,
			accept: "application/json, text/event-stream",
		}
		return mcp
			? request.post("/mcp", { headers, data: { jsonrpc: "2.0", id: 1, method: "tools/list" } })
			: request.get("/api/v1/me", { headers })
	}
	const old = []
	for (const resource of resources) old.push(await issue(resource))
	for (const [i, token] of old.entries())
		expect((await check(token.access_token, i === 1)).status()).toBe(200)
	await page.goto("/settings/connected-apps")
	await waitForHydration(page)
	page.once("dialog", (dialog) => void dialog.accept())
	await page.getByRole("button", { name: "Disconnect Reconnect App" }).click()
	await expect(page.getByRole("button", { name: "Disconnect Reconnect App" })).toHaveCount(0)
	const fresh = []
	for (const resource of resources) fresh.push(await issue(resource))
	for (const [i, token] of old.entries()) {
		expect((await check(token.access_token, i === 1)).status()).toBe(401)
		expect((await check(fresh[i].access_token, i === 1)).status()).toBe(200)
		const refresh = await request.post("/api/auth/oauth2/token", {
			form: {
				grant_type: "refresh_token",
				refresh_token: token.refresh_token,
				client_id: client.clientId,
			},
		})
		expect(refresh.status()).toBe(400)
	}
})

test("an API token names the browser sign-in behind it, and a refresh keeps it", async ({
	page,
	request,
	baseURL,
}) => {
	// Deleting the account through the API reads the sign-in's time from this `sid`
	// (`signedInAt` in app/api/auth.server.ts): a refresh must never make it a new sign-in.
	const email = await signup(page)
	const [signedIn] = await db
		.select({ id: session.id })
		.from(session)
		.innerJoin(user, eq(user.id, session.userId))
		.where(eq(user.email, email))
		.orderBy(desc(session.createdAt))
		.limit(1)
	const resource = `${baseURL}/api`
	const client = await createOAuthClient("Sign-in App", { resources: [resource] })
	const { challenge, verifier } = pkce()
	const callback = catchCallback(page, client.redirectUri)
	await page.goto(
		authorizeUrl(client, { challenge, scope: "library:read offline_access", resource }),
	)
	await waitForHydration(page)
	await page.getByRole("button", { name: "Allow", exact: true }).click()
	const code = (await callback).searchParams.get("code") ?? ""
	const token = (form: Record<string, string>) =>
		request
			.post("/api/auth/oauth2/token", { form: { client_id: client.clientId, resource, ...form } })
			.then((res) => res.json())
	const sidOf = (jwt: string) =>
		JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString()).sid as unknown
	const first = await token({
		grant_type: "authorization_code",
		code,
		code_verifier: verifier,
		redirect_uri: client.redirectUri,
	})
	expect(sidOf(first.access_token)).toBe(signedIn!.id)
	const refreshed = await token({ grant_type: "refresh_token", refresh_token: first.refresh_token })
	expect(refreshed.access_token).not.toBe(first.access_token)
	expect(sidOf(refreshed.access_token)).toBe(signedIn!.id)
})

test("unverified users cannot issue API keys or bypass the OAuth consent screen", async ({
	page,
	baseURL,
}) => {
	await signupUser(page, "Unverified", { verified: false })
	const key = await page.request.post("/settings/api-keys", {
		form: { intent: "create", name: "Blocked" },
	})
	expect(key.status()).toBe(403)
	const client = await createOAuthClient("Unverified App", { resources: [`${baseURL}/api`] })
	const response = await page.request.get(
		authorizeUrl(client, {
			challenge: pkce().challenge,
			resource: `${baseURL}/api`,
			scope: "library:read",
			prompt: "consent",
		}),
		{ maxRedirects: 0 },
	)
	const location = new URL(response.headers().location ?? "", baseURL)
	const consent = await page.request.post("/api/auth/oauth2/consent", {
		data: { accept: true, oauth_query: location.search.slice(1) },
	})
	expect(consent.status()).toBe(403)
	await page.goto("/settings/api-keys")
	await expect(page.getByRole("button", { name: "Create key" })).toBeDisabled()
})

test("an old sign-in makes no key and connects no new app until it signs in again", async ({
	page,
	baseURL,
}) => {
	test.setTimeout(60_000)
	const email = await signup(page)
	// Signed in 31 minutes ago, by the database's clock: a forgotten or stolen session.
	await db.execute(sql`
		update session set created_at = now() - interval '31 minutes'
		where user_id = (select id from "user" where email = ${email})
	`)
	const key = await page.request.post("/settings/api-keys", {
		form: { intent: "create", name: "Late" },
	})
	expect(key.status()).toBe(403)

	// better-auth's own consent endpoint refuses a new app too, not only our page.
	const client = await createOAuthClient("Late App", { resources: [`${baseURL}/api`] })
	const ask = authorizeUrl(client, {
		challenge: pkce().challenge,
		resource: `${baseURL}/api`,
		scope: "library:read",
		prompt: "consent",
	})
	const response = await page.request.get(ask, { maxRedirects: 0 })
	const location = new URL(response.headers().location ?? "", baseURL)
	const direct = await page.request.post("/api/auth/oauth2/consent", {
		data: { accept: true, oauth_query: location.search.slice(1) },
	})
	expect(direct.status()).toBe(403)

	// The consent page offers to log in again, and comes back to the same request.
	await page.goto(ask)
	await expect(page).toHaveURL(/\/oauth\/consent\?/)
	await waitForHydration(page)
	await expect(page.getByRole("button", { name: "Allow", exact: true })).toHaveCount(0)
	await page.getByRole("button", { name: "Log in again" }).click()
	await expect(page).toHaveURL(/\/login\?/)
	await waitForHydration(page)
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill(PASSWORD)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL(/\/oauth\/consent\?/)
	await expect(page.getByRole("button", { name: "Allow", exact: true })).toBeVisible()

	// Signed in just now: Settings makes the key.
	await page.goto("/settings/api-keys")
	await waitForHydration(page)
	await page.getByPlaceholder("Name (e.g. MacBook Chrome)").fill("Fresh")
	await page.getByRole("button", { name: "Create key" }).click()
	await expect(page.getByText("Copy your new key now")).toBeVisible()
})

test("Settings asks an old sign-in for its own password before it makes a key", async ({
	page,
}) => {
	const email = await signup(page)
	await db.execute(sql`
		update session set created_at = now() - interval '31 minutes'
		where user_id = (select id from "user" where email = ${email})
	`)
	await page.goto("/settings/api-keys")
	await waitForHydration(page)
	await page.getByPlaceholder("Name (e.g. MacBook Chrome)").fill("Late")
	await page.getByRole("button", { name: "Create key" }).click()
	await expect(page.getByText("You signed in more than 30 minutes ago")).toBeVisible()
	// No email and no login page: only this account's password renews the sign-in.
	await expect(page.getByRole("button", { name: "Log in again" })).toHaveCount(0)
	await page.getByLabel("Password").fill("not-the-password")
	await page.getByRole("button", { name: "Confirm" }).click()
	await expect(page.getByText("That password is not right.")).toBeVisible()
	await page.getByLabel("Password").fill(PASSWORD)
	await page.getByRole("button", { name: "Confirm" }).click()
	await expect(page.getByText("Confirmed. Try it again now.")).toBeVisible()
	await expect(page).toHaveURL(/\/settings\/api-keys$/)
	await page.getByRole("button", { name: "Create key" }).click()
	await expect(page.getByText("Copy your new key now")).toBeVisible()
})

test("Settings sends an old sign-in without a password to log in again", async ({ page }) => {
	const email = await signup(page)
	await db.execute(sql`
		delete from account where provider_id = 'credential'
			and user_id = (select id from "user" where email = ${email})
	`)
	await db.execute(sql`
		update session set created_at = now() - interval '31 minutes'
		where user_id = (select id from "user" where email = ${email})
	`)
	await page.goto("/settings/api-keys")
	await waitForHydration(page)
	await page.getByPlaceholder("Name (e.g. MacBook Chrome)").fill("Late")
	await page.getByRole("button", { name: "Create key" }).click()
	await expect(page.getByText("You signed in more than 30 minutes ago")).toBeVisible()
	await expect(page.getByLabel("Password")).toHaveCount(0)
	await page.getByRole("button", { name: "Log in again" }).click()
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Fsettings%2Fapi-keys$/)
	const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	expect(await db.select().from(session).where(eq(session.userId, row!.id))).toHaveLength(0)
})

test("app asks → login → consent → code → tokens → settings disconnect", async ({
	page,
	request,
}) => {
	test.setTimeout(60_000)
	const email = await signup(page)
	const client = await createOAuthClient("Test Assistant")
	const { challenge } = pkce()

	// Signed out: the provider sends the user to /login, which resumes the flow after sign-in.
	await page.context().clearCookies()
	await page.goto(authorizeUrl(client, { challenge }))
	await expect(page).toHaveURL(/\/login\?/)
	await expect(page.getByText("Log in to continue connecting an app")).toBeVisible()
	await expect(page.getByRole("link", { name: "Email me a login link instead" })).toHaveCount(0)
	await waitForHydration(page)
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill(PASSWORD)
	await page.getByRole("button", { name: "Log in" }).click()

	await expect(page).toHaveURL(/\/oauth\/consent\?/)
	await expect(
		page.getByText("Test Assistant wants to access your Klipstack account."),
	).toBeVisible()
	await expect(page.getByText("Confirm it is you and see your name")).toBeVisible()
	await expect(page.getByText("Stay connected until you disconnect it")).toBeVisible()
	await expect(page.getByText("You will return to 127.0.0.1:47123.")).toBeVisible()
	const csp = (await page.request.get(page.url())).headers()["content-security-policy"]
	expect(csp).toContain("frame-ancestors 'none'")

	await waitForHydration(page)
	const callback = catchCallback(page, client.redirectUri)
	await page.getByRole("button", { name: "Allow" }).click()
	const back = await callback
	expect(back.searchParams.get("state")).toBe("state-123")
	expect(back.searchParams.get("iss")).toMatch(/\/api\/auth$/)
	const code = back.searchParams.get("code")
	expect(code).toBeTruthy()

	// A code is useless without the PKCE verifier.
	const wrong = await request.post("/api/auth/oauth2/token", {
		form: {
			grant_type: "authorization_code",
			code: code ?? "",
			redirect_uri: client.redirectUri,
			client_id: client.clientId,
			code_verifier: pkce().verifier,
		},
	})
	expect(wrong.ok()).toBe(false)
	expect(await wrong.json()).toMatchObject({ error_description: "code verification failed" })

	// Already consented and signed in: straight back to the app.
	const { challenge: challenge2, verifier: verifier2 } = pkce()
	const again = await page.request.get(authorizeUrl(client, { challenge: challenge2 }), {
		maxRedirects: 0,
	})
	expect(again.status()).toBe(302)
	const location = new URL(again.headers().location ?? "")
	expect(location.href.startsWith(client.redirectUri)).toBe(true)
	const code2 = location.searchParams.get("code") ?? ""
	expect(code2).toBeTruthy()

	const tokenRes = await request.post("/api/auth/oauth2/token", {
		form: {
			grant_type: "authorization_code",
			code: code2,
			redirect_uri: client.redirectUri,
			client_id: client.clientId,
			code_verifier: verifier2,
		},
	})
	expect(tokenRes.status()).toBe(200)
	const tokens = await tokenRes.json()
	expect(tokens.token_type).toBe("Bearer")
	expect(tokens.refresh_token).toBeTruthy()

	const info = await request.get("/api/auth/oauth2/userinfo", {
		headers: { authorization: `Bearer ${tokens.access_token}` },
	})
	expect(info.status()).toBe(200)
	expect(await info.json()).toMatchObject({ name: "OAuth Person" })

	const token = (form: Record<string, string>) =>
		request.post("/api/auth/oauth2/token", { form: { client_id: client.clientId, ...form } })
	const refreshWith = (refresh_token: string) =>
		token({ grant_type: "refresh_token", refresh_token })
	const newCode = async () => {
		const { challenge, verifier } = pkce()
		const res = await page.request.get(authorizeUrl(client, { challenge }), { maxRedirects: 0 })
		return { code: new URL(res.headers().location ?? "").searchParams.get("code") ?? "", verifier }
	}
	const exchange = ({ code, verifier }: { code: string; verifier: string }, redirect_uri = "") =>
		token({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirect_uri || client.redirectUri,
			code_verifier: verifier,
		})

	// A refresh token rotates. For 30 seconds the spent one answers again with the same tokens (a
	// client retrying an answer it lost); after that, using it ends the whole family.
	const rotated = await refreshWith(tokens.refresh_token)
	expect(rotated.status()).toBe(200)
	const next = await rotated.json()
	expect(next.refresh_token).not.toBe(tokens.refresh_token)
	const retried = await refreshWith(tokens.refresh_token)
	expect((await retried.json()).refresh_token).toBe(next.refresh_token)
	await db
		.update(oauthRefreshToken)
		.set({ rotationReplayExpiresAt: new Date(Date.now() - 1000) })
		.where(eq(oauthRefreshToken.clientId, client.clientId))
	expect((await refreshWith(tokens.refresh_token)).ok()).toBe(false)
	expect((await refreshWith(next.refresh_token)).ok()).toBe(false)

	// A code works once; used again, the tokens it gave go too.
	const once = await newCode()
	const issued = await (await exchange(once)).json()
	expect((await exchange(once)).ok()).toBe(false)
	expect((await refreshWith(issued.refresh_token)).ok()).toBe(false)

	// A code goes only to the address it was issued for.
	expect((await exchange(await newCode(), "http://127.0.0.1:47124/callback")).ok()).toBe(false)

	const live = await (await exchange(await newCode())).json()
	expect(live.refresh_token).toBeTruthy()

	// Settings lists the app; disconnecting it kills the refresh token.
	await page.goto("/settings/connected-apps")
	await waitForHydration(page)
	await expect(page.getByText("Test Assistant", { exact: true })).toBeVisible()
	page.once("dialog", (d) => void d.accept())
	await page.getByRole("button", { name: "Disconnect Test Assistant" }).click()
	await expect(page.getByText("No connected apps.")).toBeVisible()

	const refresh = await refreshWith(live.refresh_token)
	expect(refresh.status()).toBe(400)
})

test("consent shows who is signed in, and can continue as another account", async ({ page }) => {
	test.setTimeout(60_000)
	const first = await signupUser(page, "First Person")
	await page.context().clearCookies()
	const second = await signupUser(page, "Second Person")
	const client = await createOAuthClient("Switch App")
	await page.goto(authorizeUrl(client, { challenge: pkce().challenge, scope: "openid" }))
	await expect(page).toHaveURL(/\/oauth\/consent\?/)
	const account = page.getByTestId("oauth-account")
	await expect(account).toContainText("Signed in as")
	await expect(account).toContainText("Second Person")
	await expect(account).toContainText(second)

	// Another account: signed out, back on login with the request, then consent for that account.
	await waitForHydration(page)
	await page.getByRole("button", { name: "Use another account" }).click()
	await expect(page).toHaveURL(/\/login\?.*sig=/)
	await expect(page.getByText("Log in to continue connecting an app")).toBeVisible()
	expect((await page.request.get("/api/auth/get-session")).ok()).toBe(true)
	expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull()
	await waitForHydration(page)
	await page.getByLabel("Email").fill(first)
	await page.getByLabel("Password").fill(PASSWORD)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL(/\/oauth\/consent\?/)
	await expect(account).toContainText("First Person")
	await expect(account).toContainText(first)
	await waitForHydration(page)
	const callback = catchCallback(page, client.redirectUri)
	await page.getByRole("button", { name: "Allow" }).click()
	expect((await callback).searchParams.get("code")).toBeTruthy()
})

test("denying consent sends the app an access_denied error", async ({ page }) => {
	await signup(page)
	const client = await createOAuthClient("Denied App")
	await page.goto(authorizeUrl(client, { challenge: pkce().challenge, scope: "openid" }))
	await expect(page).toHaveURL(/\/oauth\/consent\?/)
	await waitForHydration(page)
	const callback = catchCallback(page, client.redirectUri)
	await page.getByRole("button", { name: "Deny" }).click()
	const back = await callback
	expect(back.searchParams.get("error")).toBe("access_denied")
	expect(back.searchParams.get("code")).toBeNull()
})

test("consent page rejects a tampered request", async ({ page }) => {
	await signup(page)
	const client = await createOAuthClient()
	await page.goto(authorizeUrl(client, { challenge: pkce().challenge, scope: "openid" }))
	await expect(page).toHaveURL(/\/oauth\/consent\?/)
	const tampered = new URL(page.url())
	tampered.searchParams.set("redirect_uri", "https://evil.example/callback")
	const res = await page.goto(tampered.toString())
	expect(res?.status()).toBe(400)
	await expect(page.getByText("evil.example")).toHaveCount(0)
	await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0)
	await expect(page.getByRole("alert")).toHaveText(
		"This request is invalid or has expired. Start again from the app.",
	)

	// The same query on /login is not trusted either: it is a plain login.
	await page.context().clearCookies()
	await page.goto(`/login${tampered.search}`)
	await expect(page.getByRole("status")).toHaveText(
		"This request is invalid or has expired. Start again from the app.",
	)
	await expect(page.locator('input[name="oauthQuery"]')).toHaveCount(0)
})
