import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import sharp from "sharp"
import {
	lastEmailTo,
	resetLocalIpLimit,
	signupAdmin,
	signupUser,
	uniqueEmail,
	waitForHydration,
} from "./helpers"

const MAKERS = {
	file: join(
		import.meta.dirname,
		"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
	),
	url: "https://paulgraham.com/makersschedule.html",
	quote: "There are two types of schedule",
	title: "Maker's Schedule, Manager's Schedule",
}
/** The report form refuses posts faster than a person could type (FORM_MIN_MS). */
const HUMAN_PAUSE_MS = 3_200

test.beforeEach(() => resetLocalIpLimit("/report-edition"))

/** A saved article with one highlight and its note, from the API; its id. */
async function highlighted(page: Page, note: string) {
	const res = await page.request.post("/api/documents", {
		data: { url: MAKERS.url, html: readFileSync(MAKERS.file, "utf8") },
	})
	const { id } = ((await res.json()) as { article: { id: string } }).article
	await page.goto(`/read/${id}`)
	await expect(page.locator(".reader-content")).toContainText(MAKERS.quote, { timeout: 60_000 })
	const hl = await page.request.post(`/documents/${id}/highlights`, {
		data: { intent: "create", exact: MAKERS.quote, note },
	})
	expect(hl.status()).toBe(201)
	return id
}

/** The Share dialog of the article's highlight; on `tab` when given, else where it opens. */
async function openShare(page: Page, tab?: "Text" | "Link" | "Image") {
	await page.goto("/notebook?view=stream")
	await waitForHydration(page)
	const card = page.getByTestId("quote-card").filter({ hasText: MAKERS.quote })
	await card.hover()
	await card.getByRole("button", { name: "Share", exact: true }).click()
	const dialog = page.getByRole("dialog", { name: "Share highlight" })
	if (tab) await dialog.getByRole("tab", { name: tab }).click()
	return { card, dialog, link: dialog.getByRole("tabpanel") }
}

test("a highlight shared at a link: its page, updates, the Notebook's filter, and stopping", async ({
	page,
	browser,
}) => {
	test.setTimeout(150_000)
	await signupUser(page, "Ada Sharer")
	await highlighted(page, "Makers need long blocks.")

	const { dialog, link } = await openShare(page, "Link")
	await expect(link).toContainText("your note")
	await link.getByRole("button", { name: "Create link" }).click()
	const address = link.getByRole("textbox", { name: "Link address" })
	await expect(address).toHaveValue(/\/h\/[0-9A-Za-z]{12}$/)
	const url = await address.inputValue()
	// The dialog says where every shared highlight is listed, and leads there.
	await link.getByRole("link", { name: "Notebook" }).click()
	await expect(page).toHaveURL(/\/notebook\?show=shared$/)
	await expect(dialog).toBeHidden()
	await expect(page.getByTestId("quote-card")).toHaveCount(1)

	// Anyone with the link: the quote, the note, the article; never the sharer's name.
	const visitorContext = await browser.newContext()
	const visitor = await visitorContext.newPage()
	const res = await visitor.goto(url)
	expect(res?.status()).toBe(200)
	expect(res?.headers()["x-robots-tag"]).toBe("noindex")
	const shared = visitor.getByTestId("shared-highlight")
	await expect(shared).toContainText(MAKERS.quote)
	await expect(shared).toContainText("Makers need long blocks.")
	await expect(visitor.getByRole("link", { name: "Read the article" })).toHaveAttribute(
		"href",
		MAKERS.url,
	)
	await expect(visitor.locator("body")).not.toContainText("Ada Sharer")
	const image = await visitor.locator('meta[property="og:image"]').getAttribute("content")
	const png = await visitor.request.get(new URL(image!).pathname + new URL(image!).search)
	expect(png.headers()["content-type"]).toBe("image/png")

	// The Notebook marks it, and Shared shows only it.
	await page.goto("/notebook?view=stream")
	await waitForHydration(page)
	const card = page.getByTestId("quote-card").filter({ hasText: MAKERS.quote })
	await expect(card.getByRole("button", { name: "Shared" })).toBeVisible()
	await page.getByRole("link", { name: "Shared" }).click()
	await expect(page).toHaveURL(/show=shared/)
	await expect(page.getByTestId("quote-card")).toHaveCount(1)

	// The note changes: the page keeps what was shared until Update link.
	const id = await card.getByRole("link", { name: "Open in article" }).getAttribute("href")
	const highlightId = id!.split("#h=")[1]!
	const documentId = id!.split("/read/")[1]!.split("#")[0]!
	await page.request.post(`/documents/${documentId}/highlights`, {
		form: { intent: "update", id: highlightId, note: "Mornings, not meetings." },
	})
	await visitor.reload()
	await expect(shared).toContainText("Makers need long blocks.")
	// Shared, it opens on its link, whichever way out was chosen last.
	await page.evaluate(() => localStorage.setItem("klipstack:share-tab", "image"))
	const again = await openShare(page)
	await expect(again.dialog.getByRole("tab", { name: "Link" })).toHaveAttribute(
		"aria-selected",
		"true",
	)
	await expect(again.link).toContainText("Update the link")
	await again.link.getByRole("button", { name: "Update link" }).click()
	await expect(again.link.getByRole("button", { name: "Update link" })).toHaveCount(0)
	await visitor.reload()
	await expect(shared).toContainText("Mornings, not meetings.")

	// Without the note, after an update.
	await again.dialog.getByRole("checkbox", { name: "Include my note" }).uncheck()
	await again.link.getByRole("button", { name: "Update link" }).click()
	await expect(again.link.getByRole("button", { name: "Update link" })).toHaveCount(0)
	await visitor.reload()
	await expect(shared).toContainText(MAKERS.quote)
	await expect(shared).not.toContainText("Mornings")

	// Stopped: the page is gone, and the mark with it.
	await again.link.getByRole("button", { name: "Stop sharing" }).click()
	await expect(again.link.getByRole("button", { name: "Create link" })).toBeVisible()
	expect((await visitor.goto(url))?.status()).toBe(410)
	await visitorContext.close()
	await again.dialog.getByRole("button", { name: "Close" }).click()
	await page.goto("/notebook?view=stream")
	await expect(
		page
			.getByTestId("quote-card")
			.filter({ hasText: MAKERS.quote })
			.getByRole("button", { name: "Shared" }),
	).toHaveCount(0)
})

