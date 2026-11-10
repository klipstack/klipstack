import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ToastOptions } from "./toast"

/**
 * The background as the browser runs it: its listeners, fired as a click fires them, against a
 * browser that records the badge, the toasts and the tabs, and a server that answers when told.
 * Only the process boundary stands in: the browser's APIs and `fetch`.
 */

const APP = "https://klipstack.test"
const PAGE = "https://a.example/story"

type Listener = (...args: never[]) => unknown

/** A promise and the function that settles it, for an answer the test lets through later. */
function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((r) => {
		resolve = r
	})
	return { promise, resolve }
}

function fakeBrowser() {
	const on = () => {
		const listeners: Listener[] = []
		return { listeners, addListener: (fn: Listener) => void listeners.push(fn) }
	}
	const state = {
		/** The badge's text, per tab. */
		badge: new Map<number, string>(),
		toasts: [] as { tabId: number; toast: ToastOptions }[],
		storage: {} as Record<string, unknown>,
		/** Tabs the extension opened: their addresses. */
		opened: [] as string[],
		closed: [] as number[],
		captures: 0,
	}
	const browser = {
		runtime: { onInstalled: on() },
		contextMenus: { create: () => {}, onClicked: on() },
		action: {
			onClicked: on(),
			setBadgeBackgroundColor: async () => {},
			setBadgeText: async ({ tabId, text }: { tabId: number; text: string }) => {
				state.badge.set(tabId, text)
			},
		},
		i18n: { getMessage: (key: string) => key },
		permissions: { request: async () => true, contains: async () => true },
		storage: {
			local: {
				get: async (key: string) => (key in state.storage ? { [key]: state.storage[key] } : {}),
				set: async (items: Record<string, unknown>) => void Object.assign(state.storage, items),
				remove: async (key: string) => void delete state.storage[key],
			},
		},
		tabs: {
			onUpdated: on(),
			create: async ({ url }: { url: string }) => {
				state.opened.push(url)
				return { id: 900 + state.opened.length, url }
			},
			remove: async (tabId: number) => void state.closed.push(tabId),
			update: async () => ({}),
			get: async (tabId: number) => ({ id: tabId, url: PAGE }),
		},
		scripting: {
			executeScript: async ({
				target,
				func,
				args,
			}: {
				target: { tabId: number }
				func: { name: string }
				args?: unknown[]
			}) => {
				if (func.name === "showToast") {
					state.toasts.push({ tabId: target.tabId, toast: args![0] as ToastOptions })
					return [{ result: undefined }]
				}
				state.captures++
				return [{ result: { url: PAGE, title: "Story", html: "<html></html>", servedHtml: null } }]
			},
		},
	}
	return { browser, state }
}

/** The server: answers each request with `answer`, or holds the saves until `release`. */
function fakeServer() {
	const saves: {
		url: string
		auth: string | null
		body: Record<string, unknown>
		release: (res: Response) => void
	}[] = []
	const tokenRequests: URLSearchParams[] = []
	let tokenAnswer = () =>
		Response.json({ access_token: "a1", refresh_token: "r1", expires_in: 3600 })
	const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
		if (url.endsWith("/api/auth/oauth2/token")) {
			tokenRequests.push(new URLSearchParams(String(init?.body)))
			return tokenAnswer()
		}
		const answer = deferred<Response>()
		const headers = new Headers(init?.headers)
		saves.push({
			url,
			auth: headers.get("authorization"),
			body: JSON.parse(String(init?.body)) as Record<string, unknown>,
			release: answer.resolve,
		})
		return answer.promise
	})
	return {
		fetchImpl,
		saves,
		tokenRequests,
		answerTokens(answer: () => Response) {
			tokenAnswer = answer
		},
		saved: (id = "11111111-1111-1111-1111-111111111111") =>
			Response.json({ article: { id }, created: true }, { status: 201 }),
	}
}

const realSetTimeout = globalThis.setTimeout

/**
 * Lets the background run until it waits on something the test controls: its awaits between
 * browser calls, and the hashing of a sign-in's verifier, which runs outside the fake clock.
 */
async function settle() {
	for (let round = 0; round < 10; round++) {
		await new Promise((resolve) => realSetTimeout(resolve, 1))
		await vi.advanceTimersByTimeAsync(0)
	}
}

