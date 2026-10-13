import { describeRange, type TextSelector } from "@klipstack/anchor"
import { useCallback, useEffect, useRef } from "react"

/** One word is a lookup, not a highlight: a highlight takes at least two words. */
export function isHighlightable(text: string): boolean {
	return text.trim().split(/\s+/).filter(Boolean).length >= 2
}

/** A selection in the article, as it was when it settled. */
export interface ArticleSelection {
	selector: TextSelector
	/** A copy of the selected range: the selection itself may be gone by the time it is acted on. */
	range: Range
}

interface Props {
	rootRef: React.RefObject<HTMLElement | null>
	/** A selection settled. Closing what it opened is up to the reader (a press elsewhere, Escape). */
	onSelect: (selection: ArticleSelection) => void
	disabled?: boolean
	interactionGuard?: React.RefObject<boolean>
}

/**
 * Watches the selection inside the article and reports it once it settles: right after mouse-up
 * with a mouse; about a second after the selection stops changing for touch and keyboard, so iOS
 * handle adjustments still work, one word included. The reader then offers what to do with it
 * (SelectionToolbar).
 * Nothing is highlighted on its own. Escape drops the selection.
 */
export function SelectionWatcher({ rootRef, onSelect, disabled, interactionGuard }: Props) {
	const mouseDown = useRef(false)
	const lastTouch = useRef(0)

	const readSelection = useCallback((): ArticleSelection | null => {
		const root = rootRef.current
		const selection = window.getSelection()
		if (!root || !selection?.rangeCount || selection.isCollapsed) return null
		const range = selection.getRangeAt(0)
		if (!root.contains(range.commonAncestorContainer)) return null
		const selector = describeRange(range, root)
		return selector?.exact.trim() ? { selector, range: range.cloneRange() } : null
	}, [rootRef])

	useEffect(() => {
		if (disabled) {
			mouseDown.current = false
			return
		}
		let timer: number | undefined
		// Only a selection that changed is reported: a click in the toolbar it opened leaves it as is.
		let changed = false
		const finalize = () => {
			if (interactionGuard?.current || !changed) return
			changed = false
			const selection = readSelection()
			if (selection) onSelect(selection)
		}
		const onSelectionChange = () => {
			changed = true
			window.clearTimeout(timer)
			if (mouseDown.current || interactionGuard?.current) return
			timer = window.setTimeout(finalize, 900)
		}
		const onMouseDown = (e: MouseEvent) => {
			if (e.button === 0 && !interactionGuard?.current) mouseDown.current = true
		}
		const onMouseUp = (e: MouseEvent) => {
			if (e.button !== 0 || interactionGuard?.current) {
				mouseDown.current = false
				return
			}
			mouseDown.current = false
			// Touch screens synthesize mouse events after taps; those go through the debounce path.
			if (Date.now() - lastTouch.current < 700) return
			window.clearTimeout(timer)
			timer = window.setTimeout(finalize, 0)
		}
		const onTouchEnd = () => {
			lastTouch.current = Date.now()
		}
		const onKey = (e: KeyboardEvent) => {
			// Escape in a field (a note at the end of the article) is the field's: its caret stays.
			if ((e.target as Element | null)?.closest?.("input, textarea, [contenteditable='true']"))
				return
			if (e.key === "Escape") {
				window.clearTimeout(timer)
				window.getSelection()?.removeAllRanges()
			}
		}
		document.addEventListener("selectionchange", onSelectionChange)
		document.addEventListener("mousedown", onMouseDown)
		document.addEventListener("mouseup", onMouseUp)
		document.addEventListener("touchend", onTouchEnd, { passive: true })
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("selectionchange", onSelectionChange)
			document.removeEventListener("mousedown", onMouseDown)
			document.removeEventListener("mouseup", onMouseUp)
			document.removeEventListener("touchend", onTouchEnd)
			document.removeEventListener("keydown", onKey)
			window.clearTimeout(timer)
		}
	}, [disabled, readSelection, onSelect, interactionGuard])

	return null
}
