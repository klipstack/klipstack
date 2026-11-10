import { type Browser, browser } from "wxt/browser"
import { defineBackground } from "wxt/utils/define-background"
import { APP_URL, HOST_PERMISSION, TOKEN_AUTH } from "../lib/app-url"
import {
	capturePage,
	isCapturableUrl,
	isServerCapturedUrl,
	type SaveResult,
	savePage as sendPage,
	saveToKlipstack,
} from "../lib/capture"
import {
	accessToken,
	authorizeUrl,
	callbackOf,
	exchangeCode,
	type Pending,
	startSignIn,
	type Tokens,
	type TokenStore,
} from "../lib/connect"
import { canStart, IDLE, type TabEvent, type TabStatus, transition } from "../lib/save-flow"
import { showToast, type ToastOptions } from "../lib/toast"

const BADGE_RESET_MS = 2500

export default defineBackground(() => {
	browser.runtime.onInstalled.addListener(() => {
		browser.contextMenus.create({
			id: "save-link",
			title: browser.i18n.getMessage("saveLink"),
			contexts: ["link"],
		})
		browser.contextMenus.create({
			id: "save-page",
			title: browser.i18n.getMessage("savePage"),
			contexts: ["page"],
		})
	})

	browser.action.onClicked.addListener((tab) => {
		void savePage(tab)
	})

	browser.contextMenus.onClicked.addListener((info, tab) => {
		if (info.menuItemId === "save-page" && tab) void savePage(tab)
		const link = info.linkUrl
		if (info.menuItemId === "save-link" && isCapturableUrl(link) && tab?.id !== undefined)
			void saveLink({ tabId: tab.id, link })
	})

	// The extension's sign-in ends on a page of the server: read the code from the tab's address.
	if (TOKEN_AUTH)
		browser.tabs.onUpdated.addListener((tabId, change, tab) => {
			const url = change.url ?? (change.status === "complete" ? tab.url : undefined)
			if (url) void finishSignIn(tabId, url)
		})
})

/** The page in the tab the reader clicked on. */
async function savePage(tab: Browser.tabs.Tab) {
	if (tab.id === undefined || !begin(tab.id)) return
	if (!isCapturableUrl(tab.url))
		return dispatch(tab.id, { type: "refused", failure: { reason: "not_capturable" } })
	await save({ tabId: tab.id }, tab.url)
}

/** A link from the page in a tab. */
async function saveLink(request: SaveRequest & { link: string }) {
	if (begin(request.tabId)) await save(request, request.link)
}

/**
 * Starts a save in the tab, unless one is under way there. Before any await: two clicks come
 * close together, and the first one's status must already turn the second one away.
 */
function begin(tabId: number): boolean {
	const starts = canStart(statuses.get(tabId) ?? IDLE)
	// Not awaited: the access prompt in save() must come while the click is the reader's gesture.
	void dispatch(tabId, { type: "clicked" })
	return starts
}

/** A save the reader asked for in a tab: its page, or `link` from it. */
type SaveRequest = { tabId: number; link?: string }

async function save(request: SaveRequest, url: string) {
	try {
		await trySave(request, url)
	} catch (error) {
		// A browser call that failed on the way (a closed window, storage): the tab must not stay
		// busy, or no click would save in it again.
		const result = { ok: false, status: 0, error: error instanceof Error ? error.message : "error" }
		await dispatch(request.tabId, { type: "answered", result })
	}
}

async function trySave(request: SaveRequest, url: string) {
	const { tabId, link } = request
	if (!(await serverAccess()))
		return dispatch(tabId, { type: "refused", failure: { reason: "no_access" } })
	if (TOKEN_AUTH && !(await tokenStore.get())) return connect(request)
	// Shown before the capture, which fetches the page again: that can take a few seconds.
	await dispatch(tabId, { type: "sending" })
	const captured = link || isServerCapturedUrl(url) ? null : await captureTab(tabId)
	const payload = captured
		? { url: captured.url, html: captured.html, servedHtml: captured.servedHtml }
		: { url }
	const result = await send((token) =>
		link
			? saveToKlipstack(APP_URL, payload, fetch, token)
			: sendPage(APP_URL, payload, fetch, token),
	)
	if (result) await dispatch(tabId, { type: "answered", result })
	else await connect(request)
}

type Capture = Awaited<ReturnType<typeof capturePage>>

