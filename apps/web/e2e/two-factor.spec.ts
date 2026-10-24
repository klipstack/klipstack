import { createHmac } from "node:crypto"
import { expect, type Page, test } from "@playwright/test"
import { login, logout, PASSWORD, resetLocalIpLimit, signupUser, waitForHydration } from "./helpers"

/** The code an authenticator app shows now for this key (RFC 6238: SHA-1, 6 digits, 30 s). */
function totp(key: string) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
	let bits = ""
	for (const char of key.replace(/\s+/g, ""))
		bits += alphabet.indexOf(char).toString(2).padStart(5, "0")
	const secret = Buffer.from(bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)))
	const counter = Buffer.alloc(8)
	counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
	const mac = createHmac("sha1", secret).update(counter).digest()
	const offset = mac[mac.length - 1]! & 15
	return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0")
}

/** Sets up the authenticator app from Settings → Account: its key and backup codes. */
async function turnOn(page: Page) {
	await page.goto("/settings/account")
	await waitForHydration(page)
	await page.getByRole("link", { name: "Set up Two-factor authentication" }).click()
	await expect(page).toHaveURL(/\/settings\/account\/two-factor$/)
	await page.getByLabel("Password").fill(PASSWORD)
	await page.getByRole("button", { name: "Set up" }).click()
	const key = (await page.getByTestId("two-factor-key").textContent())!
	// The backup codes come only once the app's code turned it on: a password manager that fills
	// the code and sends the form can't hide them.
	await expect(page.getByTestId("two-factor-backup-codes")).toHaveCount(0)
	await page.getByLabel("Code").fill(totp(key))
	await page.getByRole("button", { name: "Turn on" }).click()
	await expect(page.getByRole("status")).toHaveText(
		"Two-factor authentication is on. Your other sessions were signed out.",
	)
	const backupCodes = await page
		.getByTestId("two-factor-backup-codes")
		.locator("li")
		.allTextContents()
	expect(backupCodes).toHaveLength(10)
	// Still there after the page reads the account again; only "Done", once saved, leaves them.
	await expect(page.getByRole("button", { name: "Done" })).toBeDisabled()
	await page.getByLabel("I have saved these codes").check()
	await page.getByRole("link", { name: "Done" }).click()
	await expect(page).toHaveURL(/\/settings\/account$/)
	await expect(page.getByRole("link", { name: "Manage Two-factor authentication" })).toBeVisible()
	return { key, backupCodes }
}

async function passwordStep(page: Page, email: string) {
	await page.goto("/login")
	await waitForHydration(page)
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill(PASSWORD)
	await page.getByRole("button", { name: "Log in", exact: true }).click()
	await expect(page).toHaveURL(/\/login\/code/)
	await waitForHydration(page)
}

test.beforeEach(async () => {
	await resetLocalIpLimit("/sign-in/email")
	await resetLocalIpLimit("/two-factor/verify-totp")
	await resetLocalIpLimit("/two-factor/verify-backup-code")
	await resetLocalIpLimit("/two-factor/settings-code")
})

test("Settings offers two-factor authentication only with its flag", async ({ page }) => {
	await signupUser(page, "No Two Factor")
	await page.goto("/settings/account")
	await expect(page.getByText("Ways to log in")).toBeVisible()
	await expect(page.getByText("Two-factor authentication")).toHaveCount(0)
	await page.goto("/settings/account/two-factor")
	await expect(page).toHaveURL(/\/settings\/account$/)
})

test("after setup, a login asks for the app's code before any session", async ({ page }) => {
	const email = await signupUser(page, "Two Factor", { features: ["two-factor"] })
	const { key } = await turnOn(page)
	await logout(page)

	await passwordStep(page, email)
	// The password alone signed nobody in.
	await page.goto("/settings/account")
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Fsettings%2Faccount$/)

	await passwordStep(page, email)
	await page.getByLabel("Code").fill("000000")
	await page.getByRole("button", { name: "Continue" }).click()
	await expect(page.getByText("That code is not right. Check the app and try again.")).toBeVisible()
	await page.getByLabel("Code").fill(totp(key))
	await page.getByRole("button", { name: "Continue" }).click()
	await expect(page).toHaveURL(/\/home$/)
})

test("a backup code signs in once, new ones replace them, and turning it off needs a code", async ({
	page,
}) => {
	const email = await signupUser(page, "Backup Codes", { features: ["two-factor"] })
	const { key, backupCodes } = await turnOn(page)
	await logout(page)

	await passwordStep(page, email)
	await page.getByLabel("Code").fill(backupCodes[0]!)
	await page.getByRole("button", { name: "Continue" }).click()
	await expect(page).toHaveURL(/\/home$/)
	await logout(page)

	await passwordStep(page, email)
	await page.getByLabel("Code").fill(backupCodes[0]!)
	await page.getByRole("button", { name: "Continue" }).click()
	await expect(page.getByText("That code is not right. Check the app and try again.")).toBeVisible()
	await page.getByLabel("Code").fill(totp(key))
	await page.getByRole("button", { name: "Continue" }).click()
	await expect(page).toHaveURL(/\/home$/)

	// New backup codes: the old unused ones stop working.
	await page.goto("/settings/account/two-factor")
	await waitForHydration(page)
	await page.getByRole("button", { name: "Get new codes…" }).click()
	// One form at a time: the other change waits behind its own button.
	await expect(page.getByRole("form", { name: "Turn off" })).toHaveCount(0)
	const renew = page.getByRole("form", { name: "New backup codes" })
	await renew.getByLabel("Password").fill(PASSWORD)
	await renew.getByLabel("Code").fill(totp(key))
	await renew.getByRole("button", { name: "Get new codes" }).click()
	await expect(page.getByTestId("two-factor-backup-codes").locator("li")).toHaveCount(10)
	const fresh = await page.getByTestId("two-factor-backup-codes").locator("li").allTextContents()
	expect(fresh).toHaveLength(10)
	expect(fresh).not.toContain(backupCodes[1])
	await page.getByLabel("I have saved these codes").check()
	await page.getByRole("link", { name: "Done" }).click()
	await expect(page).toHaveURL(/\/settings\/account$/)

	await page.goto("/settings/account/two-factor")
	await waitForHydration(page)
	await page.getByRole("button", { name: "Turn off…" }).click()
	const off = page.getByRole("form", { name: "Turn off" })
	await off.getByLabel("Password").fill(PASSWORD)
	await off.getByLabel("Code").fill(backupCodes[1]!)
	await off.getByRole("button", { name: "Turn off" }).click()
	await expect(off.getByText("That code is not right.")).toBeVisible()
	await off.getByLabel("Code").fill(fresh[0]!)
	await off.getByRole("button", { name: "Turn off" }).click()
	await expect(page.getByRole("status")).toHaveText("Two-factor authentication is off.")
	// Off, the page offers a new setup, not the last one's code and key.
	await expect(page.getByRole("button", { name: "Set up" })).toBeVisible()
	await expect(page.getByTestId("two-factor-key")).toHaveCount(0)

	// A password alone signs in again.
	await logout(page)
	await page.goto("/login")
	await waitForHydration(page)
	await login(page, email)
})
