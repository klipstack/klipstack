import { showToast } from "./toast"

/** Copies `text` and confirms with a toast. */
export function copyText(text: string, message: string) {
	void navigator.clipboard?.writeText(text).then(() => showToast({ message }))
}

/** Copies an article's original URL and confirms with a toast. */
export function copyLink(url: string, message: string) {
	copyText(url, message)
}