async function loadBackground({ tokenAuth }: { tokenAuth: boolean }) {
	const { browser, state } = fakeBrowser()
	const server = fakeServer()
	vi.resetModules()
	vi.stubGlobal("__APP_URL__", APP)
	vi.stubGlobal("__HOST_PERMISSION__", `${APP}/*`)
	vi.stubGlobal("__TOKEN_AUTH__", tokenAuth)
	vi.stubGlobal("fetch", server.fetchImpl)
	vi.doMock("wxt/browser", () => ({ browser }))
	vi.doMock("wxt/utils/define-background", () => ({ defineBackground: (main: () => void) => main }))
	const { default: main } = (await import("../entrypoints/background")) as unknown as {
		default: () => void
	}
	main()
	const fire = (event: { listeners: Listener[] }, ...args: unknown[]) => {
		for (const listener of event.listeners) (listener as (...a: unknown[]) => unknown)(...args)
	}
	return {
		browser,
		state,
		server,
		/** The reader clicks the toolbar button on `tabId`. */
		click: (tabId: number, url = PAGE) => fire(browser.action.onClicked, { id: tabId, url }),
		/** The reader saves a link from the page in `tabId`, with its context menu. */
		saveLink: (tabId: number, linkUrl: string) =>
			fire(browser.contextMenus.onClicked, { menuItemId: "save-link", linkUrl }, { id: tabId }),
		/** A tab the extension opened reaches `url` (the sign-in's callback). */
		navigate: (tabId: number, url: string) =>
			fire(browser.tabs.onUpdated, tabId, { url }, { id: tabId, url }),
		toastsOf: (tabId: number) => state.toasts.filter((t) => t.tabId === tabId).map((t) => t.toast),
	}
}

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
	vi.doUnmock("wxt/browser")
	vi.doUnmock("wxt/utils/define-background")
})

describe("saving with the browser's session", () => {
	it("shows the save in progress, then the outcome, then clears the badge", async () => {
		const bg = await loadBackground({ tokenAuth: false })
		bg.click(1)
		await settle()
		expect(bg.state.badge.get(1)).toBe("…")
		expect(bg.toastsOf(1).map((t) => t.kind)).toEqual(["saving"])
		// The page as the reader sees it, captured in the tab.
		expect(bg.server.saves.map((s) => s.body)).toEqual([
			{ url: PAGE, html: "<html></html>", source: "extension" },
		])

		bg.server.saves[0]!.release(bg.server.saved())
		await settle()
		expect(bg.state.badge.get(1)).toBe("✓")
		expect(bg.toastsOf(1).at(-1)).toMatchObject({
			kind: "saved",
			link: { href: `${APP}/read/11111111-1111-1111-1111-111111111111` },
		})

		await vi.advanceTimersByTimeAsync(2500)
		expect(bg.state.badge.get(1)).toBe("")
	})

	it("says why a save failed", async () => {
		const bg = await loadBackground({ tokenAuth: false })
		bg.click(1)
		await settle()
		bg.server.saves[0]!.release(
			Response.json(
				{ error: { code: "limit_reached", details: { limit: "storage" } } },
				{ status: 403 },
			),
		)
		await settle()
		expect(bg.state.badge.get(1)).toBe("!")
		expect(bg.toastsOf(1).at(-1)).toEqual({
			kind: "error",
			title: "toastLibraryFull",
			link: { label: "toastUsage", href: `${APP}/settings/usage` },
			ms: 8000,
		})

		bg.click(1)
		await settle()
		bg.server.saves[1]!.release(new Response("", { status: 502 }))
		await settle()
		expect(bg.toastsOf(1).at(-1)).toEqual({ kind: "error", title: "toastFailed", ms: 6000 })
	})

	it("sends a link from the menu by its address alone", async () => {
		const bg = await loadBackground({ tokenAuth: false })
		bg.saveLink(1, "https://c.example/linked")
		await settle()
		expect(bg.state.captures).toBe(0)
		expect(bg.server.saves.map((s) => s.body)).toEqual([
			{ url: "https://c.example/linked", html: null, source: "extension" },
		])
		bg.server.saves[0]!.release(bg.server.saved())
		await settle()
		expect(bg.state.badge.get(1)).toBe("✓")
	})

	it("flashes ! on a page it can't capture, and sends nothing", async () => {
		const bg = await loadBackground({ tokenAuth: false })
		bg.click(1, "chrome://settings")
		await settle()
		expect(bg.state.badge.get(1)).toBe("!")
		expect(bg.server.saves).toHaveLength(0)
		await vi.advanceTimersByTimeAsync(2500)
		expect(bg.state.badge.get(1)).toBe("")
	})

	it("says it needs the server when the reader withholds it, and sends nothing", async () => {
		const bg = await loadBackground({ tokenAuth: false })
		bg.browser.permissions.request = async () => false
		bg.click(1)
		await settle()
		expect(bg.state.badge.get(1)).toBe("!")
		expect(bg.toastsOf(1)).toEqual([{ kind: "error", title: "toastNoAccess", ms: 10000 }])
		expect(bg.server.saves).toHaveLength(0)
	})

	it("keeps a new save's badge when the last one's outcome fades", async () => {
		const bg = await loadBackground({ tokenAuth: false })
		bg.click(1)
		await settle()
		bg.server.saves[0]!.release(bg.server.saved())
		await settle()
		expect(bg.state.badge.get(1)).toBe("✓")

		// A second save a second later, still sending when the first one's ✓ would fade.
		await vi.advanceTimersByTimeAsync(1000)
		bg.click(1)
		await settle()
		expect(bg.state.badge.get(1)).toBe("…")
		await vi.advanceTimersByTimeAsync(2000)
		expect(bg.state.badge.get(1)).toBe("…")
	})
})

