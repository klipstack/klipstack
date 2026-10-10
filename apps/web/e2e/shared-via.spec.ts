import { readFileSync } from "node:fs"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { db, documentRaw, documents, documentVia, eq } from "@klipstack/db"
import { expect, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { urlHash } from "./seed"

// An article saved through a post that only shares its link. The worker can't fetch X from a test,
// so the post is written the way the worker leaves it; reading the post instead runs for real.

const FIXTURES = join(import.meta.dirname, "../../../packages/extract/test/fixtures")
const PAGE = readFileSync(join(FIXTURES, "pages/paulgraham-makers.html"), "utf8")
const POST_JSON = readFileSync(join(FIXTURES, "x/thread-jescalan.json"), "utf8")
const POST = "https://x.com/jescalan/status/2098166165000306728"

test("an article saved through a post shows it, and can turn back into it", async ({ page }) => {
	test.setTimeout(120_000)
	await signupUser(page, "Sharer", { verified: false })
	const res = await page.request.post("/api/documents", {
		data: { url: "https://paulgraham.com/makersschedule.html", html: PAGE },
	})
	const { id } = ((await res.json()) as { article: { id: string } }).article
	await page.goto(`/read/${id}`)
	await expect(page.locator(".reader-content")).toContainText("two types of schedule", {
		timeout: 60_000,
	})

	const [raw] = await db
		.insert(documentRaw)
		.values({
			documentId: id,
			rawHtml: gzipSync(Buffer.from(POST_JSON, "utf8")),
			finalUrl: POST,
			httpStatus: 200,
			contentType: "application/json",
			source: "fetch",
			fetchedAt: new Date(Date.now() - 3_600_000),
		})
		.returning({ id: documentRaw.id })
	const [{ userId } = { userId: "" }] = await db
		.select({ userId: documents.userId })
		.from(documents)
		.where(eq(documents.id, id))
	await db.insert(documentVia).values({
		documentId: id,
		userId,
		url: POST,
		urlHash: urlHash(POST),
		author: "Jeff Escalante",
		siteName: "X.com",
		html: '<p>Worth your time: <a href="https://paulgraham.com/makersschedule.html">paulgraham.com/makersschedule…</a></p>',
		publishedAt: new Date("2026-09-30T12:00:00Z"),
		rawId: raw!.id,
	})

	await page.reload()
	await waitForHydration(page)
	const via = page.getByRole("complementary", { name: "Saved from a post" })
	await expect(via).toContainText("Shared by Jeff Escalante · X.com")
	await expect(via).toContainText("Worth your time")
	await expect(via.getByRole("link", { name: "Open the post" })).toHaveAttribute("href", POST)
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/shared-via.png` })

	// Saving the post again finds the article.
	const again = await page.request.post("/api/documents", { data: { url: POST } })
	expect(((await again.json()) as { article: { id: string } }).article.id).toBe(id)

	await via.getByRole("button", { name: "Read the post instead" }).click()
	await expect(page.locator(".reader-content")).toContainText("Rant time", { timeout: 60_000 })
	await expect(page.getByRole("complementary", { name: "Saved from a post" })).toHaveCount(0)
})
