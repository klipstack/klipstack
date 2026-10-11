import { ExtensionStorage } from "@bacons/apple-targets"
import { AppState } from "react-native"
import { settled } from "./article-changes"

/** The home screen widget's kind (targets/widget/NextUpWidget.swift). */
const NEXT_UP = "NextUp"

/**
 * Has the "Next up" widget load its article again. The widget isn't on screen while the app is, so
 * the app asks on its way to the background, once the reader's last changes have landed, and when
 * the session comes or goes.
 */
export function reloadNextUp(): void {
	ExtensionStorage.reloadWidget(NEXT_UP)
}

/** Reloads the widget each time the app leaves the foreground. */
export function reloadNextUpInBackground(): () => void {
	const sub = AppState.addEventListener("change", (appState) => {
		if (appState === "background") void settled().then(reloadNextUp)
	})
	return () => sub.remove()
}
