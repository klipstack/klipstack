/**
 * The state of a card list: the keyboard cursor (one card) and the selection (checked cards, any
 * number). A reducer, so keys pressed faster than React renders still see the latest state.
 */
export interface ListState {
	cursor: string | null
	checked: ReadonlySet<string>
	/** Where a range starts: the card toggled last, or the cursor when a range began without one. */
	anchor: string | null
	/** What was checked before the range from `anchor` began; the range is added to it. */
	base: ReadonlySet<string>
	/** Phones' "Select": cards toggle on tap while nothing is checked yet. */
	mode: boolean
}

export type ListAction =
	/** `visible`: the cards on screen in order; `extend` checks the range as the cursor moves. */
	| { type: "move"; step: number; visible: string[]; extend: boolean }
	| { type: "cursor"; id: string | null }
	/** A card left the screen: the cursor, when on it, goes to `next`. */
	| { type: "vanished"; id: string; next: string | null }
	/** `x`: the cursor's card, or the first one when there is no cursor. */
	| { type: "toggle-cursor"; visible: string[] }
	/** A click on a card or its box; `range` (shift) checks from the anchor. */
	| { type: "click"; id: string; range: boolean; visible: string[] }
	| { type: "check-all"; ids: string[] }
	/** ⌘A: every card of the list the selection (or the cursor) is in. */
	| { type: "select-all"; sections: string[][] }
	| { type: "uncheck"; ids: string[] }
	/** Keep only these checked (what is still on screen). */
	| { type: "prune"; ids: string[] }
	/** Escape: the selection first, the cursor after. */
	| { type: "escape" }
	| { type: "clear" }
	/** The phone's Select / Done. */
	| { type: "toggle-mode" }

const NONE: ReadonlySet<string> = new Set()

export const INITIAL_LIST_STATE: ListState = {
	cursor: null,
	checked: NONE,
	anchor: null,
	base: NONE,
	mode: false,
}

export const isSelecting = (s: ListState) => s.mode || s.checked.size > 0

export function listReducer(state: ListState, action: ListAction): ListState {
	switch (action.type) {
		case "move": {
			const { visible, step, extend } = action
			if (visible.length === 0) return state
			const i = state.cursor ? visible.indexOf(state.cursor) : -1
			const next =
				i < 0 ? visible[0]! : visible[Math.max(0, Math.min(visible.length - 1, i + step))]!
			if (!extend) return { ...state, cursor: next, anchor: null, base: state.checked }
			const anchor = state.anchor ?? state.cursor ?? next
			const base = state.anchor ? state.base : state.checked
			return {
				...state,
				cursor: next,
				anchor,
				base,
				checked: withRange(base, visible, anchor, next),
			}
		}
		case "cursor":
			return state.cursor === action.id ? state : { ...state, cursor: action.id }
		case "vanished":
			return state.cursor === action.id ? { ...state, cursor: action.next } : state
		case "toggle-cursor": {
			const id = state.cursor ?? action.visible[0]
			if (!id) return state
			return { ...toggled(state, id), cursor: id }
		}
		case "click": {
			if (!action.range) return toggled(state, action.id)
			const anchor = state.anchor ?? state.cursor
			if (!anchor || !action.visible.includes(anchor)) return toggled(state, action.id)
			const base = state.anchor ? state.base : state.checked
			return { ...state, anchor, base, checked: withRange(base, action.visible, anchor, action.id) }
		}
		case "check-all":
		case "select-all": {
			const ids =
				action.type === "check-all"
					? action.ids
					: selectionScope(action.sections, state.checked, state.cursor)
			const checked = new Set([...state.checked, ...ids])
			return { ...state, checked, anchor: null, base: checked }
		}
		case "uncheck":
		case "prune": {
			const keep =
				action.type === "prune"
					? (id: string) => action.ids.includes(id)
					: (id: string) => !action.ids.includes(id)
			if ([...state.checked].every(keep) && (!state.anchor || keep(state.anchor))) return state
			const checked = new Set([...state.checked].filter(keep))
			return {
				...state,
				checked,
				anchor: state.anchor && keep(state.anchor) ? state.anchor : null,
				base: new Set([...state.base].filter(keep)),
			}
		}
		case "escape":
			return isSelecting(state) ? cleared(state) : { ...state, cursor: null }
		case "clear":
			return isSelecting(state) ? cleared(state) : state
		case "toggle-mode":
			return isSelecting(state) ? cleared(state) : { ...state, mode: true }
	}
}

function toggled(state: ListState, id: string): ListState {
	const checked = new Set(state.checked)
	if (checked.has(id)) checked.delete(id)
	else checked.add(id)
	return { ...state, checked, anchor: id, base: checked }
}

function cleared(state: ListState): ListState {
	return { ...state, checked: NONE, anchor: null, base: NONE, mode: false }
}

/** `base` plus every card from `from` to `to`, in screen order. */
function withRange(
	base: ReadonlySet<string>,
	visible: string[],
	from: string,
	to: string,
): ReadonlySet<string> {
	const i = visible.indexOf(from)
	const j = visible.indexOf(to)
	if (i < 0 || j < 0) return base
	return new Set([...base, ...visible.slice(Math.min(i, j), Math.max(i, j) + 1)])
}

/**
 * The list "select all" takes: the one holding a checked card, else the cursor's, else the first.
 * The search page keeps its trash apart from the rest.
 */
export function selectionScope(
	sections: string[][],
	checked: ReadonlySet<string>,
	cursor: string | null,
): string[] {
	const first = checked.values().next().value ?? cursor
	return (first && sections.find((s) => s.includes(first))) || sections[0] || []
}
