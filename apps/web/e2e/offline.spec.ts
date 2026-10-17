import { readFileSync } from "node:fs"
import { join } from "node:path"
import { db, documents, eq, user } from "@klipstack/db"
import { expect, test } from "@playwright/test"
import { createInviteCode, signupAdmin, signupUser, uniqueEmail, waitForHydration } from "./helpers"
import { insertArticle, storeImage } from "./seed"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const FIXTURE_URL = "https://paulgraham.com/makersschedule.html"

for (const exit of ["logout", "direct", "delete", "switch"] as const) {
	test(`private cached content is removed after ${exit}, including other tabs`, async ({
		page,
		context,
		baseURL,
	}) => {
		const email = await signupUser(page, `Offline ${exit}`)
		const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
		const image = await storeImage(owner!.id, 10, 10, "red")
		const id = await insertArticle(
			owner!.id,
			"Account A private title",
			`<p>Account A private article</p><img src="/assets/${image.id}">`,
		)
		await db.update(documents).set({ note: "Account A private note" }).where(eq(documents.id, id))
		await page.goto(`/read/${id}`)
		await page.evaluate(() => navigator.serviceWorker.ready)
		await page.reload()
		await waitForHydration(page)
		await page.evaluate(async (asset) => {
			await fetch("/library.data")
			await fetch(asset)
		}, `/assets/${image.id}`)
		await expect
			.poll(() =>
				page.evaluate(async (path) => Boolean(await caches.match(path)), `/assets/${image.id}`),
			)
			.toBe(true)
		const other = await context.newPage()
		await other.goto(`/read/${id}`)
		await waitForHydration(other)
		// Exercise the browser fetch path so the controlling worker sees direct sign-outs too.
		if (exit === "delete") {
			await page.evaluate(async (confirmEmail) => {
				await fetch("/settings/delete", {
					method: "POST",
					body: new URLSearchParams({ confirmEmail }),
				})
			}, email)
		} else if (exit === "switch") {
			await page.evaluate(async () => {
				await fetch("/oauth/consent", {
					method: "POST",
					body: new URLSearchParams({ intent: "switch", oauthQuery: "" }),
				})
			})
		} else {
			await page.evaluate(async (direct) => {
				await fetch(direct ? "/api/auth/sign-out" : "/logout", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{}",
				})
			}, exit === "direct")
		}
		await expect(other).toHaveURL(/\/login/)
		await expect
			.poll(() =>
				page.evaluate(
					async () => (await caches.keys()).filter((name) => name.startsWith("private-")).length,
				),
			)
			.toBe(0)
		await context.setOffline(true)
		const paths = ["/library.data", `/read/${id}.data`, `/assets/${image.id}`]
		const offline = await page.evaluate(
			async (paths) =>
				Promise.all(
					paths.map(async (path) => {
						const response = await fetch(path)
						return {
							path,
							status: response.status,
							session: response.headers.get("x-klipstack-session"),
						}
					}),
				),
			paths,
		)
		// Each path listed, so a failure says which one came back and from where.
		expect(offline).toEqual(paths.map((path) => ({ path, status: 503, session: null })))
		await context.setOffline(false)
		await other.close()
		await signupUser(page, "Account B")
		await page.goto("/library")
		await expect(page.getByText("Account A private title")).toHaveCount(0)
		const denied = await page.evaluate(
			async (url) => (await fetch(url)).status,
			`${baseURL}/assets/${image.id}`,
		)
		expect(denied).toBe(404)
	})
}

