import { ExtensionStorage } from "@bacons/apple-targets"
import { Directory, Paths } from "expo-file-system"
import { AppState } from "react-native"
import { settled } from "./article-changes"
import { APP_GROUP } from "./session-store"

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

/**
 * Signed out: the article the widget keeps for when it is offline goes (its `Cache` in
 * targets/widget/Klipstack.swift), also when no widget is on the home screen to delete it.
 */
export function forgetNextUp(): void {
	try {
		const group = Paths.appleSharedContainers[APP_GROUP]
		const kept = group && new Directory(group, "Library", "Caches", "widget")
		if (kept?.exists) kept.delete()
	} catch {
		// Nothing kept, or not on iOS.
	}
	reloadNextUp()
}

/** Reloads the widget each time the app leaves the foreground. */
export function reloadNextUpInBackground(): () => void {
	const sub = AppState.addEventListener("change", (appState) => {
		if (appState !== "background") return
		// After every listener of this change: the reader hands its last position to `track` then.
		setTimeout(() => void settled().then(reloadNextUp), 0)
	})
	return () => sub.remove()
}
