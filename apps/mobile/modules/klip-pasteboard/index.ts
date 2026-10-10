import { requireNativeView, requireOptionalNativeModule } from "expo"
import type { ViewProps } from "react-native"

/**
 * The clipboard, looked at without reading it: iOS asks before an app reads what another app
 * copied, not before it checks. The app offers to save a copied link, and reads it only through
 * `PasteControl`, the system's Paste button, which needs no asking. Null without it (not iOS).
 */
export const pasteboard = requireOptionalNativeModule<{
	/** Goes up each time anything is copied: the same number, the same contents. */
	changeCount(): number
	/** Whether the clipboard holds a link: a URL item, as "Copy Link" leaves (not text). */
	hasLink(): boolean
}>("KlipPasteboard")

export type PasteControlProps = ViewProps & {
	/** What was pasted: a link or text, or null when the clipboard had nothing to read. */
	onPaste: (event: { nativeEvent: { text: string | null } }) => void
	backgroundColor?: string
	foregroundColor?: string
}

/** The system's Paste button (`UIPasteControl`); null without the module. Give it a size. */
export const PasteControl = pasteboard
	? requireNativeView<PasteControlProps>("KlipPasteboard")
	: null