test("inbox articles open offline after the service worker warmed them", async ({
	page,
	context,
}) => {
	// Against the dev server the offline article never hydrates (the route module answers 503), on
	// `main` as well. Offline reading is a property of the production build: test it there.
	test.skip(!process.env.CI && !process.env.E2E_PROD, "needs the production build (E2E_PROD=1)")
	test.setTimeout(120_000)
	const code = await createInviteCode()
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(code)
	await page.getByLabel("Name").fill("Offline")
	await page.getByLabel("Email").fill(uniqueEmail("offline"))
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	await page.goto("/library")
	await waitForHydration(page)

	const res = await page.request.post("/api/documents", {
		data: { url: FIXTURE_URL, html: readFileSync(FIXTURE, "utf8") },
	})
	const { id } = ((await res.json()) as { article: { id: string } }).article
	await expect(
		page.getByRole("link", { name: "Maker's Schedule, Manager's Schedule" }),
	).toBeVisible({ timeout: 60_000 })

	// the worker registers and warms the article without it ever being opened
	await page.evaluate(() => navigator.serviceWorker.ready)
	await page.waitForFunction(
		async (url) => Boolean(await caches.match(url)) && Boolean(await caches.match(`${url}.data`)),
		`/read/${id}`,
		{ timeout: 30_000 },
	)

	// one full load with the worker in control, so the app's own modules pass through its cache
	// (in production the warm step also caches them from the page's modulepreload links)
	await page.reload()
	await waitForHydration(page)
	// dev only: route modules are separate files fetched on first use, so open the reader once
	// online (production bundles them into chunks the warm step already cached)
	await page.getByRole("link", { name: "Maker's Schedule, Manager's Schedule" }).click()
	await expect(page.locator(".reader-content")).toContainText("There are two types of schedule")
	await page.goBack()
	await expect(page).toHaveURL(/\/library$/)

	await context.setOffline(true)
	await page.goto(`/read/${id}`)
	await expect(page.locator(".reader-content")).toContainText("There are two types of schedule")
	// back to the inbox from a freshly loaded article is a client-side navigation: it needs the
	// list's route data, which the warm-up cached
	await waitForHydration(page)
	await page.getByRole("link", { name: "Back to library" }).click()
	await expect(page).toHaveURL(/\/library$/)
	await expect(
		page.getByRole("link", { name: "Maker's Schedule, Manager's Schedule" }),
	).toBeVisible()
	await page.goto("/library")
	const link = page.getByRole("link", { name: "Maker's Schedule, Manager's Schedule" })
	await expect(link).toBeVisible()
	// client-side navigation offline too (route data comes from the cache)
	await waitForHydration(page)
	await link.click()
	await expect(page).toHaveURL(new RegExp(`/read/${id}$`))
	await expect(page.locator(".reader-content")).toContainText("There are two types of schedule")

	// Sidebar routes can be prefetched. Use a sort never warmed by this session to exercise a
	// genuinely uncached view, then use the shell's sidebar to return to the cached inbox.
	await page.getByRole("link", { name: "Back to library" }).click()
	await expect(page).toHaveURL(/\/library$/)
	await page.getByRole("button", { name: /^Sort/ }).click()
	await page.getByRole("menuitem", { name: "Oldest first" }).click()
	await expect(page.getByRole("heading", { level: 1, name: "You are offline." })).toBeVisible()
	await page.getByRole("complementary").getByRole("link", { name: "Library" }).click()
	await expect(page).toHaveURL(/\/library$/)
	await expect(
		page.getByRole("link", { name: "Maker's Schedule, Manager's Schedule" }),
	).toBeVisible()
	await context.setOffline(false)
})

test("inbox filter chips switch offline, each with its own list", async ({ page, context }) => {
	const email = uniqueEmail("offline-filters")
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(await createInviteCode())
	await page.getByLabel("Name").fill("Offline")
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	const row = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (!row) throw new Error("no user")
	await db.insert(documents).values(
		[
			{ title: "Quick one", minutes: 3 },
			{ title: "Long one", minutes: 40 },
		].map((d, i) => ({
			userId: row.id,
			title: d.title,
			sourceUrl: `https://example.com/offline/${i}`,
			urlHash: `offline-filters-${row.id}-${i}`,
			status: "ready" as const,
			readingMinutes: d.minutes,
		})),
	)

	await page.goto("/library")
	await waitForHydration(page)
	await page.evaluate(() => navigator.serviceWorker.ready)
	// the worker warms the data of every chip on screen, never having opened them
	await expect
		.poll(
			() =>
				page.evaluate(
					async () =>
						Boolean(await caches.match("/library.data?show=quick")) &&
						Boolean(await caches.match("/library.data?show=long")),
				),
			{ timeout: 30_000 },
		)
		.toBe(true)

	await context.setOffline(true)
	const filters = page.getByRole("navigation", { name: "Show" })
	const titles = () => page.locator("main li h3").allInnerTexts()
	await filters.getByRole("link", { name: /^Quick reads/ }).click()
	await expect(page).toHaveURL(/show=quick/)
	await expect.poll(titles).toEqual(["Quick one"])
	await filters.getByRole("link", { name: /^Long reads/ }).click()
	await expect.poll(titles).toEqual(["Long one"])
	// never warmed with this sort: the offline notice, not some other list
	await page.getByRole("button", { name: /^Sort/ }).click()
	await page.getByRole("menuitem", { name: "Oldest first" }).click()
	await expect(page.getByRole("heading", { level: 1, name: "You are offline." })).toBeVisible()
	await context.setOffline(false)
})

