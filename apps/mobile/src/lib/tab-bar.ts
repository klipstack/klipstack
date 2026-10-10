import { useSyncExternalStore } from "react"

// The tab bar belongs to the tabs' layout; a list selecting articles hides it.
let hidden = false
const listeners = new Set<() => void>()

export function setTabBarHidden(value: boolean): void {
	if (value === hidden) return
	hidden = value
	for (const listener of listeners) listener()
}

export function useTabBarHidden(): boolean {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		() => hidden,
	)
}
