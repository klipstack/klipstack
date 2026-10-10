import { browser } from "wxt/browser"

export interface Settings {
	appUrl: string
}

export const DEFAULT_APP_URL = "https://klipstack.com"

export async function getSettings(): Promise<Settings> {
	const stored = (await browser.storage.sync.get(["appUrl"])) as Partial<Settings>
	return { appUrl: normalizeAppUrl(stored.appUrl ?? DEFAULT_APP_URL) }
}

export async function saveSettings(settings: Settings): Promise<void> {
	await browser.storage.sync.set({ appUrl: normalizeAppUrl(settings.appUrl) })
}

/** Older versions kept an API key in synced storage; saves no longer use one. */
export async function forgetApiKey(): Promise<void> {
	await browser.storage.sync.remove("apiKey")
}

export function normalizeAppUrl(url: string): string {
	return url.trim().replace(/\/+$/, "")
}
