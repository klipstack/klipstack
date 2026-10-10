import { useSyncExternalStore } from "react"

/**
 * The phone top bar's Select / Done button lives in the shell, and the selection in the list page.
 * The page says whether it is selecting and takes the button's presses; the shell reads the one
 * and sends the other.
 */
let selecting = false
let onPress: (() => void) | null = null
const listeners = new Set<() => void>()

/** The list page, whenever selecting starts or stops. */
export function publishSelecting(value: boolean) {
	if (value === selecting) return
	selecting = value
	for (const listener of listeners) listener()
}

/** The list page takes the presses while it is mounted; returns the cleanup. */
export function takeSelectPresses(fn: () => void): () => void {
	onPress = fn
	return () => {
		if (onPress === fn) onPress = null
		publishSelecting(false)
	}
}

export function pressSelect() {
	onPress?.()
}

export function useSelecting(): boolean {
	return useSyncExternalStore(
		(onChange) => {
			listeners.add(onChange)
			return () => listeners.delete(onChange)
		},
		() => selecting,
		() => false,
	)
}
