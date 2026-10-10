import { useSyncExternalStore } from "react"

const never = () => () => undefined

/**
 * What `read()` says in the browser; `fallback` on the server and while hydrating, so the markup
 * matches. `read` must return a primitive, or the same object for the same answer.
 */
export function useClientValue<T>(read: () => T, fallback: T): T {
	return useSyncExternalStore(never, read, () => fallback)
}
