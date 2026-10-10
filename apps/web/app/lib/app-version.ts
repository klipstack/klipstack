import { useEffect, useState } from "react"
import { useClientValue } from "~/hooks/use-client-value"

/** At most one check per this many minutes, and only while the tab is in front. */
const CHECK_EVERY_MS = 5 * 60_000

const booted = () =>
	typeof document === "undefined"
		? ""
		: (document.querySelector('meta[name="app-version"]')?.getAttribute("content") ?? "")

/**
 * The commit this page is running, and whether the server has moved on since it loaded. Checked
 * when the tab comes back to the front, never more often than every few minutes: a deploy is not
 * worth polling for.
 */
export function useAppVersion(): { version: string; stale: boolean } {
	const version = useClientValue(booted, "")
	const [stale, setStale] = useState(false)
	useEffect(() => {
		let last = 0
		const check = async () => {
			if (document.visibilityState !== "visible") return
			if (Date.now() - last < CHECK_EVERY_MS) return
			last = Date.now()
			try {
				const res = await fetch("/version", { cache: "no-store" })
				if (!res.ok) return
				const { version: live } = (await res.json()) as { version?: string }
				if (live && booted() && live !== booted()) setStale(true)
			} catch {
				// offline: ask again next time
			}
		}
		void check()
		document.addEventListener("visibilitychange", check)
		return () => document.removeEventListener("visibilitychange", check)
	}, [])
	return { version, stale }
}
