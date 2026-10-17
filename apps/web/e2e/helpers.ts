import { createHash, createHmac, randomBytes } from "node:crypto"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	authLimits,
	db,
	eq,
	type FeatureFlag,
	invites,
	newId,
	oauthClient,
	oauthClientResource,
	pool,
	sql,
	user,
	userFeatures,
} from "@klipstack/db"
import { expect, type Locator, type Page } from "@playwright/test"
import { changeRole } from "../app/services/admin-roles.server"

/**
 * Browser fixtures share localhost. Reset only that address's counters for one policy, leaving
 * per-account counters and all other policies intact for abuse tests.
 */
export async function resetLocalIpLimit(path: string) {
	for (const ip of ["::1", "127.0.0.1", "::ffff:127.0.0.1"]) {
		const key = createHmac(
			"sha256",
			process.env.BETTER_AUTH_SECRET ?? "dev-secret-not-for-production",
		)
			.update(`${path}:ip:${ip}`)
			.digest("hex")
		await db.delete(authLimits).where(eq(authLimits.key, key))
	}
}

export async function createInviteCode(): Promise<string> {
	await resetLocalIpLimit("/sign-up/email")
	const code = `E2E${Math.random().toString(36).slice(2, 8).toUpperCase()}`
	await db.insert(invites).values({ code, note: "e2e" })
	return code
}

export function uniqueEmail(prefix = "e2e") {
	return `${prefix}+${Date.now()}${Math.floor(Math.random() * 1e4)}@example.com`
}

export async function closeDb() {
	await pool.end()
}

/** Wait until React has hydrated so fetcher-driven forms do not fall back to full-page posts. */
export async function waitForHydration(page: Page) {
	await page.waitForFunction(() => document.documentElement.dataset.hydrated === "1", undefined, {
		timeout: 15_000,
	})
}

/** Route ids the desktop sidebar prefetches (`prefetch="render"`). */
const SIDEBAR_ROUTES = [
	"routes/reading-home",
	"routes/library",
	"routes/feed",
	"routes/notebook",
	// Not "routes/editions": its link shows only with editions turned on.
	"routes/tags",
]

/**
 * Waits until the sidebar's prefetch has loaded its route modules. Leaving the page earlier cancels
 * those imports, and React Router answers a failed import by reloading the page, which in Firefox
 * aborts the navigation that cancelled it (NS_BINDING_ABORTED).
 */
export async function waitForSidebarPrefetch(page: Page) {
	await page.waitForFunction(
		(ids) => {
			const modules = (window as { __reactRouterRouteModules?: Record<string, unknown> })
				.__reactRouterRouteModules
			return ids.every((id) => modules?.[id])
		},
		SIDEBAR_ROUTES,
		{ timeout: 15_000 },
	)
}

/** Creates an API key in Settings for the signed-in user and returns it. */
export async function createApiKey(page: Page, name = "MCP") {
	await page.goto("/settings/api-keys")
	await waitForHydration(page)
	await page.getByLabel("Name (e.g. MacBook Chrome)").fill(name)
	await page.getByRole("button", { name: "Create key" }).click()
	const apiKey = (await page.getByTestId("new-api-key").textContent())?.trim() ?? ""
	expect(apiKey).toMatch(/^klip_/)
	return apiKey
}

/** A public OAuth client (PKCE, no secret), registered the way an admin would. */
export async function createOAuthClient(
	name = "E2E Test App",
	{ resources = [] }: { resources?: string[] } = {},
) {
	const clientId = `e2e-${Math.random().toString(36).slice(2, 10)}`
	const redirectUri = `http://127.0.0.1:47123/${clientId}/callback`
	const now = new Date()
	await db.insert(oauthClient).values({
		id: newId(),
		clientId,
		name,
		redirectUris: [redirectUri],
		tokenEndpointAuthMethod: "none",
		grantTypes: ["authorization_code", "refresh_token"],
		responseTypes: ["code"],
		requirePKCE: true,
		createdAt: now,
		updatedAt: now,
	})
	for (const resourceId of resources)
		await db
			.insert(oauthClientResource)
			.values({ id: newId(), clientId, resourceId, createdAt: now })
	return { clientId, redirectUri }
}

/** PKCE verifier and S256 challenge. */
export function pkce() {
	const verifier = randomBytes(32).toString("base64url")
	const challenge = createHash("sha256").update(verifier).digest("base64url")
	return { verifier, challenge }
}

export const PASSWORD = "password123"

/**
 * Signs up a new user with an invite, and the page's context holds its session; the page itself
 * stays where it was. The form's own action is posted without rendering the page around it: one
 * request instead of a page load, typing and a redirect. e2e/auth.spec.ts signs up through the page.
 */
export async function signupUser(
	page: Page,
	name: string,
	{
		verified = true,
		features = [],
		editions = false,
	}: { verified?: boolean; features?: FeatureFlag[]; editions?: boolean } = {},
) {
	const code = await createInviteCode()
	const email = uniqueEmail(name.toLowerCase().replace(/\W+/g, "-"))
	const res = await page.request.post("/signup", {
		form: { inviteCode: code, name, email, password: PASSWORD },
		maxRedirects: 0,
	})
	expect(res.status(), await res.text()).toBe(302)
	// Most scenarios need an established account; email-ownership tests opt out and use the
	// actual verification flow. This is fixture setup, never an application verification API.
	if (verified) await db.update(user).set({ emailVerified: true }).where(eq(user.email, email))
	if (editions) await turnOnEditions(email)
	// Features in testing, as an admin would turn them on.
	if (features.length) {
		const [account] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
		await db
			.insert(userFeatures)
			.values(features.map((feature) => ({ userId: account!.id, feature })))
	}
	return email
}

