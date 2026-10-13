import { account, db, eq, invites, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import {
	createInviteCode,
	expectNoEmailTo,
	lastEmailTo,
	login,
	logout,
	PASSWORD,
	resetLocalIpLimit,
	signupUser,
	uniqueEmail,
	waitForHydration,
} from "./helpers"

test("public home explains the app and links to the invite request, login, terms, privacy and support", async ({
	page,
}) => {
	const response = await page.goto("/")
	expect(response?.status()).toBe(200)
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Read more of what interests you. Keep what matters.",
	)
	// The playwright server runs the wait list: the page asks for an email. Invites arrive with
	// their own sign-up link, so the page offers none.
	await expect(page.getByRole("button", { name: "Request an invite" }).first()).toBeVisible()
	await expect(page.getByRole("link", { name: "Sign up" })).toHaveCount(0)
	// Link previews: the share card, versioned, described for people who can't see it.
	const alt =
		"Klipstack, a read-later app: Read more of what interests you. Keep what matters. Beside it, an article with a highlighted sentence and a reader's note on a post-it."
	await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
		"content",
		/\/icons\/share-en\.png\?v=\d+$/,
	)
	await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", alt)
	await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute("content", alt)
	await page.getByRole("link", { name: "Terms", exact: true }).click()
	await expect(page).toHaveURL(/\/terms$/)
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of use")
	await expect(page.getByRole("heading", { name: /Public editions$/ })).toBeVisible()
	await page.getByRole("link", { name: "Privacy", exact: true }).click()
	await expect(page).toHaveURL(/\/privacy$/)
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy")
	// Apple checks that the site names the company that publishes the app.
	await expect(page.getByText(`© ${new Date().getUTCFullYear()} Klipstack SpA`)).toBeVisible()
	await expect(page.getByText(/owned and operated by Klipstack SpA/)).toBeVisible()
	// The App Store's support link: public, with an address to write to.
	await page.getByRole("link", { name: "Support", exact: true }).click()
	await expect(page).toHaveURL(/\/support$/)
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Support")
	await expect(page.getByRole("link", { name: "hello@klipstack.com" })).toHaveAttribute(
		"href",
		"mailto:hello@klipstack.com",
	)
	await page.getByRole("link", { name: "Log in", exact: true }).click()
	await expect(page).toHaveURL(/\/login$/)
	await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible()
	for (const name of ["Terms", "Privacy", "Support"])
		await expect(page.getByRole("link", { name, exact: true })).toBeVisible()
})

test("pages run their own scripts only", async ({ page }) => {
	const response = await page.goto("/login")
	const csp = response?.headers()["content-security-policy"] ?? ""
	const nonce = /script-src 'self' 'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1]
	expect(nonce, csp).toBeTruthy()
	expect(csp).toContain("frame-ancestors 'none'")
	// React Router's inline scripts carry the nonce, so the page still hydrates.
	await waitForHydration(page)
	// A script without it (what injected HTML would add) does not run.
	const ran = await page.evaluate(() => {
		const script = document.createElement("script")
		script.textContent = "window.__injected = true"
		document.body.append(script)
		return (window as Window & { __injected?: boolean }).__injected === true
	})
	expect(ran).toBe(false)
})

test("home and login render in Spanish when the browser prefers it", async ({ browser }) => {
	const context = await browser.newContext({ locale: "es-ES" })
	const page = await context.newPage()
	await page.goto("/")
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Lee más de lo que te interesa. Quédate con lo que importa.",
	)
	await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
		"content",
		/\/icons\/share-es\.png\?v=\d+$/,
	)
	await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute(
		"content",
		/^Klipstack, una app para leer después: Lee más de lo que te interesa\. Quédate con lo que importa\. Al lado/,
	)
	await page.getByRole("link", { name: "Iniciar sesión", exact: true }).click()
	await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible()
	await expect(page).toHaveTitle("Iniciar sesión · Klipstack")
	await expect(page.locator("html")).toHaveAttribute("lang", "es")
	await context.close()
})

