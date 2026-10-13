import { db, documents, eq, highlights, user } from "@klipstack/db"
import { expect, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const MONTH_AGO = new Date(Date.now() - 30 * 86_400_000)

test("Home brings back highlights, with their notes written in place and a way to let one go", async ({
	page,
}) => {
	test.setTimeout(60_000)
	const email = await signupUser(page, "Highlights Reader")
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	const userId = owner!.id

	// Nothing highlighted yet: no card.
	await page.goto("/home")
	await waitForHydration(page)
	await expect(page.getByRole("heading", { name: "From your highlights" })).toHaveCount(0)

	const documentId = await insertArticle(userId, "Gardens", "<p>Text</p>")
	const [doc] = await db
		.update(documents)
		.set({ siteName: "gardens.example" })
		.where(eq(documents.id, documentId))
		.returning({ versionId: documents.currentVersionId })
	const base = { userId, documentId, versionId: doc!.versionId!, startOffset: 0, endOffset: 4 }
	const [noted, plain] = await db
		.insert(highlights)
		.values([
			{
				...base,
				exact: "A garden is a slow conversation.",
				note: "Keep this for the talk.",
				color: 2,
				createdAt: MONTH_AGO,
			},
			{ ...base, exact: "Weeds are plants out of place.", createdAt: MONTH_AGO },
		])
		.returning({ id: highlights.id })
	// Made today: too fresh to come back.
	await db.insert(highlights).values({ ...base, exact: "Fresh from this morning." })

	await page.reload()
	await waitForHydration(page)
	const card = page.getByRole("region", { name: "From your highlights" })
	await expect(card.getByTestId("home-highlight")).toHaveCount(2)
	await expect(card).not.toContainText("Fresh from this morning.")
	const first = card.getByTestId("home-highlight").filter({ hasText: "slow conversation" })
	await expect(first).toHaveAttribute("data-hl", "blue")
	await expect(
		first.getByRole("link", { name: "A garden is a slow conversation." }),
	).toHaveAttribute("href", `/read/${documentId}#h=${noted!.id}`)
	await expect(first).toContainText("Gardens · gardens.example")

	// The note is edited on its post-it.
	await first.getByTestId("home-highlight-note").click()
	const field = first.getByRole("textbox", { name: "Note" })
	await expect(field).toHaveText("Keep this for the talk.")
	await field.fill("Quote it in the talk.")
	await first.getByRole("button", { name: "Save" }).click()
	await expect(first.getByTestId("home-highlight-note")).toHaveText("Quote it in the talk.")
	await expect
		.poll(
			async () => (await db.select().from(highlights).where(eq(highlights.id, noted!.id)))[0]?.note,
		)
		.toBe("Quote it in the talk.")

	// One without a note gets one.
	const second = card.getByTestId("home-highlight").filter({ hasText: "Weeds" })
	await second.getByRole("button", { name: "Add a note" }).click()
	await second.getByRole("textbox", { name: "Note" }).fill("Or just plants.")
	await second.getByRole("button", { name: "Save" }).click()
	await expect(second.getByTestId("home-highlight-note")).toHaveText("Or just plants.")

	// Not useful anymore, undone, then for good: the highlight itself stays.
	await second.getByRole("button", { name: "Not useful anymore" }).click()
	await expect(second).toHaveCount(0)
	await page.getByRole("button", { name: "Undo" }).click()
	await expect(second).toHaveCount(1)
	await second.getByRole("button", { name: "Not useful anymore" }).click()
	await expect(second).toHaveCount(0)
	await page.reload()
	await waitForHydration(page)
	await expect(card.getByTestId("home-highlight")).toHaveCount(1)
	const [kept] = await db.select().from(highlights).where(eq(highlights.id, plain!.id))
	expect(kept).toMatchObject({ deletedAt: null, note: "Or just plants." })

	// The last one let go: no card at all.
	await first.getByRole("button", { name: "Not useful anymore" }).click()
	await page.reload()
	await waitForHydration(page)
	await expect(page.getByRole("heading", { name: "From your highlights" })).toHaveCount(0)
})