test("offline with older cached strings: the UI keeps its words, not raw keys", async ({
	page,
	context,
}) => {
	test.setTimeout(120_000)
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(await createInviteCode())
	await page.getByLabel("Name").fill("Words")
	await page.getByLabel("Email").fill(uniqueEmail("locales"))
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	await page.goto("/library")
	await waitForHydration(page)
	await page.evaluate(() => navigator.serviceWorker.ready)
	await page.reload()
	await waitForHydration(page)
	await expect
		.poll(async () =>
			page.evaluate(async () => {
				for (const name of await caches.keys()) {
					const keys = await (await caches.open(name)).keys()
					if (keys.some((r) => r.url.includes("/api/locales/"))) return true
				}
				return false
			}),
		)
		.toBe(true)

	// A deploy changed the strings: what the worker holds is an older version than the page asks for.
	await page.evaluate(async () => {
		for (const name of await caches.keys()) {
			const cache = await caches.open(name)
			for (const request of await cache.keys()) {
				if (!request.url.includes("/api/locales/")) continue
				const response = await cache.match(request)
				if (response) await cache.put(request.url.replace(/v=[^&]+/, "v=older"), response.clone())
				await cache.delete(request)
			}
		}
	})
	await context.setOffline(true)
	await page.reload()
	await expect(page.getByRole("link", { name: "Library", exact: true })).toBeVisible()
	await expect(page.locator("body")).not.toContainText("nav.library")
	await context.setOffline(false)
})

test("admin pages are never cached, warmed or shown offline", async ({ page, context }) => {
	await signupAdmin(page, "Offline Admin")
	await page.goto("/library")
	await page.evaluate(() => navigator.serviceWorker.ready)
	await page.reload()
	await waitForHydration(page)
	// A worker that controls the page, a client navigation (route data), then document loads.
	await page.getByRole("button", { name: /^Account:/ }).click()
	await page.getByRole("menuitem", { name: "Admin" }).click()
	await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible()
	await page.getByRole("link", { name: "Accounts" }).click()
	await expect(page.getByRole("heading", { name: "Accounts", level: 1 })).toBeVisible()
	await page.goto("/admin/audit")
	await expect(page.getByRole("heading", { name: "Audit", level: 1 })).toBeVisible()
	await page.evaluate(async () => {
		await fetch("/admin.data")
		await fetch("/admin/users.data?q=a")
		navigator.serviceWorker.controller?.postMessage({
			type: "warm",
			identity: document.querySelector('meta[name="cache-identity"]')?.getAttribute("content"),
			pages: ["/admin", "/admin/users"],
			lists: ["/admin/jobs"],
		})
	})
	await page.goto("/library")
	await waitForHydration(page)
	const cached = await page.evaluate(async () => {
		const urls: string[] = []
		for (const name of await caches.keys())
			for (const request of await (await caches.open(name)).keys()) urls.push(request.url)
		return urls
	})
	expect(cached.some((url) => new URL(url).pathname.startsWith("/library"))).toBe(true)
	expect(cached.filter((url) => /^\/admin(?:[/.]|$)/.test(new URL(url).pathname))).toEqual([])

	await context.setOffline(true)
	await page.goto("/admin/users").catch(() => undefined)
	await expect(page.getByRole("heading", { name: "Admin is unavailable offline" })).toBeVisible()
	await expect(page.locator("body")).not.toContainText("@example.com")
	await context.setOffline(false)
})

test("a save that cannot reach the server leaves the reader on screen", async ({ page }) => {
	const email = await signupUser(page, "Offline save")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	const id = await insertArticle(owner!.id, "Still here", "<p>Still here after a failed save.</p>")
	await page.goto(`/read/${id}`)
	await waitForHydration(page)
	await page.route(`**/documents/${id}/state*`, (route) => route.abort("internetdisconnected"))
	const failed = page.waitForEvent("requestfailed", (r) => r.url().includes("/state"))
	await page.getByRole("button", { name: "Star", exact: true }).first().click()
	await failed
	await expect(page.getByText("Still here after a failed save.")).toBeVisible()
	await expect(page.getByRole("button", { name: "Star", exact: true }).first()).toHaveAttribute(
		"aria-pressed",
		"false",
	)
})
