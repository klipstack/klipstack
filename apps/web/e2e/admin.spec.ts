import { randomUUID } from "node:crypto"
import {
	adminAuditEvents,
	db,
	documents,
	eq,
	featureFlags,
	invites,
	session,
	usageCounts,
	user,
} from "@klipstack/db"
import { devices, expect, type Page, test } from "@playwright/test"
import { PASSWORD, signupAdmin, signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const userByEmail = async (email: string) =>
	(await db.query.user.findFirst({ where: eq(user.email, email) }))!

/** Ages the account's sign-in past the 30-minute write window. Fixture setup, not an app path. */
async function expireWriteWindow(email: string) {
	const account = await userByEmail(email)
	await db
		.update(session)
		.set({ createdAt: new Date(Date.now() - 31 * 60_000) })
		.where(eq(session.userId, account.id))
}

async function createInvite(page: Page, note: string) {
	await page.getByLabel("Note (optional)").fill(note)
	await page.getByRole("button", { name: "Create invite" }).click()
	const code = (await page.getByTestId("new-invite-code").textContent())?.trim() ?? ""
	expect(code).toMatch(/^[A-Z0-9]{8}$/)
	return code
}

test("anonymous and ordinary accounts are denied, on pages, route data and actions", async ({
	page,
	baseURL,
}) => {
	await page.goto("/admin/users?q=a")
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Fadmin%2Fusers%3Fq%3Da$/)
	const anonymous = await page.request.post("/admin/invites/create", {
		headers: { origin: baseURL! },
		form: { expiry: "7d" },
	})
	expect(anonymous.status()).toBe(401)

	await signupUser(page, "Ordinary")
	await page.goto("/home")
	await waitForHydration(page)
	await page.getByRole("button", { name: "Account: Ordinary" }).click()
	await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible()
	await expect(page.getByRole("menuitem", { name: "Admin" })).toHaveCount(0)

	for (const path of ["/admin", "/admin/users", "/admin/jobs", "/admin/audit"]) {
		const response = await page.goto(path)
		expect(response?.status()).toBe(403)
		await expect(
			page.getByRole("heading", { name: "This area is for administrators." }),
		).toBeVisible()
		await expect(page.getByTestId("admin-label")).toHaveCount(0)
		const data = await page.request.get(`${path}.data`)
		expect(data.status()).toBe(403)
		expect(await data.text()).not.toMatch(/@example\.com|invite|worker/i)
		expect(data.headers()["cache-control"]).toContain("no-store")
	}
	for (const [path, form] of [
		["/admin/invites/create", { expiry: "7d" }],
		[`/admin/invites/${randomUUID()}/revoke`, {}],
		["/admin/jobs/retry", { kind: "extract", documentId: randomUUID() }],
		["/admin/reauthenticate", { returnTo: "/admin" }],
	] as const) {
		const response = await page.request.post(path, { headers: { origin: baseURL! }, form })
		expect(response.status(), path).toBe(403)
	}
	// The session is intact: the refused sign-in-again did not end it.
	await page.goto("/library")
	await expect(page).toHaveURL(/\/library$/)
})

test("an admin manages invites, and the audit trail records it without the code", async ({
	page,
}) => {
	const email = await signupAdmin(page, "Invite Admin")
	await waitForHydration(page)
	await page.getByRole("button", { name: "Account: Invite Admin" }).click()
	await page.getByRole("menuitem", { name: "Admin" }).click()
	await expect(page).toHaveURL(/\/admin$/)
	await expect(page.getByTestId("admin-label")).toHaveText("Admin")
	await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible()
	await expect(page.getByText("Failed (retained)").first()).toBeVisible()
	await expect(page.getByTestId("unavailable")).toHaveCount(0)

	await page
		.getByRole("navigation", { name: "Admin sections" })
		.getByRole("link", { name: "Invites" })
		.click()
	await expect(page).toHaveURL(/\/admin\/invites$/)
	await waitForHydration(page)
	const note = `e2e ${randomUUID().slice(0, 8)}`
	const code = await createInvite(page, note)

	const row = page.getByRole("row").filter({ hasText: code })
	await expect(row).toContainText("Active")
	await expect(row).toContainText(note)
	await row.getByRole("button", { name: "Revoke" }).click()
	await expect(row).toContainText("Revoke this invite?")
	await row.getByRole("button", { name: "Cancel" }).click()
	await expect(row).toContainText("Active")
	await row.getByRole("button", { name: "Revoke" }).click()
	await row.getByRole("button", { name: "Confirm" }).click()
	await expect(row).toContainText("Revoked")
	await expect(row.getByRole("button", { name: "Revoke" })).toHaveCount(0)

	// The revoked code no longer signs anyone up.
	const stranger = await page.context().browser()!.newContext()
	const signup = await stranger.newPage()
	await signup.goto("/signup")
	await signup.getByLabel("Invite code").fill(code)
	await signup.getByLabel("Name").fill("Too Late")
	await signup.getByLabel("Email").fill(`late-${randomUUID()}@example.com`)
	await signup.getByLabel("Password").fill(PASSWORD)
	await signup.getByRole("button", { name: "Create account" }).click()
	await expect(signup.getByText("That invite code is not valid")).toBeVisible()
	await stranger.close()

	// Choosing a status applies it: there is no button to press.
	await page.getByLabel("Status").selectOption("revoked")
	await expect(page).toHaveURL(/status=revoked/)
	await expect(page.getByRole("row").filter({ hasText: code })).toBeVisible()

	await page.getByRole("link", { name: "Audit" }).click()
	await expect(page.getByRole("cell", { name: "Invite created" }).first()).toBeVisible()
	await expect(page.getByRole("cell", { name: "Invite revoked" }).first()).toBeVisible()
	await expect(page.getByRole("cell", { name: "Admin role granted" }).first()).toBeVisible()
	await expect(page.getByRole("main")).not.toContainText(code)
	await expect(page.getByRole("main")).not.toContainText(note)
	const admin = await userByEmail(email)
	const events = await db
		.select()
		.from(adminAuditEvents)
		.where(eq(adminAuditEvents.actorUserId, admin.id))
	expect(events.map((e) => e.action).sort()).toEqual(["invite.create", "invite.revoke"])
})