describe("saving with the extension's own sign-in", () => {
	const signedIn = {
		tokens: { accessToken: "a0", refreshToken: "r0", expiresAt: Date.UTC(2100, 0, 1) },
	}

	it("signs in first, then saves the page that asked, with the new token", async () => {
		const bg = await loadBackground({ tokenAuth: true })
		bg.click(1)
		await settle()
		expect(bg.state.opened).toHaveLength(1)
		expect(bg.toastsOf(1)).toEqual([{ kind: "saving", title: "toastConnect", ms: 20000 }])
		expect(bg.server.saves).toHaveLength(0)

		const state = new URL(bg.state.opened[0]!).searchParams.get("state")
		// A callback this extension didn't start is never exchanged, and its tab stays.
		bg.navigate(950, `${APP}/extension/connected?code=forged&state=not-ours`)
		await settle()
		expect(bg.server.tokenRequests).toHaveLength(0)
		expect(bg.state.closed).toEqual([])

		bg.navigate(901, `${APP}/extension/connected?code=c1&state=${state}`)
		// The tab reports its address more than once: the code is exchanged once.
		bg.navigate(901, `${APP}/extension/connected?code=c1&state=${state}`)
		await settle()
		expect(bg.server.tokenRequests.map((r) => r.get("code"))).toEqual(["c1"])
		expect(bg.state.closed).toEqual([901])
		expect(bg.state.storage.tokens).toMatchObject({ accessToken: "a1", refreshToken: "r1" })
		expect(bg.server.saves.map((s) => [s.url, s.auth])).toEqual([
			[`${APP}/api/v1/articles`, "Bearer a1"],
		])
		bg.server.saves[0]!.release(bg.server.saved())
		await settle()
		expect(bg.toastsOf(1).at(-1)).toMatchObject({ kind: "saved" })
	})

	it("says so when the reader refuses the sign-in", async () => {
		const bg = await loadBackground({ tokenAuth: true })
		bg.saveLink(1, "https://c.example/linked")
		await settle()
		const state = new URL(bg.state.opened[0]!).searchParams.get("state")
		bg.navigate(901, `${APP}/extension/connected?error=access_denied&state=${state}`)
		await settle()
		expect(bg.state.closed).toEqual([901])
		expect(bg.state.badge.get(1)).toBe("!")
		expect(bg.toastsOf(1).at(-1)).toEqual({ kind: "error", title: "toastNotConnected", ms: 8000 })
		expect(bg.server.saves).toHaveLength(0)
	})

	it("refreshes a refused token once, and sends again with the new one", async () => {
		const bg = await loadBackground({ tokenAuth: true })
		Object.assign(bg.state.storage, signedIn)
		bg.click(1)
		await settle()
		bg.server.saves[0]!.release(Response.json({ error: { code: "unauthorized" } }, { status: 401 }))
		await settle()
		expect(bg.server.tokenRequests.map((r) => r.get("refresh_token"))).toEqual(["r0"])
		expect(bg.server.saves.map((s) => s.auth)).toEqual(["Bearer a0", "Bearer a1"])
		bg.server.saves[1]!.release(bg.server.saved())
		await settle()
		expect(bg.state.badge.get(1)).toBe("✓")
	})

	it("clears the badge when the sign-in is gone and the save waits for a new one", async () => {
		const bg = await loadBackground({ tokenAuth: true })
		Object.assign(bg.state.storage, signedIn)
		// The reader disconnected the extension: the server refuses the token and its refresh.
		bg.server.answerTokens(() => Response.json({ error: "invalid_grant" }, { status: 400 }))
		bg.click(1)
		await settle()
		expect(bg.state.badge.get(1)).toBe("…")
		bg.server.saves[0]!.release(Response.json({ error: { code: "unauthorized" } }, { status: 401 }))
		await settle()

		// It opened the sign-in, and says so; the reader then abandons that tab.
		expect(bg.state.opened).toHaveLength(1)
		expect(bg.toastsOf(1).at(-1)).toMatchObject({ kind: "saving", title: "toastConnect" })
		// No badge while the save waits for the sign-in, as when the first one opens it.
		expect(bg.state.badge.get(1)).toBe("")
		await vi.advanceTimersByTimeAsync(60_000)
		expect(bg.state.badge.get(1)).toBe("")
	})

	it("saves the link, not the page, once the reader signs in again", async () => {
		const bg = await loadBackground({ tokenAuth: true })
		Object.assign(bg.state.storage, signedIn)
		bg.server.answerTokens(() => Response.json({ error: "invalid_grant" }, { status: 400 }))
		bg.saveLink(1, "https://c.example/linked")
		await settle()
		bg.server.saves[0]!.release(Response.json({ error: { code: "unauthorized" } }, { status: 401 }))
		await settle()

		bg.server.answerTokens(() =>
			Response.json({ access_token: "a1", refresh_token: "r1", expires_in: 3600 }),
		)
		const state = new URL(bg.state.opened[0]!).searchParams.get("state")
		bg.navigate(901, `${APP}/extension/connected?code=c1&state=${state}`)
		await settle()
		expect(bg.state.captures).toBe(0)
		expect(bg.server.saves.map((s) => s.body.url)).toEqual([
			"https://c.example/linked",
			"https://c.example/linked",
		])
	})
})

