import { SymbolView } from "expo-symbols"
import { useSyncExternalStore } from "react"
import { Pressable } from "react-native"
import type { ListLayout } from "@/lib/list-layout"
import { loadListLayout, saveListLayout } from "@/lib/reader-files"
import { useColors } from "@/lib/theme"

// One choice for every list: the tabs keep theirs mounted, and each follows a change at once.
let layout: ListLayout | null = null
const listeners = new Set<() => void>()

function current(): ListLayout {
	layout ??= loadListLayout()
	return layout
}

function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/** The lists' layout: the grid of cards, or rows. */
export function useListLayout(): ListLayout {
	return useSyncExternalStore(subscribe, current)
}

function setListLayout(next: ListLayout) {
	layout = next
	saveListLayout(next)
	for (const listener of listeners) listener()
}

/** The header's switch between the grid and rows. Its icon and label say what you will get. */
export function LayoutButton() {
	const colors = useColors()
	const next = useListLayout() === "grid" ? "list" : "grid"
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={next === "list" ? "List view" : "Grid view"}
			hitSlop={8}
			onPress={() => setListLayout(next)}
		>
			<SymbolView
				name={next === "list" ? "list.bullet" : "square.grid.2x2"}
				tintColor={colors.accent}
				size={22}
			/>
		</Pressable>
	)
}