test("an invite used while the page was open is not revoked, and the refusal says why", async ({
	page,
}) => {
	await signupAdmin(page, "Used Invite Admin")
	await page.goto("/admin/invites")
	await waitForHydration(page)
	const code = await createInvite(page, `e2e ${randomUUID().slice(0, 8)}`)
	// Someone signs up with it before the admin presses Revoke.
	await db.update(invites).set({ usedAt: new Date() }).where(eq(invites.code, code))

	const row = page.getByRole("row").filter({ hasText: code })
	await row.getByRole("button", { name: "Revoke" }).click()
	await row.getByRole("button", { name: "Confirm" }).click()
	await expect(row.getByRole("alert")).toHaveText(
		"That invite was already used. It cannot be revoked.",
	)
})

test("accounts are searchable, and an admin still cannot open another user's article", async ({
	page,
	browser,
}) => {
	const other = await browser.newContext()
	const otherPage = await other.newPage()
	const otherEmail = await signupUser(otherPage, "Private Reader")
	const owner = await userByEmail(otherEmail)
	const articleId = await insertArticle(owner.id, "Private reader title", "<p>Private body</p>")
	await other.close()

	await signupAdmin(page, "Accounts Admin")
	await page.goto("/admin/users")
	await waitForHydration(page)
	await page.getByLabel("Search names and emails").fill(otherEmail)
	await page.getByRole("button", { name: "Search" }).click()
	await expect(page).toHaveURL(/\/admin\/users\?q=/)
	await expect(page.getByRole("row").filter({ hasText: otherEmail })).toHaveCount(1)
	// The header row and the one match: the search ran on the server.
	await expect(page.getByRole("row")).toHaveCount(2)
	await page.getByRole("link", { name: "Private Reader" }).click()
	await expect(page.getByRole("heading", { name: "Account details" })).toBeVisible()
	const main = page.getByRole("main")
	await expect(main).toContainText(owner.id)
	await expect(main).toContainText("Articles")
	await expect(main).not.toContainText("Private reader title")
	// The only changes an admin makes to an account here: a feature in testing, and its free period.
	const ai = main.getByRole("listitem").filter({ hasText: "AI in the reader" })
	await ai.getByRole("button", { name: "Turn on" }).click()
	await expect(ai.getByRole("button", { name: "Turn off" })).toBeVisible()
	await ai.getByRole("button", { name: "Turn off" }).click()
	await expect(ai.getByRole("button", { name: "Turn on" })).toBeVisible()
	// One button a feature, the free period's Save (Clear shows only with a date), and nothing else.
	await expect(main.getByRole("button")).toHaveCount(featureFlags.length + 1)
	await expect(main.getByRole("button", { name: "Save" })).toBeVisible()

	expect((await page.goto(`/read/${articleId}`))?.status()).toBe(404)
	expect((await page.request.get(`/read/${articleId}.data`)).status()).toBe(404)
	expect((await page.request.get(`/api/v1/articles/${articleId}`)).status()).toBe(401)
})