test("a visitor reports a shared highlight, an admin removes it, and it cannot be shared again", async ({
	page,
	browser,
}) => {
	test.setTimeout(150_000)
	const ownerEmail = await signupUser(page, "Share Owner")
	await highlighted(page, "A note.")
	const { dialog, link } = await openShare(page, "Link")
	await link.getByRole("button", { name: "Create link" }).click()
	const url = await link.getByRole("textbox", { name: "Link address" }).inputValue()
	await dialog.getByRole("button", { name: "Close" }).click()
	const publicId = url.split("/h/")[1]!

	const visitorContext = await browser.newContext()
	const visitor = await visitorContext.newPage()
	await visitor.goto(url)
	await visitor.getByRole("link", { name: "Report this page" }).click()
	await waitForHydration(visitor)
	await expect(visitor.getByText(`“${MAKERS.title}”`)).toBeVisible()
	const reporter = uniqueEmail("reporter")
	await visitor.getByLabel("It copies someone's work without permission").check()
	await visitor.getByLabel("Details").fill("A whole chapter.")
	await visitor.getByLabel("Your email (optional)").fill(reporter)
	await visitor.waitForTimeout(HUMAN_PAUSE_MS)
	await visitor.getByRole("button", { name: "Send report" }).click()
	await expect(visitor.getByRole("heading", { name: "Thanks" })).toBeVisible()

	const adminContext = await browser.newContext()
	const admin = await adminContext.newPage()
	await signupAdmin(admin, "Share Reports Admin")
	await admin.goto("/admin/reports")
	await waitForHydration(admin)
	const reported = admin.getByTestId(`reported-${publicId}`)
	await expect(reported).toContainText("Shared highlight · 1 report")
	await expect(reported).toContainText("A whole chapter.")
	await reported.getByLabel("Why, for the owner").fill("It quotes too much of the book.")
	await reported.getByRole("button", { name: "Remove shared highlight" }).click()
	await reported.getByRole("button", { name: "Confirm" }).click()
	await expect(admin.getByRole("status")).toContainText("Removed. The owner was emailed.")
	await adminContext.close()

	const toOwner = await lastEmailTo(ownerEmail)
	expect(toOwner.subject).toBe("We removed a highlight you shared")
	expect(toOwner.text).toContain("It quotes too much of the book.")
	expect(toOwner.text).not.toContain(reporter)

	expect((await visitor.goto(url))?.status()).toBe(410)
	await expect(visitor.getByText("Klipstack took this page down")).toBeVisible()
	await visitorContext.close()

	const after = await openShare(page)
	await expect(after.link).toContainText("taken down after a report")
	await expect(after.link.getByRole("button", { name: "Create link" })).toHaveCount(0)
})

test("a highlight as an image, wide or tall, with or without its note, and no link made", async ({
	page,
}) => {
	test.setTimeout(150_000)
	await signupUser(page, "Ada Pictures")
	await highlighted(page, "Makers need long blocks.")
	// The first time, it opens on text; the arrows move along the tabs.
	const { dialog, link: image } = await openShare(page)
	const textTab = dialog.getByRole("tab", { name: "Text" })
	await expect(textTab).toHaveAttribute("aria-selected", "true")
	await textTab.focus()
	await page.keyboard.press("ArrowLeft")
	const imageTab = dialog.getByRole("tab", { name: "Image" })
	await expect(imageTab).toHaveAttribute("aria-selected", "true")
	await expect(imageTab).toBeFocused()
	const picture = image.getByRole("img", { name: "The highlight as an image" })
	await expect(picture).toBeVisible()
	const size = () =>
		picture.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])
	expect(await size()).toEqual([1200, 630])

	await image.getByRole("radio", { name: "Tall" }).click()
	await expect.poll(size).toEqual([1080, 1920])
	const withNote = await picture.getAttribute("src")
	await dialog.getByRole("checkbox", { name: "Include my note" }).uncheck()
	await expect.poll(() => picture.getAttribute("src")).not.toBe(withNote)

	const [download] = await Promise.all([
		page.waitForEvent("download"),
		image.getByRole("link", { name: "Download" }).click(),
	])
	expect(download.suggestedFilename()).toBe("klipstack-highlight-tall.png")
	const file = await download.path()
	expect(await sharp(file).metadata()).toMatchObject({ width: 1080, height: 1920 })

	// Only a picture: the highlight has no public link.
	await dialog.getByRole("tab", { name: "Link" }).click()
	await expect(
		dialog.getByRole("tabpanel").getByRole("button", { name: "Create link" }),
	).toBeVisible()

	// The next dialog opens where this one was left: on the way out chosen last.
	await dialog.getByRole("tab", { name: "Image" }).click()
	await dialog.getByRole("button", { name: "Close" }).click()
	const next = await openShare(page)
	await expect(next.dialog.getByRole("tab", { name: "Image" })).toHaveAttribute(
		"aria-selected",
		"true",
	)
})