test("signup requires a valid invite code", async ({ page }) => {
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill("NOPE")
	await page.getByLabel("Name").fill("Nope")
	await page.getByLabel("Email").fill(uniqueEmail())
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(
		page.getByText("That invite code is not valid or has already been used."),
	).toBeVisible()
})

test("better-auth's sign-up endpoint cannot skip the invite check", async ({ request }) => {
	const response = await request.post("/api/auth/sign-up/email", {
		data: { name: "Gatecrasher", email: uniqueEmail("gate"), password: "password123" },
	})
	expect(response.status()).toBe(403)
	expect(response.headers()["set-cookie"]).toBeUndefined()
	expect(await response.json()).toMatchObject({ code: "INVITE_REQUIRED" })
})

test("signup → home → logout → login → settings language switch", async ({ page }) => {
	const code = await createInviteCode()
	const email = uniqueEmail()

	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(code)
	await page.getByLabel("Name").fill("Test Person")
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	await expect(page.getByRole("heading", { name: "Your next read starts here" })).toBeVisible()
	await page.goto("/")
	await page.getByRole("link", { name: "Open Klipstack" }).first().click()
	await expect(page).toHaveURL(/\/home$/)

	// invite is single-use
	await page.goto("/signup")
	await expect(page).toHaveURL(/\/home$/) // already logged in → redirected

	// a full page load: before hydration the account button takes the click and opens nothing
	await waitForHydration(page)
	// The account button has the person's name; its menu has the address too.
	const account = page.getByRole("button", { name: "Account: Test Person" }).first()
	await expect(account).toContainText("Test Person")
	await expect(account).not.toContainText(email)
	await account.click()
	await expect(page.getByRole("menu")).toContainText(email)
	await page.getByRole("menuitem", { name: "Log out" }).click()
	await expect(page).toHaveURL(/\/login$/)

	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill("wrong-password")
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page.getByRole("alert")).toHaveText("Invalid email or password.")

	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL(/\/home$/)

	await page
		.getByRole("button", { name: /^Account:/ })
		.first()
		.click()
	await page.getByRole("menuitem", { name: "Settings" }).click()
	await page.getByLabel("Language").selectOption("es")
	await page.getByRole("button", { name: "Save" }).click()
	await expect(page.getByRole("status")).toHaveText("Ajustes guardados.")
	await expect(page.getByRole("heading", { name: "Perfil" })).toBeVisible()
	await expect(page.locator("html")).toHaveAttribute("lang", "es")
})

test("protected routes redirect to login with redirectTo, and logging in goes back", async ({
	page,
}) => {
	await page.goto("/settings")
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Fsettings$/)

	const email = await signupUser(page, "Return Trip")
	await logout(page)
	await page.goto("/archive?sort=oldest")
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Farchive%3Fsort%3Doldest$/)
	await login(page, email, /\/archive\?sort=oldest$/)
})

test("healthcheck is ok", async ({ request }) => {
	const res = await request.get("/healthcheck")
	expect(res.status()).toBe(200)
})

test("new users can verify from the inbox and see their verified status in Settings", async ({
	page,
}, testInfo) => {
	const email = await signupUser(page, "Verify New", { verified: false })
	await page.goto("/home")
	await waitForHydration(page)
	const reminder = page.getByRole("region", { name: "Verify your email address" })
	await expect(reminder).toContainText(email)
	await page.screenshot({ path: testInfo.outputPath("verification-desktop.png"), fullPage: true })
	await reminder.getByRole("button", { name: "Send verification email" }).click()
	await expect(reminder.getByRole("status")).toContainText(`Check ${email}`)
	await expect(reminder.getByRole("button", { name: "Resend verification email" })).toBeEnabled()
	const link = /href="([^"]*\/verify-email\?token=[^"]*)"/.exec(
		(await lastEmailTo(email)).html,
	)?.[1]
	expect(link).toBeTruthy()
	await page.goto(link!.replaceAll("&amp;", "&"))
	await expect(page).toHaveURL(/\/settings\/account$/)
	await expect(page.getByTestId("email-verified")).toHaveText("Email verified")
	await expect(page.getByRole("button", { name: /verification email/ })).toHaveCount(0)
	await page.goto("/settings/api-keys")
	await expect(page.getByRole("button", { name: "Create key" })).toBeEnabled()
	await page.goto("/library")
	await expect(page.getByRole("region", { name: "Verify your email address" })).toHaveCount(0)
	// Verifying removed nothing: the password still logs in.
	await logout(page)
	await page.goto("/login")
	await login(page, email)
})