test("a failed extraction is listed without its content and retried once", async ({
	page,
	browser,
}) => {
	const other = await browser.newContext()
	const otherPage = await other.newPage()
	const owner = await userByEmail(await signupUser(otherPage, "Failed Owner"))
	await other.close()
	const [doc] = await db
		.insert(documents)
		.values({
			userId: owner.id,
			// The worker's SSRF guard refuses this host again, without any network request.
			sourceUrl: `http://127.0.0.1/private-path-${randomUUID()}`,
			urlHash: randomUUID(),
			title: "Private failed title",
			status: "failed",
			failureReason: "blocked_host",
		})
		.returning()

	await signupAdmin(page, "Jobs Admin")
	await page.goto("/admin/jobs")
	await waitForHydration(page)
	const row = page.getByTestId(`failed-document-${doc!.id}`)
	await expect(row).toContainText("blocked_host")
	await expect(row).toContainText(owner.id)
	await expect(page.getByRole("main")).not.toContainText("private-path")
	await expect(page.getByRole("main")).not.toContainText("Private failed title")
	await row.getByRole("button", { name: "Retry" }).click()
	const accepted = page.waitForResponse((r) => r.url().includes("/admin/jobs/retry"))
	await row.getByRole("button", { name: "Confirm" }).click()
	expect((await accepted).status()).toBe(202)
	// Admitted, then the list reloads: the worker fails it again (blocked host) or still has it.
	await expect
		.poll(
			async () => (await db.select().from(documents).where(eq(documents.id, doc!.id)))[0]!.status,
		)
		.toBe("failed")
	const events = await db
		.select()
		.from(adminAuditEvents)
		.where(eq(adminAuditEvents.targetId, doc!.id))
	expect(events).toHaveLength(1)
	expect(events[0]!.metadata).toMatchObject({ documentId: doc!.id, ownerId: owner.id })
	await db.delete(documents).where(eq(documents.id, doc!.id))
})

test("the system page shows a live worker, the build and the storage mode", async ({ page }) => {
	await signupAdmin(page, "System Admin")
	await page.goto("/admin/system")
	await expect(page.getByTestId("worker-state")).toHaveAttribute("data-state", "recent")
	await expect(page.getByText("Seen recently")).toBeVisible()
	await expect(page.getByText("Reachable", { exact: true })).toBeVisible()
	await expect(page.getByRole("link", { name: "Uptime monitors" })).toHaveAttribute(
		"href",
		/^https:\/\/uptime\.betterstack\.com\//,
	)
	await expect(page.getByText("Klipstack does not know when the last backup ran.")).toBeVisible()
})

test("an older session reads but cannot write; its own password renews it in place", async ({
	page,
	baseURL,
}) => {
	const email = await signupAdmin(page, "Window Admin")
	await expireWriteWindow(email)
	await page.goto("/admin/invites")
	await waitForHydration(page)
	await expect(page.getByTestId("reauth-banner")).toBeVisible()
	await expect(page.getByRole("button", { name: "Create invite" })).toHaveCount(0)
	await expect(page.getByRole("heading", { name: "Invites" })).toBeVisible()

	const refused = await page.request.post("/admin/invites/create", {
		headers: { origin: baseURL! },
		form: { expiry: "7d", note: "must not exist" },
	})
	expect(refused.status()).toBe(403)
	expect(await refused.text()).toContain("reauthentication_required")

	// No email is asked for: only this account's password renews it.
	await expect(page.getByTestId("reauth-banner").getByLabel("Email")).toHaveCount(0)
	await page.getByLabel("Password").fill("not-the-password")
	await page.getByRole("button", { name: "Confirm" }).click()
	await expect(page.getByText("That password is not right.")).toBeVisible()
	await expect(page.getByTestId("reauth-banner")).toBeVisible()

	await page.getByLabel("Password").fill(PASSWORD)
	await page.getByRole("button", { name: "Confirm" }).click()
	await expect(page.getByTestId("reauth-banner")).toHaveCount(0)
	await expect(page).toHaveURL(/\/admin\/invites$/)
	// Nothing was replayed: the refused invite does not exist, and a new one can be made now.
	await expect(page.getByRole("main")).not.toContainText("must not exist")
	await createInvite(page, "after confirming")

	// Still the same account, and ordinary logout still goes to the plain login page.
	await page.goto("/library")
	await waitForHydration(page)
	await page.getByRole("button", { name: "Account: Window Admin" }).click()
	await page.getByRole("menuitem", { name: "Log out" }).click()
	await expect(page).toHaveURL(/\/login$/)
})

test("foreign-origin, oversized and bearer requests are refused", async ({ page, baseURL }) => {
	await signupAdmin(page, "Origin Admin")
	for (const origin of ["https://evil.example", undefined]) {
		const response = await page.request.post("/admin/invites/create", {
			headers: origin ? { origin } : {},
			form: { expiry: "7d" },
		})
		expect(response.status()).toBe(403)
	}
	const big = await page.request.post("/admin/invites/create", {
		headers: { origin: baseURL! },
		form: { expiry: "7d", note: "x".repeat(20_000) },
	})
	expect(big.status()).toBe(413)
	// A bearer credential is never a browser session, whatever cookies come with it.
	const bearer = await page.request.get("/admin.data", {
		headers: { authorization: "Bearer klip_anything" },
		maxRedirects: 0,
	})
	expect(bearer.status()).not.toBe(200)
	expect(await bearer.text()).not.toContain("accounts")
})

