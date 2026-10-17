import { showToast } from "./toast"

/** Copies `text` and confirms with a toast. */
export function copyText(text: string, message: string) {
	void navigator.clipboard?.writeText(text).then(() => showToast({ message }))
}

/**
 * Copies `text` with `html` beside it, for apps that paste rich text (mail, docs, chat), and
 * confirms with a toast; `failed` says it could not. A browser without rich clipboard writing gets
 * the text alone.
 */
export function copyRich(text: string, html: string, message: string, failed: string) {
	const clipboard = navigator.clipboard
	const written = !clipboard
		? Promise.reject(new Error("No clipboard"))
		: typeof ClipboardItem === "undefined" || !clipboard.write
			? clipboard.writeText(text)
			: clipboard
					.write([
						new ClipboardItem({
							"text/plain": new Blob([text], { type: "text/plain" }),
							"text/html": new Blob([html], { type: "text/html" }),
						}),
					])
					.catch(() => clipboard.writeText(text))
	void written.then(
		() => showToast({ message }),
		() => showToast({ message: failed, warn: true }),
	)
}

/** Copies an article's original URL and confirms with a toast. */
export function copyLink(url: string, message: string) {
	copyText(url, message)
}
