import { browser } from "wxt/browser"
import { originPattern } from "../../lib/hosts"
import { getSettings, normalizeAppUrl, saveSettings } from "../../lib/settings"

for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
	el.textContent = browser.i18n.getMessage(
		el.dataset.i18n as Parameters<typeof browser.i18n.getMessage>[0],
	)
}

const form = document.getElementById("form") as HTMLFormElement
const appUrl = document.getElementById("appUrl") as HTMLInputElement
const status = document.getElementById("status") as HTMLElement

getSettings().then((s) => {
	appUrl.value = s.appUrl
})

form.addEventListener("submit", async (e) => {
	e.preventDefault()
	const url = normalizeAppUrl(appUrl.value)
	// The extension reaches only klipstack.com and local servers by itself: another address needs
	// the user's permission, asked here, while the click still counts (before any other await).
	// For an address it can already reach, the browser answers yes without asking.
	const allowed = await browser.permissions
		.request({ origins: [originPattern(url)] })
		.catch(() => false)
	if (!allowed) {
		status.dataset.kind = "error"
		status.textContent = browser.i18n.getMessage("optionsNeedsAccess")
		return
	}
	await saveSettings({ appUrl: url })
	delete status.dataset.kind
	status.textContent = browser.i18n.getMessage("optionsSaved")
	setTimeout(() => {
		status.textContent = ""
	}, 2000)
})