async function captureTab(tabId: number): Promise<Capture | null> {
	try {
		const [result] = await browser.scripting.executeScript({
			target: { tabId },
			func: capturePage,
		})
		return (result?.result as Capture | undefined) ?? null
	} catch {
		return null
	}
}

/**
 * Whether the extension may reach the server, asking the reader when it may not. Chrome grants it
 * at install; Safari only when the reader allows it, and a reader can withhold it in either. A save
 * without it is cross-origin: the server refuses it (no CORS), and the browser reports a network
 * error, as if the server were down. First, while the click still counts as the reader's gesture,
 * which the browser's prompt requires; already granted, it answers at once.
 */
async function serverAccess(): Promise<boolean> {
	try {
		return await browser.permissions.request({ origins: [HOST_PERMISSION] })
	} catch {
		return browser.permissions.contains({ origins: [HOST_PERMISSION] }).catch(() => false)
	}
}

/** The extension's own sign-in, kept across restarts of the background. */
const tokenStore: TokenStore = {
	async get() {
		const { tokens } = await browser.storage.local.get("tokens")
		return (tokens as Tokens | undefined) ?? null
	},
	async set(tokens) {
		if (tokens) await browser.storage.local.set({ tokens })
		else await browser.storage.local.remove("tokens")
	},
}

/**
 * Sends a save: with the browser's session, or in a TOKEN_AUTH build with the extension's sign-in,
 * refreshed once when the API refuses it. Null when that sign-in is gone (the reader disconnected
 * the extension): the save then waits for a new one.
 */
async function send(save: (token?: string) => Promise<SaveResult>): Promise<SaveResult | null> {
	if (!TOKEN_AUTH) return save()
	let token: string | null
	try {
		token = await accessToken(APP_URL, tokenStore)
		if (token) {
			const result = await save(token)
			if (result.status !== 401) return result
			token = await accessToken(APP_URL, tokenStore, { force: true })
			if (token) return await save(token)
		}
	} catch {
		// The token endpoint unreachable: as any save that can't reach the server.
		return { ok: false, status: 0, error: "network" }
	}
	return null
}

/** A sign-in the reader is going through in another tab, by its state. */
type PendingSignIn = Pending & { link?: string }

/**
 * Opens the server's sign-in and consent in a new tab. The save that needed it (the page in
 * `tabId`, or `link`) happens once it is done (`finishSignIn`).
 */
async function connect({ tabId, link }: SaveRequest) {
	const { verifier, challenge, state } = await startSignIn()
	const pending: PendingSignIn = { verifier, state, tabId, ...(link ? { link } : {}) }
	await browser.storage.local.set({ pending })
	await browser.tabs.create({ url: authorizeUrl(APP_URL, { challenge, state }) })
	await dispatch(tabId, { type: "signInNeeded" })
}

/** States whose code is being exchanged: a tab reports its address more than once. */
const finishing = new Set<string>()

async function finishSignIn(callbackTab: number, url: string) {
	const callback = callbackOf(APP_URL, url)
	if (!callback || finishing.has(callback.state)) return
	// Claimed before any await: the tab reports its address twice, and a code works once.
	finishing.add(callback.state)
	try {
		const { pending } = (await browser.storage.local.get("pending")) as {
			pending?: PendingSignIn
		}
		// Another sign-in's end, or one this extension didn't start: never exchange it.
		if (!pending || pending.state !== callback.state) return
		await browser.storage.local.remove("pending")
		const tokens = callback.code
			? await exchangeCode(APP_URL, { code: callback.code, verifier: pending.verifier }).catch(
					() => null,
				)
			: null
		await tokenStore.set(tokens)
		await browser.tabs.remove(callbackTab).catch(() => {})
		await browser.tabs.update(pending.tabId, { active: true }).catch(() => {})
		if (!tokens) return dispatch(pending.tabId, { type: "signInFailed" })
		if (pending.link) await saveLink({ tabId: pending.tabId, link: pending.link })
		else {
			const tab = await browser.tabs.get(pending.tabId).catch(() => null)
			if (tab) await savePage(tab)
		}
	} finally {
		finishing.delete(callback.state)
	}
}

type MessageKey = Parameters<typeof browser.i18n.getMessage>[0]
const msg = (key: MessageKey, ...subs: string[]) => browser.i18n.getMessage(key, subs) || key