test("a verification link opened signed out verifies after a password login", async ({
	page,
	browser,
}) => {
	const email = await signupUser(page, "Verify Elsewhere", { verified: false })
	await page.goto("/settings/account")
	await waitForHydration(page)
	await page.getByRole("button", { name: "Send verification email" }).click()
	await expect(page.getByRole("status")).toContainText(`Check ${email}`)
	const link = /href="([^"]*\/verify-email\?token=[^"]*)"/
		.exec((await lastEmailTo(email)).html)?.[1]
		?.replaceAll("&amp;", "&")
	expect(link).toBeTruthy()

	// Another account cannot use the link for itself or for its owner.
	const strangerContext = await browser.newContext()
	const stranger = await strangerContext.newPage()
	await signupUser(stranger, "Verify Stranger", { verified: false })
	await stranger.goto(link!)
	await expect(stranger).toHaveURL(/\/settings\/account\?error=wrong-account$/)
	await expect(stranger.getByRole("alert")).toHaveText(
		"That link verifies another account. Log in to that account, then open the link again.",
	)
	// Another device: the link alone verifies nothing and asks for the password.
	const context = await browser.newContext()
	const other = await context.newPage()
	await other.goto(link!)
	await expect(other).toHaveURL(/\/login\?redirectTo=%2Fverify-email%3Ftoken%3D/)
	await expect(
		other.getByText("Log in with your password to finish verifying your email."),
	).toBeVisible()
	await expect(other.getByRole("link", { name: "Email me a login link instead" })).toHaveCount(0)
	const [row] = await db.select().from(user).where(eq(user.email, email))
	expect(row?.emailVerified).toBe(false)
	await waitForHydration(other)
	await login(other, email, /\/settings\/account$/)
	await expect(other.getByTestId("email-verified")).toHaveText("Email verified")

	// The first device stayed signed in, and sees it too.
	await page.reload()
	await expect(page.getByTestId("email-verified")).toHaveText("Email verified")

	await context.close()
	await strangerContext.close()
})

test("existing unverified users see the reminder after login and can resend from Settings", async ({
	page,
}) => {
	const email = await signupUser(page, "Verify Existing", { verified: false })
	await logout(page)
	await page.goto("/login")
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill(PASSWORD)
	await page.getByRole("button", { name: "Log in", exact: true }).click()
	await expect(page.getByRole("region", { name: "Verify your email address" })).toBeVisible()
	await page.goto("/settings/api-keys")
	await expect(page.getByRole("button", { name: "Create key" })).toBeDisabled()
	await page.getByRole("link", { name: "Go to Account" }).click()
	await expect(page).toHaveURL(/\/settings\/account$/)
	await waitForHydration(page)
	await page.getByRole("button", { name: "Send verification email" }).click()
	await expect(page.getByRole("status")).toContainText(`Check ${email}`)
	await page.getByRole("button", { name: "Resend verification email" }).click()
	await expect(page.getByRole("button", { name: "Resend verification email" })).toBeEnabled()
	await page.getByRole("button", { name: "Resend verification email" }).click()
	await expect(page.getByRole("button", { name: "Resend verification email" })).toBeEnabled()
	await page.getByRole("button", { name: "Resend verification email" }).click()
	await expect(page.getByRole("alert")).toHaveText("Too many requests. Try again in 15 minutes.")
	await expect(page).toHaveURL(/\/settings\/account$/)
})