/** Editions for the account, as the reader turns them on in Settings → Features (off by default). */
export async function turnOnEditions(email: string) {
	await db
		.update(user)
		.set({ prefs: sql`${user.prefs} || '{"editions": "on"}'::jsonb` })
		.where(eq(user.email, email))
}

export function authorizeUrl(
	client: { clientId: string; redirectUri: string },
	{
		challenge,
		scope = "openid profile offline_access",
		resource,
		prompt,
	}: { challenge: string; scope?: string; resource?: string; prompt?: string },
) {
	const params = new URLSearchParams({
		response_type: "code",
		client_id: client.clientId,
		redirect_uri: client.redirectUri,
		scope,
		state: "state-123",
		code_challenge: challenge,
		code_challenge_method: "S256",
	})
	if (resource) params.set("resource", resource)
	if (prompt) params.set("prompt", prompt)
	return `/api/auth/oauth2/authorize?${params}`
}

/** The app's redirect URI is not a real server: capture the navigation and answer it. */
export function catchCallback(page: Page, redirectUri: string) {
	return new Promise<URL>((resolve) => {
		void page.route(`${redirectUri}**`, (route) => {
			resolve(new URL(route.request().url()))
			return route.fulfill({ contentType: "text/plain", body: "callback" })
		})
	})
}

/** Logs in through the password form. */
export async function login(page: Page, email: string, expectUrl: RegExp = /\/home$/) {
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill(PASSWORD)
	await page.getByRole("button", { name: "Log in", exact: true }).click()
	await expect(page).toHaveURL(expectUrl)
}

/**
 * Logs out from inside the page, so the service worker sees it and forgets the session at once.
 * Not `page.request.post("/logout")`: that logs out behind the worker's back. The next
 * `page.goto` then brings a signed-out response, and the worker tells every tab to reload: this
 * one too, since a navigation Playwright starts names no client to leave out. The reload of the
 * page being left cancels the navigation (`net::ERR_ABORTED`) when it wins the race, as it did
 * on a slow CI runner.
 */
export async function logout(page: Page) {
	// Nothing loaded yet (signupUser loads no page): the context's own request is enough.
	if (page.url() === "about:blank") {
		await page.request.post("/logout", { maxRedirects: 0 })
		return
	}
	// A loaded page logs out through its own fetch, as the app does: its service worker sees it.
	await page.evaluate(async () => {
		await fetch("/logout", { method: "POST" })
	})
}

/**
 * A signed-in admin, made the way production makes one: sign up, verify, grant with the operator
 * CLI's function (which ends the account's sessions), then log in again.
 */
export async function signupAdmin(page: Page, name = "Admin") {
	const email = await signupUser(page, name)
	await changeRole({ email }, "admin", "e2e fixture")
	await page.goto("/login")
	await login(page, email)
	return email
}

const mailFile = (address: string) =>
	join(tmpdir(), "klipstack-e2e-mail", `${encodeURIComponent(address)}.json`)

/**
 * The last message the fake transport (email-transport.mjs) accepted for this address. Waits for
 * it: sign-in and reset mail goes out after the answer.
 */
export async function lastEmailTo(
	address: string,
): Promise<{ subject: string; html: string; text?: string }> {
	const file = mailFile(address)
	await expect.poll(() => existsSync(file), { message: `an email to ${address}` }).toBe(true)
	const message = JSON.parse(readFileSync(file, "utf8"))
	rmSync(file)
	return message
}

/** No message for this address, after as long as one takes to go out. */
export async function expectNoEmailTo(address: string) {
	await new Promise((resolve) => setTimeout(resolve, 1000))
	expect(existsSync(mailFile(address))).toBe(false)
}

/**
 * A quote shown as marked text (`.marker` in app.css), its ink the highlight's own color: the one
 * the reader paints that color with (`--hl-<color>`).
 */
export async function expectMarked(quote: Locator, color: string) {
	await expect(quote).toHaveClass(/\bmarker\b/)
	const [ink, expected] = await quote.evaluate(
		(el, name) => [
			getComputedStyle(el).getPropertyValue("--hl").trim(),
			getComputedStyle(document.documentElement).getPropertyValue(`--hl-${name}`).trim(),
		],
		color,
	)
	expect(expected).not.toBe("")
	expect(ink).toBe(expected)
	await expect(quote).toHaveCSS("background-image", /gradient/)
}

/**
 * The text of every highlight the reader paints, whatever its color: one per group of marker strokes
 * (`HighlightInk`) with at least one line, read from its color's registry (`klip-hl-<color>`). Only
 * the strokes near the screen are in the page; `data-lines` counts them all.
 */
export function paintedHighlights(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>(".hl-inks > i[data-hl]")]
			.filter((group) => Number(group.dataset.lines) > 0)
			.map((group) => {
				const registry = [...(CSS.highlights.get(`klip-hl-${group.dataset.hl}`) ?? [])]
				return registry[Number(group.dataset.index)]?.toString() ?? ""
			}),
	)
}

/**
 * Whether the page takes this browser for an Apple one, as the app does (`usePaletteHint`,
 * `useSubmitHint`, `ShortcutList`): there the shortcuts read ⌘K, ⌘↵, elsewhere Ctrl K, Ctrl+Enter.
 * Chromium on a Mac says so even when CI, on Linux, does not.
 */
export async function applePlatform(page: Page): Promise<boolean> {
	return page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
}

/**
 * Put the caret at the end of the focused note, as a reader on this computer would. `End` will not
 * do on a Mac: there it scrolls the page and leaves the caret where the click put it, often in the
 * middle of the text.
 */
export async function caretToEnd(page: Page) {
	await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End")
}
