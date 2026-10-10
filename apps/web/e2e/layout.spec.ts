import { expect, test } from "@playwright/test"
import { createInviteCode, logout, signupUser, uniqueEmail, waitForHydration } from "./helpers"

test("sidebar stays put while long pages scroll", async ({ page }) => {
	const code = await createInviteCode()
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(code)
	await page.getByLabel("Name").fill("Layout")
	await page.getByLabel("Email").fill(uniqueEmail("layout"))
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)

	await page.setViewportSize({ width: 1200, height: 500 })
	await waitForHydration(page)
	// A fresh account has no long page: this one is made long.
	await page.locator("main").evaluate((main) => {
		const filler = document.createElement("div")
		filler.style.height = "3000px"
		main.append(filler)
	})
	const sidebar = page.getByRole("complementary").first()
	const before = await sidebar.boundingBox()
	expect(before?.y).toBe(0)
	expect(before?.height).toBe(500)

	await page.mouse.wheel(0, 2000)
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500)
	const after = await sidebar.boundingBox()
	expect(after?.y).toBe(0)
	expect(after?.height).toBe(500)

	// the logo leads Home
	await waitForHydration(page)
	await sidebar.getByRole("link", { name: "Klipstack" }).click()
	await expect(page).toHaveURL(/\/home$/)
})

test("all routes ship in the initial manifest (no discovery round trips)", async ({ page }) => {
	const manifestRequests: string[] = []
	page.on("request", (r) => {
		if (r.url().includes("/__manifest")) manifestRequests.push(r.url())
	})
	await page.goto("/login")
	await waitForHydration(page)
	await page.getByRole("link", { name: "Sign up" }).click()
	await expect(page).toHaveURL(/\/signup$/)
	expect(manifestRequests).toEqual([])
})

test("unknown URLs render the not-found page with a 404", async ({ page }) => {
	const response = await page.goto("/definitely-not-a-route")
	expect(response?.status()).toBe(404)
	await expect(page.getByRole("heading", { level: 1, name: "Page not found." })).toBeVisible()
})

test("list or grid: a device preference, list by default on desktop, cleared on logout", async ({
	page,
	context,
}) => {
	const code = await createInviteCode()
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(code)
	await page.getByLabel("Name").fill("Grid")
	await page.getByLabel("Email").fill(uniqueEmail("grid"))
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	await waitForHydration(page)
	for (let i = 0; i < 3; i++)
		await page.request.post("/api/documents", { data: { url: `https://example.com/grid/${i}` } })
	await page.goto("/library")
	await waitForHydration(page)
	const list = page.locator("ul[data-layout]")
	await expect(list).toHaveAttribute("data-layout", "auto")
	expect(await list.evaluate((el) => getComputedStyle(el).display)).toBe("flex")

	await page.getByRole("button", { name: "Grid view" }).click()
	await expect(list).toHaveAttribute("data-layout", "grid")
	expect(await list.evaluate((el) => getComputedStyle(el).display)).toBe("grid")
	await page.reload()
	await expect(page.locator("ul[data-layout]")).toHaveAttribute("data-layout", "grid")
	expect((await context.cookies()).find((c) => c.name === "klip_layout")?.value).toBe("grid")

	await logout(page)
	expect((await context.cookies()).find((c) => c.name === "klip_layout")).toBeUndefined()
})

