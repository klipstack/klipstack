import { type Browser, browser } from "wxt/browser"
import { defineBackground } from "wxt/utils/define-background"
import { APP_URL, HOST_PERMISSION, TOKEN_AUTH } from "../lib/app-url"
import {
	capturePage,
	isCapturableUrl,
	isServerCapturedUrl,
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
import { showToast, type ToastOptions } from "../lib/toast"

const BADGE_RESET_MS = 2500

type SaveOutcome = {
	ok: boolean
	status: number
	id?: string
	readUrl?: string
	error?: string
	limit?: string
}

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
		if (info.menuItemId === "save-link" && info.linkUrl && tab?.id !== undefined)
			void saveUrlOnly(info.linkUrl, tab.id)
	})

	// The extension's sign-in ends on a page of the server: read the code from the tab's address.
	if (TOKEN_AUTH)
		browser.tabs.onUpdated.addListener((tabId, change, tab) => {
			const url = change.url ?? (change.status === "complete" ? tab.url : undefined)
			if (url) void finishSignIn(tabId, url)
		})
})

async function savePage(tab: Browser.tabs.Tab): Promise<SaveOutcome> {
	if (tab.id === undefined || !isCapturableUrl(tab.url)) {
		await flash(tab.id, "!", "#b91c1c")
		return { ok: false, status: 0, error: "not_capturable" }
	}
	if (!(await serverAccess(tab.id))) return { ok: false, status: 0, error: "no_access" }
	if (TOKEN_AUTH && !(await tokenStore.get())) {
		await connect({ tabId: tab.id })
		return { ok: false, status: 0, error: "not_connected" }
	}
	await setBadge(tab.id, "…", "#243f6c")
	// Shown before the capture, which fetches the page again: that can take a few seconds.
	void toast(tab.id, { kind: "saving", title: msg("toastSaving") })
	const captured = isServerCapturedUrl(tab.url) ? null : await captureTab(tab.id)
	const payload = captured
		? { url: captured.url, html: captured.html, servedHtml: captured.servedHtml }
		: { url: tab.url }
	const result = await send(tab.id, (token) => sendPage(APP_URL, payload, fetch, token))
	if (!result) return { ok: false, status: 0, error: "not_connected" }
	await flash(tab.id, result.ok ? "✓" : "!", result.ok ? "#15803d" : "#b91c1c")
	await toast(tab.id, outcomeToast(result, APP_URL))
	return result
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

async function saveUrlOnly(url: string, tabId: number) {
	if (!isCapturableUrl(url)) return
	if (!(await serverAccess(tabId))) return
	if (TOKEN_AUTH && !(await tokenStore.get())) return connect({ tabId, link: url })
	await setBadge(tabId, "…", "#243f6c")
	void toast(tabId, { kind: "saving", title: msg("toastSaving") })
	const result = await send(tabId, (token) => saveToKlipstack(APP_URL, { url }, fetch, token))
	if (!result) return
	await flash(tabId, result.ok ? "✓" : "!", result.ok ? "#15803d" : "#b91c1c")
	await toast(tabId, outcomeToast(result, APP_URL))
}

/**
 * Whether the extension may reach the server, asking the reader when it may not. Chrome grants it
 * at install; Safari only when the reader allows it, and a reader can withhold it in either. A save
 * without it is cross-origin: the server refuses it (no CORS), and the browser reports a network
 * error, as if the server were down. First, while the click still counts as the reader's gesture,
 * which the browser's prompt requires; already granted, it answers at once.
 */
async function serverAccess(tabId: number): Promise<boolean> {
	let granted = false
	try {
		granted = await browser.permissions.request({ origins: [HOST_PERMISSION] })
	} catch {
		granted = await browser.permissions.contains({ origins: [HOST_PERMISSION] }).catch(() => false)
	}
	if (!granted) {
		await flash(tabId, "!", "#b91c1c")
		await toast(tabId, {
			kind: "error",
			title: msg("toastNoAccess", new URL(APP_URL).hostname),
			ms: 10000,
		})
	}
	return granted
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
 * the extension): it starts again, and the save follows it.
 */
async function send(
	tabId: number,
	save: (token?: string) => Promise<SaveOutcome>,
): Promise<SaveOutcome | null> {
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
	await connect({ tabId })
	return null
}

/** A sign-in the reader is going through in another tab, by its state. */
type PendingSignIn = Pending & { link?: string }

/**
 * Opens the server's sign-in and consent in a new tab. The save that needed it (the page in
 * `tabId`, or `link`) happens once it is done (`finishSignIn`).
 */
async function connect({ tabId, link }: { tabId: number; link?: string }) {
	const { verifier, challenge, state } = await startSignIn()
	const pending: PendingSignIn = { verifier, state, tabId, ...(link ? { link } : {}) }
	await browser.storage.local.set({ pending })
	await browser.tabs.create({ url: authorizeUrl(APP_URL, { challenge, state }) })
	await toast(tabId, { kind: "saving", title: msg("toastConnect"), ms: 20000 })
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
		if (!tokens) {
			await flash(pending.tabId, "!", "#b91c1c")
			await toast(pending.tabId, { kind: "error", title: msg("toastNotConnected"), ms: 8000 })
			return
		}
		if (pending.link) await saveUrlOnly(pending.link, pending.tabId)
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

function outcomeToast(result: SaveOutcome, appUrl: string): ToastOptions {
	if (result.ok) {
		const link = result.readUrl ? { label: msg("toastOpen"), href: result.readUrl } : undefined
		return { kind: "saved", title: msg("toastSaved"), link }
	}
	// A 403 for a cap is no sign-in problem: say which cap, and where usage shows.
	if (result.error === "limit_reached")
		return {
			kind: "error",
			title: msg(result.limit === "storage" ? "toastLibraryFull" : "toastSaveLimit"),
			link: { label: msg("toastUsage"), href: `${appUrl}/settings/usage` },
			ms: 8000,
		}
	// With its own sign-in, the website's login doesn't help: the next click connects again.
	if (TOKEN_AUTH && result.status === 401)
		return { kind: "error", title: msg("toastNotConnected"), ms: 8000 }
	if (result.status === 401 || result.status === 403)
		return {
			kind: "error",
			title: msg("toastLogin"),
			link: { label: msg("toastLoginAction"), href: `${appUrl}/login` },
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

async function setBadge(tabId: number | undefined, text: string, color: string) {
	if (tabId === undefined) return
	try {
		await browser.action.setBadgeBackgroundColor({ tabId, color })
		await browser.action.setBadgeText({ tabId, text })
	} catch {
		// tab may be gone; the badge is cosmetic
	}
}

async function flash(tabId: number | undefined, text: string, color: string) {
	await setBadge(tabId, text, color)
	setTimeout(() => void setBadge(tabId, "", color), BADGE_RESET_MS)
}
