import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import { useLocation } from "react-router"
import { useMediaQuery } from "~/hooks/use-media-query"
import { INITIAL_LIST_STATE, isSelecting, listReducer, selectionScope } from "~/lib/list-selection"
import { publishSelecting, takeSelectPresses } from "~/lib/selection-mode"
import { isSelectAllShortcut, listShortcut } from "~/lib/shortcuts"

/** A card list's checked cards, for the cards and the selection bar. */
export interface ListSelection {
	checked: ReadonlySet<string>
	/** Something is checked, or the phone's Select is on: a click on a card toggles it. */
	selecting: boolean
	/** A click on a card or its box; `range` (shift) checks from the card toggled last. */
	toggle: (id: string, range: boolean) => void
	/** The cards "select all" takes: the list the selection is in. */
	scope: string[]
	selectAll: () => void
	uncheck: (ids: string[]) => void
	clear: () => void
}

/**
 * The keyboard cursor and the selection of a card list: j/k and the arrows move the cursor and the
 * cursor's card answers the action keys; x checks it, shift with a move checks a range, ⌘A checks
 * them all, Escape clears. `listRef` goes on the list, whose columns decide what up and down mean.
 * `sections` are lists on one page that "select all" keeps apart (the search page's trash).
 */
export function useListCursor(ids: string[], sections?: string[][]) {
	const location = useLocation()
	const [state, dispatch] = useReducer(listReducer, INITIAL_LIST_STATE)
	const listRef = useRef<HTMLUListElement>(null)
	// Cards gone from the screen (archived, deleted) before the loader caught up.
	const vanished = useRef(new Set<string>())
	// Forget them once the list is fresh
	useEffect(() => {
		vanished.current.clear()
	}, [ids])
	// Cards the loader no longer returns leave the selection.
	const [seenIds, setSeenIds] = useState(ids)
	if (seenIds !== ids) {
		setSeenIds(ids)
		dispatch({ type: "prune", ids })
	}
	// Another view, filter, page or query: a new selection.
	const [seenKey, setSeenKey] = useState(location.key)
	if (seenKey !== location.key) {
		setSeenKey(location.key)
		dispatch({ type: "clear" })
	}
	// Back from the reader: the article you came from is the cursor. Phones have no keys to move it.
	const hasKeys = useMediaQuery("(hover: hover)")
	const [cameFromKey, setCameFromKey] = useState<string | null>(null)
	if (hasKeys && cameFromKey !== location.key) {
		setCameFromKey(location.key)
		const id = (location.state as { selected?: string } | null)?.selected
		if (id) dispatch({ type: "cursor", id })
	}
	const onVanish = useCallback(
		(id: string) => {
			vanished.current.add(id)
			dispatch({ type: "vanished", id, next: nearestVisible(ids, vanished.current, id) })
		},
		[ids],
	)
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (isSelectAllShortcut(e)) {
				if (ids.length === 0) return
				e.preventDefault()
				dispatch({ type: "select-all", sections: sections ?? [ids] })
				return
			}
			const shortcut = listShortcut(e)
			if (!shortcut) return
			if (shortcut === "clear") {
				dispatch({ type: "escape" })
				return
			}
			const visible = ids.filter((id) => !vanished.current.has(id))
			if (visible.length === 0) return
			if (shortcut === "toggle") {
				e.preventDefault()
				dispatch({ type: "toggle-cursor", visible })
				return
			}
			const style = listRef.current ? getComputedStyle(listRef.current) : null
			const columns = style?.display === "grid" ? style.gridTemplateColumns.split(" ").length : 1
			if ((shortcut === "left" || shortcut === "right") && columns === 1) return
			const step =
				shortcut === "next" || shortcut === "right"
					? 1
					: shortcut === "prev" || shortcut === "left"
						? -1
						: shortcut === "down"
							? columns
							: -columns
			e.preventDefault()
			dispatch({ type: "move", step, visible, extend: e.shiftKey })
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [ids, sections])
	// The phone top bar's Select / Done.
	const selecting = isSelecting(state)
	useEffect(() => {
		publishSelecting(selecting)
	}, [selecting])
	useEffect(() => takeSelectPresses(() => dispatch({ type: "toggle-mode" })), [])
	const scope = selectionScope(sections ?? [ids], state.checked, state.cursor)
	const selection = useMemo<ListSelection>(
		() => ({
			checked: state.checked,
			selecting,
			scope,
			toggle: (id, range) =>
				dispatch({
					type: "click",
					id,
					range,
					visible: ids.filter((x) => !vanished.current.has(x)),
				}),
			selectAll: () => dispatch({ type: "check-all", ids: scope }),
			uncheck: (list) => dispatch({ type: "uncheck", ids: list }),
			clear: () => dispatch({ type: "clear" }),
		}),
		[state.checked, selecting, scope, ids],
	)
	return { cursorId: state.cursor, listRef, onVanish, selection }
}

/** The next card still on screen after `id`, else the previous one, else nothing. */
function nearestVisible(ids: string[], vanished: Set<string>, id: string): string | null {
	const i = ids.indexOf(id)
	if (i < 0) return null
	return (
		ids.slice(i + 1).find((x) => !vanished.has(x)) ??
		ids
			.slice(0, i)
			.reverse()
			.find((x) => !vanished.has(x)) ??
		null
	)
}