test("the sidebar collapses to a rail, and stays that way", async ({ page }) => {
	const code = await createInviteCode()
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(code)
	await page.getByLabel("Name").fill("Rail")
	await page.getByLabel("Email").fill(uniqueEmail("rail"))
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	await waitForHydration(page)

	const sidebar = page.getByRole("complementary").first()
	const full = (await sidebar.boundingBox())?.width ?? 0
	expect(full).toBeGreaterThan(200)
	await expect(sidebar.getByRole("link", { name: "Library" })).toHaveText(/Library/)

	await page.getByRole("button", { name: "Collapse sidebar" }).click()
	await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(64)
	// icons only, but every entry keeps its name
	await expect(sidebar.getByRole("link", { name: "Library" })).toHaveText("")
	await expect(sidebar.getByRole("button", { name: "Search" })).toBeVisible()
	await expect(sidebar.getByRole("button", { name: /^Account:/ })).toBeVisible()
	await expect(sidebar.getByText("Klipstack")).toHaveCount(0)
	// rail buttons are square, and their tooltips open to the right of the rail
	for (const name of ["Expand sidebar", "Search"]) {
		const box = await sidebar.getByRole("button", { name }).boundingBox()
		expect(box?.width).toBe(box?.height)
	}
	const inbox = sidebar.getByRole("link", { name: "Library" })
	const inboxBox = await inbox.boundingBox()
	expect(inboxBox?.width).toBe(inboxBox?.height)
	await inbox.hover()
	const tip = page.getByTestId("tooltip")
	await expect(tip).toHaveText("Library")
	expect((await tip.boundingBox())?.x).toBeGreaterThan((inboxBox?.x ?? 0) + (inboxBox?.width ?? 0))

	// the account menu is wider than the rail: it opens from the button's left edge, all in view
	const account = sidebar.getByRole("button", { name: /^Account:/ })
	await account.click()
	const menuBox = await page.getByRole("menu").boundingBox()
	expect(menuBox?.x).toBe((await account.boundingBox())?.x)
	expect(menuBox?.y).toBeGreaterThanOrEqual(0)
	await page.keyboard.press("Escape")
	await expect(page.getByRole("menu")).toHaveCount(0)

	// remembered across a reload, and reversible
	await page.reload()
	await waitForHydration(page)
	expect((await sidebar.boundingBox())?.width).toBeLessThan(full / 2)
	await page.getByRole("button", { name: "Expand sidebar" }).click()
	await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(full)
})

test("the sidebar's edge resizes it, within limits, and the width is remembered", async ({
	page,
}) => {
	const code = await createInviteCode()
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(code)
	await page.getByLabel("Name").fill("Wide")
	await page.getByLabel("Email").fill(uniqueEmail("wide"))
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	await waitForHydration(page)

	const sidebar = page.getByRole("complementary").first()
	const width = async () => Math.round((await sidebar.boundingBox())?.width ?? 0)
	await expect.poll(width).toBe(240)
	const edge = page.getByRole("separator", { name: "Resize sidebar" })
	const drag = async (dx: number) => {
		const box = await edge.boundingBox()
		if (!box) throw new Error("no resizer")
		const x = box.x + box.width / 2
		const y = box.y + box.height / 2
		await page.mouse.move(x, y)
		await page.mouse.down()
		await page.mouse.move(x + dx / 2, y)
		await page.mouse.move(x + dx, y)
		await page.mouse.up()
	}

	await drag(80)
	await expect.poll(width).toBe(320)
	await page.reload()
	await waitForHydration(page)
	expect(await width()).toBe(320)

	// folding and unfolding comes back at the same width
	await page.getByRole("button", { name: "Collapse sidebar" }).click()
	await expect.poll(width).toBeLessThan(100)
	await page.getByRole("button", { name: "Expand sidebar" }).click()
	await expect.poll(width).toBe(320)

	// never wider or narrower than the limits
	await drag(400)
	await expect.poll(width).toBe(360)
	await drag(-400)
	await expect.poll(width).toBe(200)

	// the keyboard nudges it; a double-click puts it back
	await edge.focus()
	await page.keyboard.press("ArrowRight")
	await expect.poll(width).toBe(216)
	await edge.dblclick()
	await expect.poll(width).toBe(240)
})

test("every page's header row lines up with the sidebar's", async ({ page }) => {
	await signupUser(page, "Aligned")
	await page.setViewportSize({ width: 1280, height: 800 })
	const middle = (box: { y: number; height: number } | null) => box!.y + box!.height / 2
	for (const path of [
		"/home",
		"/library",
		"/feed",
		"/highlights",
		"/editions",
		"/tags",
		"/search",
		"/settings/account",
		"/add",
	]) {
		await page.goto(path)
		await waitForHydration(page)
		// Settings' sidebar has the way back where the app's has the brand and the collapse button.
		const sidebar = await (
			path.startsWith("/settings")
				? page.getByTestId("settings-back").first()
				: page.getByRole("button", { name: "Collapse sidebar" })
		).boundingBox()
		// The page's first visible row: its title, and the buttons or field beside it.
		const row = await page.locator("main > :not(.sr-only)").first().boundingBox()
		expect(middle(row), path).toBeCloseTo(middle(sidebar), 0)
	}
})