test("verification reports delivery failures and expired links without leaving Settings", async ({
	page,
}) => {
	await signupUser(page, "Email Failure", { verified: false })
	await page.goto("/settings/account")
	await waitForHydration(page)
	await page.getByRole("button", { name: "Send verification email" }).click()
	await expect(page.getByRole("alert")).toHaveText("We could not send the email. Please try again.")
	await page.goto("/verify-email?token=expired-link")
	await expect(page).toHaveURL(/\/settings\/account\?error=invalid$/)
	await expect(page.getByRole("alert")).toHaveText(
		"This link has expired or is not valid. Request a new verification email.",
	)
	await expect(page.getByRole("button", { name: "Send verification email" })).toBeEnabled()
})

test("a forgotten password is replaced from an emailed link, which works once", async ({
	page,
	browser,
}) => {
	const email = await signupUser(page, "Forgot Password")
	// A second device stays signed in until the reset.
	const other = await browser.newContext({ storageState: await page.context().storageState() })
	await logout(page)

	await page.goto("/login")
	await page.getByRole("link", { name: "Forgot your password?" }).click()
	await expect(page).toHaveURL(/\/forgot-password$/)
	await waitForHydration(page)
	await page.getByLabel("Email").fill(email)
	await page.getByRole("button", { name: "Send reset link" }).click()
	await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible()

	const message = await lastEmailTo(email)
	expect(message.subject).toBe("Reset your Klipstack password")
	const link = /href="([^"]*\/reset-password\/[^"]*)"/.exec(message.html)?.[1]
	expect(link).toBeTruthy()
	await page.goto(link!.replaceAll("&amp;", "&"))
	await expect(page).toHaveURL(/\/reset-password\?token=/)
	const resetUrl = page.url()
	await waitForHydration(page)
	await page.getByLabel("New password").fill("a-new-password-1")
	await page.getByRole("button", { name: "Save password" }).click()
	await expect(page).toHaveURL(/\/login\?reset=1$/)
	await expect(page.getByRole("status")).toHaveText(
		"Password saved. Log in with your new password.",
	)

	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill(PASSWORD)
	await page.getByRole("button", { name: "Log in", exact: true }).click()
	await expect(page.getByRole("alert")).toHaveText("Invalid email or password.")
	await page.getByLabel("Password").fill("a-new-password-1")
	await page.getByRole("button", { name: "Log in", exact: true }).click()
	await expect(page).toHaveURL(/\/home$/)

	const stale = await other.newPage()
	await stale.goto("/library")
	await expect(stale).toHaveURL(/\/login/)
	// The emailed link and its token are spent.
	await stale.goto(link!.replaceAll("&amp;", "&"))
	await expect(stale.getByRole("heading", { name: "Link expired" })).toBeVisible()
	await stale.goto(resetUrl)
	await waitForHydration(stale)
	await stale.getByLabel("New password").fill("another-password-2")
	await stale.getByRole("button", { name: "Save password" }).click()
	await expect(stale.getByRole("heading", { name: "Link expired" })).toBeVisible()
	await other.close()
})

test("an unknown address gets the same answer and no email", async ({ page }) => {
	const email = uniqueEmail("nobody")
	await page.goto("/forgot-password")
	await waitForHydration(page)
	await page.getByLabel("Email").fill(email)
	await page.getByRole("button", { name: "Send reset link" }).click()
	await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible()
	await expectNoEmailTo(email)
})

/** Fills /signup without a password and returns the emailed confirmation link. */
async function requestSignupLink(page: Page, name: string, email: string, code: string) {
	await resetLocalIpLimit("/sign-in/magic-link")
	await page.goto("/signup")
	await waitForHydration(page)
	await page.getByLabel("Invite code").fill(code)
	await page.getByLabel("Name").fill(name)
	await page.getByLabel("Email").fill(email)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible()
	const message = await lastEmailTo(email)
	expect(message.subject).toBe("Create your Klipstack account")
	const link = /href="([^"]*\/signup\/confirm\?token=[^"]*)"/.exec(message.html)?.[1]
	expect(link).toBeTruthy()
	return link!.replaceAll("&amp;", "&")
}

