import { browser } from "wxt/browser"
import { getSettings, saveSettings } from "../../lib/settings"

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
	await saveSettings({ appUrl: appUrl.value })
	status.textContent = browser.i18n.getMessage("optionsSaved")
	setTimeout(() => {
		status.textContent = ""
	}, 2000)
})
