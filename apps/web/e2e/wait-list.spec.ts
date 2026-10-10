import { db, eq, inviteRequests } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import {
	expectNoEmailTo,
	lastEmailTo,
	PASSWORD,
	resetLocalIpLimit,
	signupAdmin,
	uniqueEmail,
	waitForHydration,
} from "./helpers"

/** The form refuses posts faster than a person could type (FORM_MIN_MS). */
const HUMAN_PAUSE_MS = 3_200

const stored = (email: string) =>
	db.select().from(inviteRequests).where(eq(inviteRequests.email, email))

async function requestInvite(page: Page, email: string, note = "") {
	await page.goto("/request-invite")
	await waitForHydration(page)
	await page.getByLabel("Email").fill(email)
	if (note) await page.getByLabel("What would you use Klipstack for? (optional)").fill(note)
	await page.waitForTimeout(HUMAN_PAUSE_MS)
	await page.getByRole("button", { name: "Request an invite" }).click()
	await expect(page.getByRole("heading", { name: "Thanks" })).toBeVisible()
}

test.beforeEach(() => resetLocalIpLimit("/request-invite"))

test("a stranger asks for an invite, an admin sends it, and its link signs them up", async ({
	page,
	browser,
}) => {
	const email = uniqueEmail("waitlist")
	// The landing page's last form, the one with the note, posts to the request page.
	await page.goto("/")
	await waitForHydration(page)
	const form = page.locator("#invite")
	await form.getByLabel("Email address").fill(email)
	await form.getByLabel("What would you use Klipstack for? (optional)").fill("Reading group notes")
	await page.waitForTimeout(HUMAN_PAUSE_MS)
	await form.getByRole("button", { name: "Request an invite" }).click()
	await expect(page).toHaveURL(/\/request-invite$/)
	await expect(page.getByRole("heading", { name: "Thanks" })).toBeVisible()

	const adminContext = await browser.newContext()
	const admin = await adminContext.newPage()
	await signupAdmin(admin, "Waitlist Admin")
	await admin.goto("/admin/requests")
	await waitForHydration(admin)
	const row = admin.getByRole("row").filter({ hasText: email })
	await expect(row).toContainText("Reading group notes")
	await row.getByRole("button", { name: "Send invite" }).click()
	await row.getByRole("button", { name: "Confirm" }).click()
	await expect(admin.getByRole("status")).toContainText(`Invite emailed to ${email}`)
	const code = (await admin.getByTestId("request-invite-code").textContent())?.trim()
	expect(code).toMatch(/^[A-Z0-9]{8}$/)
	await expect(row).toHaveCount(0)
	await adminContext.close()

	const message = await lastEmailTo(email)
	expect(message.subject).toBe("Your Klipstack invite")
	const link = /https?:\/\/\S+\/signup\?invite=[A-Z0-9]+/.exec(message.text ?? "")?.[0]
	expect(link).toContain(`invite=${code}`)

	await resetLocalIpLimit("/sign-up/email")
	await page.goto(new URL(link!).pathname + new URL(link!).search)
	await expect(page.getByLabel("Invite code")).toHaveValue(code!)
	await page.getByLabel("Name").fill("Waitlisted")
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill(PASSWORD)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
})

test("an admin dismisses a request, and nobody is emailed", async ({ page }) => {
	const email = uniqueEmail("waitlist")
	await requestInvite(page, email)
	await signupAdmin(page, "Dismiss Admin")
	await page.goto("/admin/requests")
	await waitForHydration(page)
	const row = page.getByRole("row").filter({ hasText: email })
	await row.getByRole("button", { name: "Dismiss" }).click()
	await row.getByRole("button", { name: "Confirm" }).click()
	await expect(row).toHaveCount(0)
	expect(await stored(email)).toHaveLength(0)
	await expectNoEmailTo(email)
})

test("bots get the same thanks, and nothing is stored", async ({ page }) => {
	// The hidden field only a bot fills.
	const trapped = uniqueEmail("waitlist")
	await page.goto("/request-invite")
	await waitForHydration(page)
	await page.getByLabel("Email").fill(trapped)
	await page.locator('input[name="kp_extra"]').fill("http://spam.example")
	await page.waitForTimeout(HUMAN_PAUSE_MS)
	await page.getByRole("button", { name: "Request an invite" }).click()
	await expect(page.getByRole("heading", { name: "Thanks" })).toBeVisible()

	// A post faster than anyone could type: the form's token, sent back at once.
	const hasty = uniqueEmail("waitlist")
	const html = await (await page.request.get("/request-invite")).text()
	const started = /name="started" value="([^"]+)"/.exec(html)?.[1]
	expect(started).toBeTruthy()
	const answer = await page.request.post("/request-invite", {
		form: { email: hasty, started: started! },
	})
	expect(answer.status()).toBe(200)
	expect(await answer.text()).toContain("Thanks")

	expect(await stored(trapped)).toHaveLength(0)
	expect(await stored(hasty)).toHaveLength(0)
})

test("the sign-up page points to the request form", async ({ page }) => {
	await page.goto("/signup")
	await page.getByRole("link", { name: "Request an invite" }).click()
	await expect(page).toHaveURL(/\/request-invite$/)
	await expect(page.getByRole("heading", { name: "Request an invite" })).toBeVisible()
})
