import { type Browser, browser } from "wxt/browser"
import { defineBackground } from "wxt/utils/define-background"
import {
	capturePage,
	isCapturableUrl,
	isServerCapturedUrl,
	savePage as sendPage,
	saveToKlipstack,
} from "../lib/capture"
import { originPattern } from "../lib/hosts"
import { forgetApiKey, getSettings } from "../lib/settings"
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
		void forgetApiKey()
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
})

async function savePage(tab: Browser.tabs.Tab): Promise<SaveOutcome> {
	if (tab.id === undefined || !isCapturableUrl(tab.url)) {
		await flash(tab.id, "!", "#b91c1c")
		return { ok: false, status: 0, error: "not_capturable" }
	}
	const settings = await getSettings()
	if (!(await canReach(settings.appUrl))) return askForAccess(tab.id)
	await setBadge(tab.id, "…", "#243f6c")
	// Shown before the capture, which fetches the page again: that can take a few seconds.
	void toast(tab.id, { kind: "saving", title: msg("toastSaving") })
	const captured = isServerCapturedUrl(tab.url) ? null : await captureTab(tab.id)
	const payload = captured
		? { url: captured.url, html: captured.html, servedHtml: captured.servedHtml }
		: { url: tab.url }
	const result = await sendPage(settings.appUrl, payload)
	await flash(tab.id, result.ok ? "✓" : "!", result.ok ? "#15803d" : "#b91c1c")
	await toast(tab.id, outcomeToast(result, settings.appUrl))
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
	const settings = await getSettings()
	if (!(await canReach(settings.appUrl))) {
		await askForAccess(tabId)
		return
	}
	await setBadge(tabId, "…", "#243f6c")
	void toast(tabId, { kind: "saving", title: msg("toastSaving") })
	const result = await saveToKlipstack(settings.appUrl, { url })
	await flash(tabId, result.ok ? "✓" : "!", result.ok ? "#15803d" : "#b91c1c")
	await toast(tabId, outcomeToast(result, settings.appUrl))
}

/** klipstack.com and local servers always; another server once the user allowed it in the options. */
async function canReach(appUrl: string): Promise<boolean> {
	try {
		return await browser.permissions.contains({ origins: [originPattern(appUrl)] })
	} catch {
		return false
	}
}

/** Nothing is sent: the options page, where saving the address asks for access to it, opens. */
async function askForAccess(tabId: number): Promise<SaveOutcome> {
	await flash(tabId, "!", "#b91c1c")
	await toast(tabId, { kind: "error", title: msg("toastNeedsAccess"), ms: 8000 })
	await browser.runtime.openOptionsPage()
	return { ok: false, status: 0, error: "no_access" }
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
