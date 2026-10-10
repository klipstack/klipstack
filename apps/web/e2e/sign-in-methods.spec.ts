import { account, and, db, eq, newId, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import {
	createInviteCode,
	logout,
	PASSWORD,
	resetLocalIpLimit,
	signupUser,
	waitForHydration,
} from "./helpers"

/** Answers for GitHub, so the test sees where the browser was sent and nothing leaves the machine. */
async function stopAtGitHub(page: Page) {
	await page.route("https://github.com/**", (route) =>
		route.fulfill({ contentType: "text/html", body: "<title>GitHub</title>" }),
	)
}

test("the GitHub button checks the invite, then hands over to GitHub", async ({ page }) => {
	await stopAtGitHub(page)
	await resetLocalIpLimit("/sign-up/provider")
	await page.goto("/signup")
	await waitForHydration(page)
	await page.getByLabel("Invite code").fill("NOPE")
	await page.getByRole("button", { name: "Continue with GitHub" }).click()
	await expect(
		page.getByText("That invite code is not valid or has already been used."),
	).toBeVisible()

	await page.getByLabel("Invite code").fill(await createInviteCode())
	await page.getByRole("button", { name: "Continue with GitHub" }).click()
	await expect(page).toHaveURL(/^https:\/\/github\.com\/login\/oauth\/authorize\?/)
	const authorize = new URL(page.url())
	expect(authorize.searchParams.get("client_id")).toBe("e2e-client")
	expect(authorize.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/callback\/github$/)
	// The invite stays on the server: the state is an opaque reference.
	expect(page.url()).not.toContain("E2E")
})

test("login offers GitHub and explains a login that has no account", async ({ page }) => {
	await stopAtGitHub(page)
	await page.goto("/login?error=INVITE_REQUIRED")
	await expect(page.getByRole("alert")).toHaveText(
		"No Klipstack account uses that login yet. Sign up with an invite code to create one.",
	)
	await waitForHydration(page)
	await page.getByRole("button", { name: "Continue with GitHub" }).click()
	await expect(page).toHaveURL(/^https:\/\/github\.com\/login\/oauth\/authorize\?/)
})

test("better-auth's own password and provider endpoints are closed", async ({ page }) => {
	await signupUser(page, "Closed Paths")
	for (const path of ["change-password", "link-social", "unlink-account"]) {
		const response = await page.request.post(`/api/auth/${path}`, { data: {} })
		expect(response.status(), path).toBe(404)
	}
})

test("settings sets a first password, changes it, and disconnects a provider", async ({
	page,
	browser,
}) => {
	const email = await signupUser(page, "Sign In Methods")
	const [row] = await db.select().from(user).where(eq(user.email, email))
	// An account made from an emailed link or a provider: no password, GitHub connected.
	await db.delete(account).where(eq(account.userId, row!.id))
	await db
		.insert(account)
		.values({ id: newId(), userId: row!.id, providerId: "github", accountId: `e2e-${row!.id}` })

	await page.goto("/settings/account")
	await waitForHydration(page)
	const methods = page.getByRole("region", { name: "Ways to log in" })
	await expect(methods.getByText("You have no password yet.")).toBeVisible()
	await expect(methods.getByLabel("Current password")).toHaveCount(0)
	await methods.getByLabel("New password").fill("first-password-1")
	await methods.getByRole("button", { name: "Set password" }).click()
	await expect(methods.getByRole("status")).toHaveText("Password saved.")

	// Now it is a change: the current password is asked for, and other devices are signed out.
	const other = await browser.newContext({ storageState: await page.context().storageState() })
	await expect(methods.getByRole("button", { name: "Change password" })).toBeVisible()
	await methods.getByLabel("Current password").fill("not-the-password")
	await methods.getByLabel("New password").fill("second-password-2")
	await methods.getByRole("button", { name: "Change password" }).click()
	await expect(methods.getByText("That is not your current password.")).toBeVisible()
	await methods.getByLabel("Current password").fill("first-password-1")
	await methods.getByRole("button", { name: "Change password" }).click()
	await expect(methods.getByRole("status")).toHaveText("Password saved.")
	const stale = await other.newPage()
	await stale.goto("/library")
	await expect(stale).toHaveURL(/\/login/)
	await other.close()

	await expect(methods.getByTestId("linked-github")).toHaveText("Connected")
	await methods.getByRole("button", { name: "Disconnect GitHub" }).click()
	await expect(methods.getByRole("button", { name: "Connect GitHub", exact: true })).toBeVisible()
	expect(
		await db
			.select()
			.from(account)
			.where(and(eq(account.userId, row!.id), eq(account.providerId, "github"))),
	).toHaveLength(0)

	// This browser stayed signed in, and the new password works.
	await logout(page)
	await page.goto("/login")
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill(PASSWORD)
	await page.getByRole("button", { name: "Log in", exact: true }).click()
	await expect(page.getByRole("alert")).toHaveText("Invalid email or password.")
	await page.getByLabel("Password").fill("second-password-2")
	await page.getByRole("button", { name: "Log in", exact: true }).click()
	await expect(page).toHaveURL(/\/home$/)
})

test("an unverified account adds no password or provider", async ({ page }) => {
	await signupUser(page, "Sign In Unverified", { verified: false })
	await page.goto("/settings/account")
	const methods = page.getByRole("region", { name: "Ways to log in" })
	await expect(
		methods.getByText("Verify your email address before you add a password or connect an account."),
	).toBeVisible()
	await expect(methods.getByRole("button", { name: "Change password" })).toBeDisabled()
	await expect(methods.getByRole("button", { name: "Connect GitHub", exact: true })).toBeDisabled()
	const response = await page.request.post("/settings/sign-in", {
		form: { intent: "link", provider: "github" },
	})
	expect(response.status()).toBe(403)
})
