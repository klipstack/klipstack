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

/** Sets up the authenticator app in Settings: its key and backup codes. */
async function turnOn(page: Page) {
	await page.goto("/settings/account")
	await waitForHydration(page)
	const section = page.getByRole("region", { name: "Two-factor authentication" })
	await section.getByLabel("Password").fill(PASSWORD)
	await section.getByRole("button", { name: "Set up" }).click()
	const key = (await section.getByTestId("two-factor-key").textContent())!
	const backupCodes = await section
		.getByTestId("two-factor-backup-codes")
		.locator("li")
		.allTextContents()
	expect(backupCodes).toHaveLength(10)
	await section.getByLabel("Code").fill(totp(key))
	await section.getByRole("button", { name: "Turn on" }).click()
	await expect(section.getByRole("status")).toHaveText(
		"Two-factor authentication is on. Your other sessions were signed out.",
	)
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
	await expect(page.getByRole("heading", { name: "Ways to log in" })).toBeVisible()
	await expect(page.getByRole("region", { name: "Two-factor authentication" })).toHaveCount(0)
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

test("a backup code signs in once, and turning it off needs a code", async ({ page }) => {
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

	await page.goto("/settings/account")
	await waitForHydration(page)
	const section = page.getByRole("region", { name: "Two-factor authentication" })
	await section.getByLabel("Password").fill(PASSWORD)
	await section.getByLabel("Code").fill("000000")
	await section.getByRole("button", { name: "Turn off" }).click()
	await expect(section.getByText("That code is not right.")).toBeVisible()
	await section.getByLabel("Code").fill(totp(key))
	await section.getByRole("button", { name: "Turn off" }).click()
	await expect(section.getByRole("status")).toHaveText("Two-factor authentication is off.")

	// A password alone signs in again.
	await logout(page)
	await page.goto("/login")
	await waitForHydration(page)
	await login(page, email)
})