describe("a second click while a save is under way", () => {
	it("sends the page once, and says it is still saving", async () => {
		const bg = await loadBackground({ tokenAuth: false })
		// A double click: the second comes before the first one's checks are done.
		bg.click(1)
		bg.click(1)
		await settle()
		// Another click while the page is being sent.
		bg.click(1)
		bg.saveLink(1, "https://c.example/linked")
		await settle()
		expect(bg.state.captures).toBe(1)
		expect(bg.server.saves).toHaveLength(1)
		expect(bg.state.badge.get(1)).toBe("…")
		expect(bg.toastsOf(1).map((t) => t.title)).toEqual([
			"toastSaving",
			"toastSaving",
			"toastSaving",
		])

		bg.server.saves[0]!.release(bg.server.saved())
		await settle()
		expect(bg.state.badge.get(1)).toBe("✓")
		// Done: the next click saves again.
		bg.click(1)
		await settle()
		expect(bg.server.saves).toHaveLength(2)
	})

	it("lets the next click save when the last one broke on the way", async () => {
		const bg = await loadBackground({ tokenAuth: true })
		const create = bg.browser.tabs.create
		bg.browser.tabs.create = async () => {
			throw new Error("No current window")
		}
		bg.click(1)
		await settle()
		expect(bg.state.badge.get(1)).toBe("!")

		bg.browser.tabs.create = create
		bg.click(1)
		await settle()
		expect(bg.state.opened).toHaveLength(1)
	})
})
