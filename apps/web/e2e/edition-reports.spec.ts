import { db, editionReports, editions, eq, user } from "@klipstack/db"
import { expect, test } from "@playwright/test"
import {
	lastEmailTo,
	resetLocalIpLimit,
	signupAdmin,
	signupUser,
	uniqueEmail,
	waitForHydration,
} from "./helpers"

/** The form refuses posts faster than a person could type (FORM_MIN_MS). */
const HUMAN_PAUSE_MS = 3_200

test.beforeEach(() => resetLocalIpLimit("/report-edition"))

/** A public edition of `email`'s, as publishing writes it. */
async function publishedEdition(email: string) {
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	const [edition] = await db
		.insert(editions)
		.values({
			userId: owner!.id,
			title: "Week 36",
			locale: "en",
			timeZone: "UTC",
			published: {
				v: 1,
				title: "Week 36",
				intro: null,
				authorName: "Edition Owner",
				locale: "en",
				items: [
					{
						url: "https://example.com/a",
						title: "An article",
						author: null,
						siteName: "Example",
						description: null,
						leadImageUrl: null,
						readingMinutes: 5,
						readOn: "2026-09-02",
						note: null,
						highlights: [],
					},
				],
			},
			publishedAt: new Date(),
		})
		.returning({ id: editions.id, publicId: editions.publicId })
	return edition!
}

test("a visitor reports a public edition, an admin removes it, and the owner cannot publish it again", async ({
	page,
	browser,
}) => {
	const ownerEmail = await signupUser(page, "Edition Owner")
	const edition = await publishedEdition(ownerEmail)

	const visitorContext = await browser.newContext()
	const visitor = await visitorContext.newPage()
	await visitor.goto(`/e/${edition.publicId}`)
	await visitor.getByRole("link", { name: "Report this page" }).click()
	await waitForHydration(visitor)
	const reporter = uniqueEmail("reporter")
	await visitor.getByLabel("Spam or misleading").check()
	await visitor.getByLabel("Details").fill("Every link goes to a casino.")
	await visitor.getByLabel("Your email (optional)").fill(reporter)
	await visitor.waitForTimeout(HUMAN_PAUSE_MS)
	await visitor.getByRole("button", { name: "Send report" }).click()
	await expect(visitor.getByRole("heading", { name: "Thanks" })).toBeVisible()

	const adminContext = await browser.newContext()
	const admin = await adminContext.newPage()
	await signupAdmin(admin, "Reports Admin")
	await admin.goto("/admin/reports")
	await waitForHydration(admin)
	const card = admin.getByTestId(`reported-${edition.publicId}`)
	await expect(card).toContainText("Every link goes to a casino.")
	await card.getByLabel("Why, for the owner").fill("Its links all go to a casino.")
	await card.getByRole("button", { name: "Remove edition" }).click()
	await card.getByRole("button", { name: "Confirm" }).click()
	await expect(admin.getByRole("status")).toContainText("Removed. The owner was emailed.")
	await expect(card).toHaveCount(0)
	await adminContext.close()

	const toOwner = await lastEmailTo(ownerEmail)
	expect(toOwner.subject).toBe("We removed your edition “Week 36”")
	expect(toOwner.text).toContain("Its links all go to a casino.")
	expect(toOwner.text).not.toContain(reporter)
	expect((await lastEmailTo(reporter)).subject).toBe("We removed a page you reported")
	expect(
		await db.select().from(editionReports).where(eq(editionReports.editionId, edition.id)),
	).toEqual([])

	const gone = await visitor.goto(`/e/${edition.publicId}`)
	expect(gone?.status()).toBe(410)
	await expect(visitor.getByText("Klipstack took this page down")).toBeVisible()
	await visitorContext.close()

	await page.goto(`/editions/${edition.id}`)
	await waitForHydration(page)
	const status = page.getByTestId("edition-status")
	await expect(status).toContainText("An admin removed this edition")
	await expect(status).toContainText("Its links all go to a casino.")
	await expect(status.getByRole("button", { name: "Publish again" })).toBeDisabled()
})
