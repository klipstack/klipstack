import { db, documents, eq, inArray, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { createInviteCode, uniqueEmail, waitForHydration } from "./helpers"

const ALPHA = "Alpha, a first article"
const BRAVO = "Bravo, a second article"
const CHARLIE = "Charlie, a third article"
const DELTA = "Delta, a fourth article"

const bulkResponse = (page: Page) =>
	page.waitForResponse(
		(r) => r.url().includes("/documents/bulk") && r.request().method() === "POST",
	)

test("multi-select: check cards by mouse and keys, act on them all, undo", async ({ page }) => {
	test.setTimeout(90_000)
	const email = uniqueEmail("multi")
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(await createInviteCode())
	await page.getByLabel("Name").fill("Many")
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (!owner) throw new Error("Missing multi-select test user")
	// Newest first: Alpha, Bravo, Charlie, Delta.
	const rows = await db
		.insert(documents)
		.values(
			[ALPHA, BRAVO, CHARLIE, DELTA].map((title, i) => ({
				userId: owner.id,
				sourceUrl: `https://example.com/multi/${i}`,
				urlHash: `${owner.id}-${i}`,
				title,
				status: "ready" as const,
				createdAt: new Date(Date.now() - i * 60_000),
			})),
		)
		.returning({ id: documents.id, title: documents.title })
	const idOf = (title: string) => rows.find((r) => r.title === title)!.id
	const starred = async () =>
		(
			await db
				.select({ title: documents.title, starredAt: documents.starredAt })
				.from(documents)
				.where(
					inArray(
						documents.id,
						rows.map((r) => r.id),
					),
				)
		)
			.filter((d) => d.starredAt)
			.map((d) => d.title)

	await page.goto("/library")
	await waitForHydration(page)
	const bar = page.getByRole("toolbar", { name: "Selected articles" })
	const box = (title: string) => page.getByRole("checkbox", { name: `Select “${title}”` })
	const toast = (text: string) => page.getByRole("status").filter({ hasText: text })
	await expect(bar).toHaveCount(0)

	// A box starts the selection; shift-click checks the range
	await box(ALPHA).click()
	await expect(bar).toContainText("1 selected")
	await box(CHARLIE).click({ modifiers: ["Shift"] })
	await expect(bar).toContainText("3 selected")
	await expect(box(BRAVO)).toHaveAttribute("aria-checked", "true")
	// While selecting, a click on a card toggles it instead of opening it
	await page.getByRole("heading", { name: CHARLIE }).click()
	await expect(bar).toContainText("2 selected")
	await expect(page).toHaveURL(/\/library$/)

	// Star them all; undo takes back exactly that
	await Promise.all([bulkResponse(page), bar.getByRole("button", { name: "Star" }).click()])
	await expect(toast("2 articles starred")).toBeVisible()
	await expect(bar.getByRole("button", { name: "Unstar" })).toBeVisible()
	expect((await starred()).sort()).toEqual([ALPHA, BRAVO])
	await Promise.all([
		bulkResponse(page),
		toast("2 articles starred").getByRole("button", { name: "Undo" }).click(),
	])
	await expect(bar.getByRole("button", { name: "Star", exact: true })).toBeVisible()
	expect(await starred()).toEqual([])

	// Tags go on all of them
	await bar.getByRole("button", { name: "Add tags" }).click()
	const dialog = page.getByRole("dialog", { name: "Add tags to 2 articles" })
	await dialog.getByRole("combobox").fill("batch")
	await page.keyboard.press("Enter")
	await Promise.all([
		bulkResponse(page),
		dialog.getByRole("button", { name: "Add", exact: true }).click(),
	])
	await expect(toast("Tags added to 2 articles")).toBeVisible()
	const card = (title: string) =>
		page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title }) })
	await expect(card(ALPHA).getByTestId("card-tags")).toContainText("batch")
	await expect(card(BRAVO).getByTestId("card-tags")).toContainText("batch")

	// Escape clears the selection
	await page.keyboard.press("Escape")
	await expect(bar).toHaveCount(0)

	// Keys: j to Alpha, x checks it, shift+j extends to Bravo; e archives both and they leave
	await page.keyboard.press("j")
	await page.keyboard.press("x")
	await page.keyboard.press("Shift+J")
	await expect(bar).toContainText("2 selected")
	await Promise.all([bulkResponse(page), page.keyboard.press("e")])
	await expect(toast("2 articles archived")).toBeVisible()
	await expect(bar).toHaveCount(0)
	await expect(page.getByRole("heading", { name: ALPHA })).toHaveCount(0)
	await expect(page.getByRole("heading", { name: BRAVO })).toHaveCount(0)

	// ⌘A checks the rest; # sends them to the trash
	await page.keyboard.press("ControlOrMeta+a")
	await expect(bar).toContainText("2 selected")
	await Promise.all([bulkResponse(page), page.keyboard.press("#")])
	await expect(toast("2 articles deleted")).toBeVisible()
	await expect(page.getByRole("heading", { name: CHARLIE })).toHaveCount(0)

	// The trash offers Restore and Delete forever, and nothing else
	await page.goto("/trash")
	await waitForHydration(page)
	await page.keyboard.press("ControlOrMeta+a")
	await expect(bar).toContainText("2 selected")
	await expect(bar.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0)
	await expect(bar.getByRole("button", { name: "Delete forever" })).toBeVisible()
	await expect(bar.getByRole("button", { name: "Star" })).toHaveCount(0)
	await Promise.all([bulkResponse(page), bar.getByRole("button", { name: "Restore" }).click()])
	await expect(toast("2 articles restored")).toBeVisible()
	await expect(page.getByRole("heading", { name: DELTA })).toHaveCount(0)

	// Mark finished: finished and archived, recorded; undo brings them back unfinished
	await page.goto("/library")
	await waitForHydration(page)
	await box(DELTA).click()
	await Promise.all([
		bulkResponse(page),
		bar.getByRole("button", { name: "Mark as finished" }).click(),
	])
	await expect(toast("1 article finished")).toBeVisible()
	await expect(page.getByRole("heading", { name: DELTA })).toHaveCount(0)
	const delta = () => db.query.documents.findFirst({ where: eq(documents.id, idOf(DELTA)) })
	expect((await delta())?.readAt).not.toBeNull()
	await Promise.all([
		bulkResponse(page),
		toast("1 article finished").getByRole("button", { name: "Undo" }).click(),
	])
	await expect(page.getByRole("heading", { name: DELTA })).toBeVisible()
	expect(await delta()).toMatchObject({ readAt: null, archivedAt: null, readingProgress: 0 })
})