test("signup without a password creates a verified account from an emailed link", async ({
	page,
}) => {
	const code = await createInviteCode()
	const email = uniqueEmail("link")
	const link = await requestSignupLink(page, "Link Signup", email, code)
	// Nothing exists until the link is confirmed, and opening it is not confirming it.
	expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(0)
	await page.goto(link)
	await expect(page.getByText(email)).toBeVisible()
	expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(0)

	await waitForHydration(page)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	const [row] = await db.select().from(user).where(eq(user.email, email))
	expect(row).toMatchObject({ name: "Link Signup", emailVerified: true, locale: "en" })
	expect(await db.select().from(account).where(eq(account.userId, row!.id))).toHaveLength(0)
	const [invite] = await db.select().from(invites).where(eq(invites.code, code))
	expect(invite?.usedBy).toBe(row!.id)

	// The link works once, and the account logs in with ordinary links from then on.
	await logout(page)
	await page.goto(link)
	await expect(page.getByRole("heading", { name: "Link expired" })).toBeVisible()
	await page.goto("/magic-link")
	await waitForHydration(page)
	await page.getByLabel("Email").fill(email)
	await page.getByRole("button", { name: "Send me a link" }).click()
	await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible()
	expect((await lastEmailTo(email)).subject).toBe("Your Klipstack login link")
})

test("a sign-up link needs a valid invite when requested and when confirmed", async ({
	page,
	request,
}) => {
	const email = uniqueEmail("link-gate")
	await page.goto("/signup")
	await waitForHydration(page)
	await page.getByLabel("Invite code").fill("NOPE")
	await page.getByLabel("Name").fill("Nope")
	await page.getByLabel("Email").fill(email)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(
		page.getByText("That invite code is not valid or has already been used."),
	).toBeVisible()
	await expectNoEmailTo(email)

	// The invite is spent by someone else between the request and the confirmation.
	const code = await createInviteCode()
	const link = await requestSignupLink(page, "Late", email, code)
	await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.code, code))
	await page.goto(link)
	await waitForHydration(page)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page.getByRole("heading", { name: "Invite no longer valid" })).toBeVisible()
	expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(0)

	// better-auth's own endpoint cannot turn the token into an account either.
	const token = new URL(link).searchParams.get("token")
	const direct = await request.get(`/api/auth/magic-link/verify?token=${token}`, {
		maxRedirects: 0,
	})
	expect(direct.headers()["set-cookie"]).toBeUndefined()
	expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(0)
})

test("a sign-up link request for an existing account sends its login link", async ({ page }) => {
	const email = await signupUser(page, "Link Existing")
	await logout(page)
	await resetLocalIpLimit("/sign-in/magic-link")
	await page.goto("/signup")
	await waitForHydration(page)
	await page.getByLabel("Invite code").fill(await createInviteCode())
	await page.getByLabel("Name").fill("Someone Else")
	await page.getByLabel("Email").fill(email)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible()
	expect((await lastEmailTo(email)).subject).toBe("Your Klipstack login link")
})

test("verification reminders fit a phone and use the account language", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 })
	const email = await signupUser(page, "Verify Spanish", { verified: false })
	await db.update(user).set({ locale: "es" }).where(eq(user.email, email))
	await page.goto("/home")
	await expect(page.getByRole("region", { name: "Verifica tu correo electrónico" })).toBeVisible()
	await expect(page.getByRole("button", { name: "Enviar correo de verificación" })).toBeVisible()
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
	await page.screenshot({ path: testInfo.outputPath("verification-mobile.png"), fullPage: true })
})

test("authentication forms bound incoming bytes and never echo passwords", async ({ request }) => {
	for (const path of ["/login", "/login.data", "/signup", "/signup.data"]) {
		const response = await request.post(path, {
			form: { email: "invalid", password: "must-not-be-echoed", padding: "é".repeat(65536) },
		})
		expect(response.status(), path).toBe(413)
		expect(await response.text()).not.toContain("must-not-be-echoed")
		expect(response.headers()["cache-control"]).toContain("no-store")
	}
	const small = await request.post("/login", {
		form: { email: "invalid", password: "must-not-be-echoed", extra: "ignored-field" },
	})
	expect(small.status()).toBe(400)
	expect(await small.text()).not.toContain("must-not-be-echoed")
})
