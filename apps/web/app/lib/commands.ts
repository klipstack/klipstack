import { useEffect, useInsertionEffect, useRef, useSyncExternalStore } from "react"

/**
 * What the command palette offers beyond its global commands. A mounted component (the reader, the
 * card under the list cursor) registers a group while it is on screen; the palette reads the
 * groups when it renders, so their commands always act on current state.
 */
export interface PaletteCommand {
	id: string
	label: string
	icon: React.ComponentType<{ className?: string }>
	/** Extra words to match on. */
	keywords?: string[]
	/** The key that does the same thing outside the palette. */
	shortcut?: string
	danger?: boolean
	run: () => void
}

export interface CommandGroup {
	heading: string
	commands: PaletteCommand[]
}

type Source = { current: () => CommandGroup | null }

const sources = new Set<Source>()

export function contextCommands(): CommandGroup[] {
	return [...sources]
		.map((s) => s.current())
		.filter((g): g is CommandGroup => Boolean(g?.commands.length))
}

/** Offers `build()`'s commands in the palette while the calling component is mounted. */
export function useCommands(build: () => CommandGroup | null) {
	const source = useRef<Source>({ current: build })
	useInsertionEffect(() => {
		source.current.current = build
	})
	useEffect(() => {
		const s = source.current
		sources.add(s)
		return () => {
			sources.delete(s)
		}
	}, [])
}

// ---- open state: the palette lives in the root; buttons anywhere open it ----

let open = false
const listeners = new Set<() => void>()

export const openPalette = () => setPaletteOpen(true)

export function setPaletteOpen(next: boolean | ((current: boolean) => boolean)) {
	const value = typeof next === "function" ? next(open) : next
	if (value === open) return
	open = value
	for (const l of listeners) l()
}

export function usePaletteOpen(): boolean {
	return useSyncExternalStore(
		(onChange) => {
			listeners.add(onChange)
			return () => listeners.delete(onChange)
		},
		() => open,
		() => false,
	)
}

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere. Empty until mounted, so hydration matches. */
export function usePaletteHint(): string {
	return useSyncExternalStore(
		() => () => undefined,
		() => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"),
		() => "",
	)
}

/** "⌘↵" on Apple platforms, "Ctrl+Enter" elsewhere. Empty until mounted, so hydration matches. */
export function useSubmitHint(): string {
	return useSyncExternalStore(
		() => () => undefined,
		() => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↵" : "Ctrl+Enter"),
		() => "",
	)
}