test("multi-select on a phone: Select, tap cards, Done", async ({ page }) => {
	test.setTimeout(60_000)
	await page.setViewportSize({ width: 390, height: 844 })
	const email = uniqueEmail("multiphone")
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(await createInviteCode())
	await page.getByLabel("Name").fill("Thumbs")
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (!owner) throw new Error("Missing phone test user")
	await db.insert(documents).values(
		[ALPHA, BRAVO].map((title, i) => ({
			userId: owner.id,
			sourceUrl: `https://example.com/multiphone/${i}`,
			urlHash: `${owner.id}-${i}`,
			title,
			status: "ready" as const,
		})),
	)
	await page.goto("/library")
	await waitForHydration(page)
	const bar = page.getByRole("toolbar", { name: "Selected articles" })
	const top = page.getByRole("banner")
	await top.getByRole("button", { name: "Select", exact: true }).click()
	await expect(bar).toContainText("Tap articles to select them")
	await page.getByRole("heading", { name: ALPHA }).click()
	await page.getByRole("heading", { name: BRAVO }).click()
	await expect(page).toHaveURL(/\/library$/)
	await expect(bar.getByRole("button", { name: "Archive" })).toBeVisible()
	await expect(page.getByRole("checkbox", { name: `Select “${BRAVO}”` })).toHaveAttribute(
		"aria-checked",
		"true",
	)
	await top.getByRole("button", { name: "Done" }).click()
	await expect(bar).toHaveCount(0)

	// In list layout the box takes the place of the card's buttons: the row does not move
	await top.getByRole("button", { name: "List view" }).click()
	const title = page.getByRole("heading", { name: ALPHA })
	const before = await title.boundingBox()
	await top.getByRole("button", { name: "Select", exact: true }).click()
	const alphaBox = page.getByRole("checkbox", { name: `Select “${ALPHA}”` })
	await expect(alphaBox).toBeVisible()
	expect(await title.boundingBox()).toEqual(before)
	const boxAt = await alphaBox.boundingBox()
	expect(boxAt!.x).toBeGreaterThan(before!.x + before!.width)
	await title.click()
	await expect(alphaBox).toHaveAttribute("aria-checked", "true")
})