test("admin pages work in Spanish", async ({ page }) => {
	const email = await signupAdmin(page, "Admin Español")
	await db.update(user).set({ locale: "es" }).where(eq(user.email, email))
	await page.goto("/admin")
	await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible()
	await expect(page.getByRole("link", { name: "Volver a la biblioteca" })).toBeVisible()
	await page.getByRole("link", { name: "Invitaciones" }).click()
	await expect(page.getByRole("button", { name: "Crear invitación" })).toBeVisible()
	await page.getByRole("link", { name: "Sistema" }).click()
	await expect(page.getByText("Visto hace poco")).toBeVisible()
})

test("admin sections are reachable and usable with the keyboard alone", async ({ page }) => {
	await signupAdmin(page, "Keyboard Admin")
	await page.goto("/admin")
	await waitForHydration(page)
	await page.getByRole("link", { name: "Back to library" }).focus()
	await page.keyboard.press("Tab")
	await expect(page.getByRole("link", { name: "Overview" })).toBeFocused()
	await page.keyboard.press("Tab")
	await expect(page.getByRole("link", { name: "Activity" })).toBeFocused()
	await page.keyboard.press("Tab")
	await expect(page.getByRole("link", { name: "Invites" })).toBeFocused()
	await page.keyboard.press("Enter")
	await expect(page).toHaveURL(/\/admin\/invites$/)
	await waitForHydration(page)
	await page.getByLabel("Note (optional)").focus()
	const note = `keyboard ${randomUUID().slice(0, 8)}`
	await page.keyboard.type(note)
	await page.keyboard.press("Enter")
	await expect(page.getByTestId("new-invite-code")).toBeVisible()
	const revoke = page
		.getByRole("row")
		.filter({ hasText: note })
		.getByRole("button", { name: "Revoke" })
	await revoke.focus()
	await page.keyboard.press("Enter")
	await page.keyboard.press("Tab")
	await expect(page.getByRole("button", { name: "Confirm" })).toBeFocused()
	await page.keyboard.press("Enter")
	await expect(page.getByRole("row").filter({ hasText: note })).toContainText("Revoked")
})

test.describe("on a phone", () => {
	const { defaultBrowserType: _webkit, ...iphone } = devices["iPhone 13"]
	test.use(iphone)

	test("admin pages fit the screen; wide tables scroll inside their own box", async ({ page }) => {
		await signupAdmin(page, "Phone Admin")
		for (const path of [
			"/admin",
			"/admin/activity",
			"/admin/invites",
			"/admin/users",
			"/admin/jobs",
			"/admin/system",
			"/admin/audit",
		]) {
			await page.goto(path)
			await expect(page.getByTestId("admin-label")).toBeVisible()
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(overflow, path).toBeLessThanOrEqual(0)
		}
		await page.goto("/admin")
		await page.getByRole("link", { name: "Audit" }).click()
		await expect(page).toHaveURL(/\/admin\/audit$/)
	})
})

test("the usage page ranks by AI questions, against each account's cap, with the cost", async ({
	page,
}) => {
	const email = await signupAdmin(page, "AI Spender")
	const admin = await userByEmail(email)
	const month = `${new Date().toISOString().slice(0, 7)}-01`
	await db.insert(usageCounts).values([
		// Far past any other test account's count, so this one leads the ranking.
		{ userId: admin.id, metric: "ai", month, count: 1_000_000 },
		// $1.50 this month, in millionths of a dollar.
		{ userId: admin.id, metric: "ai_spend", month, count: 1_500_000 },
	])

	await page.goto("/admin/usage")
	await waitForHydration(page)
	await page.getByLabel("Rank by").selectOption({ label: "AI questions this month" })
	await expect(page).toHaveURL(/\/admin\/usage\?by=ai$/)
	const first = page.getByRole("row").nth(1)
	await expect(first).toContainText(email)
	// Admins have their own cap: the default, LIMIT_AI_PER_MONTH_ADMIN.
	await expect(first).toContainText("1000000 / 500")
	await expect(first).toContainText("$1.50")
	// The month's total, every account's: at least this one's.
	const total = await page.getByTestId("ai-cost-total").textContent()
	expect(Number(total?.match(/\$([\d,.]+)/)?.[1]?.replace(/,/g, ""))).toBeGreaterThanOrEqual(1.5)
})