/** Each tab's save, while it has one (`lib/save-flow.ts`). */
const statuses = new Map<number, TabStatus>()
/** The pending fade of each tab's outcome. */
const fades = new Map<number, ReturnType<typeof setTimeout>>()
/** Each tab's last badge and toast, still being shown: the next waits for it, so they keep order. */
const showing = new Map<number, Promise<void>>()

/** Moves a tab's save on, and shows where it is now. */
function dispatch(tabId: number, event: TabEvent): Promise<void> {
	const status = statuses.get(tabId) ?? IDLE
	const next = transition(status, event)
	if (next === status) return Promise.resolve()
	if (next.phase === "idle") statuses.delete(tabId)
	else statuses.set(tabId, next)
	clearTimeout(fades.get(tabId))
	fades.delete(tabId)
	if (next.phase === "saved" || next.phase === "failed")
		fades.set(
			tabId,
			setTimeout(() => void dispatch(tabId, { type: "faded" }), BADGE_RESET_MS),
		)
	const shown = (showing.get(tabId) ?? Promise.resolve()).then(() => show(tabId, next))
	showing.set(tabId, shown)
	void shown.then(() => {
		if (showing.get(tabId) === shown) showing.delete(tabId)
	})
	return shown
}

const BADGES: Record<TabStatus["phase"], { text: string; color: string }> = {
	idle: { text: "", color: "#243f6c" },
	starting: { text: "…", color: "#243f6c" },
	saving: { text: "…", color: "#243f6c" },
	signingIn: { text: "", color: "#243f6c" },
	saved: { text: "✓", color: "#15803d" },
	failed: { text: "!", color: "#b91c1c" },
}

/** The badge for a tab's status, and the toast for the status it just entered. */
async function show(tabId: number, status: TabStatus) {
	const { text, color } = BADGES[status.phase]
	try {
		await browser.action.setBadgeBackgroundColor({ tabId, color })
		await browser.action.setBadgeText({ tabId, text })
	} catch {
		// tab may be gone; the badge is cosmetic
	}
	const notice = toastFor(status)
	if (notice) await toast(tabId, notice)
}

function toastFor(status: TabStatus): ToastOptions | null {
	switch (status.phase) {
		case "idle":
		case "starting":
			return null
		case "saving":
			return { kind: "saving", title: msg("toastSaving") }
		case "signingIn":
			return { kind: "saving", title: msg("toastConnect"), ms: 20000 }
		case "saved":
			return outcomeToast(status.result)
		case "failed":
			switch (status.failure.reason) {
				// Pages the extension can't capture can't show one either: the badge says it.
				case "not_capturable":
					return null
				case "no_access":
					return {
						kind: "error",
						title: msg("toastNoAccess", new URL(APP_URL).hostname),
						ms: 10000,
					}
				case "not_connected":
					return { kind: "error", title: msg("toastNotConnected"), ms: 8000 }
				case "refused":
					return outcomeToast(status.failure.result)
			}
	}
}

function outcomeToast(result: SaveResult): ToastOptions {
	if (result.ok) {
		const link = result.readUrl ? { label: msg("toastOpen"), href: result.readUrl } : undefined
		return { kind: "saved", title: msg("toastSaved"), link }
	}
	// A 403 for a cap is no sign-in problem: say which cap, and where usage shows.
	if (result.error === "limit_reached")
		return {
			kind: "error",
			title: msg(result.limit === "storage" ? "toastLibraryFull" : "toastSaveLimit"),
			link: { label: msg("toastUsage"), href: `${APP_URL}/settings/usage` },
			ms: 8000,
		}
	// With its own sign-in, the website's login doesn't help: the next click connects again.
	if (TOKEN_AUTH && result.status === 401)
		return { kind: "error", title: msg("toastNotConnected"), ms: 8000 }
	if (result.status === 401 || result.status === 403)
		return {
			kind: "error",
			title: msg("toastLogin"),
			link: { label: msg("toastLoginAction"), href: `${APP_URL}/login` },
			ms: 8000,
		}
	if (result.status === 0) return { kind: "error", title: msg("toastUnreachable"), ms: 6000 }
	return { kind: "error", title: msg("toastFailed", String(result.status)), ms: 6000 }
}

/** Show the in-page notice; pages we cannot script (browser UI, stores) just keep the badge. */
async function toast(tabId: number, opts: ToastOptions) {
	try {
		await browser.scripting.executeScript({ target: { tabId }, func: showToast, args: [opts] })
	} catch {
		// not injectable here
	}
}
