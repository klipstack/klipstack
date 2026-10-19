import { useSyncExternalStore } from "react"
import { useClientValue } from "~/hooks/use-client-value"

/** At most one check per this many minutes, and only while the tab is in front. */
const CHECK_EVERY_MS = 5 * 60_000

const booted = () =>
	typeof document === "undefined"
		? ""
		: (document.querySelector('meta[name="app-version"]')?.getAttribute("content") ?? "")

/** The newer commit the server runs, once a check has seen one; "" until then. */
let newer = ""
let last = 0
const listeners = new Set<() => void>()

/**
 * Asks the server which commit it runs. Called when the tab comes back to the front and on each
 * navigation, never more often than every few minutes: a deploy is not worth polling for.
 */
export async function checkAppVersion() {
	if (document.visibilityState !== "visible") return
	if (Date.now() - last < CHECK_EVERY_MS) return
	last = Date.now()
	try {
		const res = await fetch("/version", { cache: "no-store" })
		if (!res.ok) return
		const { version: live } = (await res.json()) as { version?: string }
		if (!live || !booted() || live === booted() || live === newer) return
		newer = live
		for (const listener of listeners) listener()
	} catch {
		// offline: ask again next time
	}
}

/**
 * The commit this page is running, and the newer one the server has moved on to since it loaded
 * ("" while there is none). `UpdateNotice`, in the root, runs the checks.
 */
export function useAppVersion(): { version: string; newer: string } {
	const version = useClientValue(booted, "")
	const live = useSyncExternalStore(
		(onChange) => {
			listeners.add(onChange)
			return () => listeners.delete(onChange)
		},
		() => newer,
		() => "",
	)
	return { version, newer: live }
}
