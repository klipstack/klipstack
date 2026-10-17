import type { KlipstackClient } from "@klipstack/sdk"
import { useEffect, useSyncExternalStore } from "react"

/**
 * Whether editions are turned on for the account (Settings → Features, on the web; off by
 * default): marking articles for the next edition and its note show only then. Known from
 * `GET /me`, which Home, Account and the reader ask; off until it answers.
 */
let on = false
const listeners = new Set<() => void>()

export function setEditions(value: boolean) {
	if (value === on) return
	on = value
	for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/** Editions on, asked again of the server when `client` is given. */
export function useEditions(client?: KlipstackClient | null): boolean {
	useEffect(() => {
		if (!client) return
		// An older server says nothing of editions: they were on for everyone then.
		client.me().then(
			(me) => setEditions(me.editions ?? true),
			() => {},
		)
	}, [client])
	return useSyncExternalStore(subscribe, () => on)
}
