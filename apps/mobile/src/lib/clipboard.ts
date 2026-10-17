import * as Clipboard from "expo-clipboard"
import { pasteboard } from "../../modules/klip-pasteboard"
import { nextOffer } from "./clipboard-offer"
import { loadClipboardSeen, saveClipboardSeen } from "./reader-files"

/**
 * Copies text. The app never offers to save what it copied itself, so the copy counts as seen
 * (see `lookAtClipboard`).
 */
export async function copyText(text: string): Promise<void> {
	await Clipboard.setStringAsync(text)
	markClipboardSeen()
}

/**
 * Copies rich text: the HTML for apps that paste it, the plain text for those that don't. Plain
 * text alone without the module.
 */
export async function copyRich(html: string, plain: string): Promise<void> {
	if (pasteboard) {
		saveClipboardSeen(pasteboard.copyRich(html, plain))
		return
	}
	await copyText(plain)
}

/** What the clipboard holds now was saved or copied here: it isn't offered. */
export function markClipboardSeen(): void {
	if (pasteboard) saveClipboardSeen(pasteboard.changeCount())
}

/**
 * Which copy Home's card offers now (`nextOffer`), looked at without reading the clipboard; null
 * for none. A copy offered for the first time counts as seen: each copy is offered once.
 */
export function lookAtClipboard(offered: number | null): number | null {
	if (!pasteboard) return null
	const now = { count: pasteboard.changeCount(), hasLink: pasteboard.hasLink() }
	const next = nextOffer(offered, now, loadClipboardSeen())
	if (next !== null && next !== offered) saveClipboardSeen(next)
	return next
}
