import { db, documents, eq, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"

const ALPHA = "Alpha, filed with a stamp"
const BRAVO = "Bravo, filed quietly"
const CHARLIE = "Charlie, thrown away"

/**
 * What the page animated, as it happened: the animations are short, so the test records them
 * instead of catching them on screen (ghosts laid over the page, cards that come in, clips).
 */
async function watchMotion(page: Page) {
	await page.evaluate(() => {
		const seen = {
			ghosts: [] as string[],
			stamps: [] as string[],
			enters: [] as string[],
			clips: 0,
		}
		;(window as unknown as { motion: typeof seen }).motion = seen
		// An element added inside another added at once shows up in both records: count it once.
		const counted = new WeakSet<Element>()
		new MutationObserver((changes) => {
			for (const change of changes) {
				if (change.type === "attributes") {
					const value = (change.target as Element).getAttribute("data-enter")
					if (value) seen.enters.push(value)
					continue
				}
				for (const node of change.addedNodes) {
					if (!(node instanceof Element)) continue
					for (const el of [node, ...node.querySelectorAll("*")]) {
						if (counted.has(el)) continue
						counted.add(el)
						if (el.matches(".motion-ghost")) seen.ghosts.push(el.getAttribute("data-kind") ?? "")
						if (el.matches(".motion-stamp")) seen.stamps.push(el.textContent ?? "")
						if (el.matches("[data-testid='card-clip']")) seen.clips++
						const enter = el.getAttribute("data-enter")
						if (enter) seen.enters.push(enter)
					}
				}
			}
		}).observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["data-enter"],
		})
	})
}

const motion = (page: Page) =>
	page.evaluate(
		() =>
			(
				window as unknown as {
					motion: { ghosts: string[]; stamps: string[]; enters: string[]; clips: number }
				}
			).motion,
	)

test("archiving stamps the card, deleting lifts it, Undo brings it back, saving clips it; none of it with reduced motion", async ({
	page,
}) => {
	const email = await signupUser(page, "Motion")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (!owner) throw new Error("Missing motion test user")
	// Saved yesterday: none of them is new to the list.
	const yesterday = Date.now() - 24 * 60 * 60_000
	await db.insert(documents).values(
		[ALPHA, BRAVO, CHARLIE].map((title, i) => ({
			userId: owner.id,
			sourceUrl: `https://example.com/motion/${i}`,
			urlHash: `${owner.id}-motion-${i}`,
			title,
			status: "ready" as const,
			createdAt: new Date(yesterday - i * 60_000),
		})),
	)
	await page.goto("/library")
	await waitForHydration(page)
	await watchMotion(page)
	const card = (title: string) => page.getByRole("listitem").filter({ hasText: title })

	// Archived: a date stamp on a copy of the card, which goes; the card itself is gone at once.
	await card(ALPHA).hover()
	await card(ALPHA).getByRole("button", { name: "Archive" }).click()
	await expect(card(ALPHA)).toHaveCount(0)
	await expect
		.poll(async () => (await motion(page)).stamps)
		.toEqual([expect.stringContaining("Archived")])
	// Gone after a moment, and never something a click or a test finds as the card.
	await expect(page.locator(".motion-ghost")).toHaveCount(0)

	// Undo: the card comes back into its place.
	await page.getByRole("status").getByRole("button", { name: "Undo" }).click()
	await expect(card(ALPHA)).toHaveCount(1)
	await expect.poll(async () => (await motion(page)).enters).toContain("return")

	// Deleted: lifted away, no stamp.
	await card(CHARLIE).hover()
	await card(CHARLIE).getByRole("button", { name: "More actions" }).click()
	await page.getByRole("menuitem", { name: "Delete" }).click()
	await expect(card(CHARLIE)).toHaveCount(0)
	expect((await motion(page)).ghosts).toEqual(["archive", "lift"])

	// Saved here: the new card comes in with the logo's clip.
	await page.getByRole("button", { name: "Save link" }).first().click()
	const dialog = page.getByRole("dialog", { name: "Save a link" })
	await dialog
		.getByLabel("Link", { exact: true })
		.fill(`https://example.com/motion/new-${Date.now()}`)
	await dialog.getByRole("button", { name: "Save", exact: true }).click()
	await expect.poll(async () => (await motion(page)).clips).toBe(1)
	expect((await motion(page)).enters).toContain("clip")

	// Reduced motion: the same actions, and nothing plays.
	await page.emulateMedia({ reducedMotion: "reduce" })
	await page.reload()
	await waitForHydration(page)
	await watchMotion(page)
	await card(BRAVO).hover()
	await card(BRAVO).getByRole("button", { name: "Archive" }).click()
	await expect(card(BRAVO)).toHaveCount(0)
	await page.getByRole("status").getByRole("button", { name: "Undo" }).click()
	await expect(card(BRAVO)).toHaveCount(1)
	expect(await motion(page)).toEqual({ ghosts: [], stamps: [], enters: [], clips: 0 })
})
