import { expect, test } from "@playwright/test"
import { createInviteCode, uniqueEmail, waitForHydration, waitForSidebarPrefetch } from "./helpers"

// Runs in every browser project: each engine lays out an input's text its own way.
test("search field: the painted query sits exactly on the typed one", async ({ page }) => {
	const code = await createInviteCode()
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(code)
	await page.getByLabel("Name").fill("Painter")
	await page.getByLabel("Email").fill(uniqueEmail("paint"))
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	// Leaving Home while it still loads its sidebar's route modules cancels them, and React Router
	// answers a failed module with a reload that interrupts the next navigation.
	await waitForSidebarPrefetch(page)

	// Longer than the field, with every kind of token, wide and narrow letters, and gaps.
	const query =
		'in:archive  is:unred "WWW iii mmm lll" site:example.com -author:"Ñandú Wílliams" saved:2026-01..2026-03 zebra quokka wombat illimitable'
	await page.goto(`/search?q=${encodeURIComponent(query)}`)
	await waitForHydration(page)
	const main = page.getByRole("main")
	const field = main.getByRole("searchbox", { name: "Search" })
	const paint = main.getByTestId("search-field-paint")
	await expect(field).toHaveValue(query)
	await expect(paint).toHaveText(query, { useInnerText: false })
	await expect(paint.locator("[data-kind=operator]")).toHaveText([
		"in:archive",
		"site:example.com",
		'-author:"Ñandú Wílliams"',
		"saved:2026-01..2026-03",
	])
	await expect(paint.locator("[data-kind=ignored]")).toHaveText(["is:unred"])

	const measure = () =>
		page.evaluate(async () => {
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
			const input = document.querySelector<HTMLInputElement>("main input[type=search]")!
			const box = document.querySelector<HTMLElement>("main [data-testid=search-field-paint]")!
			const text = box.firstElementChild as HTMLElement
			const style = getComputedStyle(input)
			const inputRect = input.getBoundingClientRect()
			return {
				scrollLeft: input.scrollLeft,
				// By how much the painted text overflows its box.
				painted: text.getBoundingClientRect().width - box.getBoundingClientRect().width,
				offset: -new DOMMatrixReadOnly(getComputedStyle(text).transform).m41,
				// The input's content box against the painted layer's box.
				left:
					inputRect.left +
					Number.parseFloat(style.borderLeftWidth) +
					Number.parseFloat(style.paddingLeft) -
					box.getBoundingClientRect().left,
				right:
					inputRect.right -
					Number.parseFloat(style.borderRightWidth) -
					Number.parseFloat(style.paddingRight) -
					box.getBoundingClientRect().right,
				fonts: [style.font, getComputedStyle(text).font],
			}
		})
	/** Typing at the end scrolls the input as far as it goes: by the width its text overflows. */
	const scrolledToTheEnd = async () => {
		await field.evaluate((el: HTMLInputElement) => {
			el.focus()
			el.setSelectionRange(el.value.length, el.value.length)
		})
		await page.keyboard.type("s")
		return measure()
	}

	const end = await scrolledToTheEnd()
	expect(end.scrollLeft).toBeGreaterThan(100)
	expect(Math.abs(end.left)).toBeLessThanOrEqual(0.5)
	expect(Math.abs(end.right)).toBeLessThanOrEqual(0.5)
	expect(end.fonts[0]).toBe(end.fonts[1])
	// The painted text follows the input's scrolling.
	expect(Math.abs(end.offset - end.scrollLeft)).toBeLessThanOrEqual(0.5)
	// The input scrolled by what the painted text overflows: the two texts are as wide. An engine
	// may keep a pixel or two after the text for the caret (WebKit keeps two).
	const excess = end.scrollLeft - end.painted
	expect(Math.abs(excess)).toBeLessThanOrEqual(3)

	// Back at the start, the painted text is back too.
	await field.evaluate((el: HTMLInputElement) => el.setSelectionRange(1, 1))
	await page.keyboard.press("ArrowLeft")
	const start = await measure()
	expect(start.scrollLeft).toBe(0)
	expect(Math.abs(start.offset)).toBe(0)

	// A misfit between the two texts would grow with their length. It does not: a query half as
	// long again leaves the same excess.
	await field.fill(`${query} ${"illimitable wombat ".repeat(3)}`.slice(0, 199))
	const longer = await scrolledToTheEnd()
	expect(longer.scrollLeft).toBeGreaterThan(end.scrollLeft + 200)
	expect(Math.abs(longer.scrollLeft - longer.painted - excess)).toBeLessThanOrEqual(1)
})
