import { useCallback, useEffect, useInsertionEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { copyText } from "~/lib/copy-link"
import { rangeText } from "~/lib/range-text.client"
import { isCopyShortcut } from "~/lib/shortcuts"

/**
 * Copies a highlight's text as the page shows it, from the live range; the stored text keeps the
 * source's own line breaks. Without a range (not painted yet), the stored text with its white
 * space folded. ⌘C with nothing selected copies `inFocus`. It is two strings, not the item: an
 * item held by an effect makes the React Compiler give up on the page.
 */
export function useHighlightCopy(
	rangesRef: React.RefObject<Map<string, Range>>,
	inFocus: { id: string; exact: string } | null,
) {
	const { t } = useTranslation("reader")
	const copyHighlight = useCallback(
		(id: string, exact: string) => {
			const range = rangesRef.current.get(id)
			const text = range ? rangeText(range) : exact.replace(/\s+/g, " ").trim()
			copyText(text, t("highlights.popover.copied"))
		},
		[rangesRef, t],
	)
	const inFocusRef = useRef(inFocus)
	useInsertionEffect(() => {
		inFocusRef.current = inFocus
	})
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!isCopyShortcut(e)) return
			const target = inFocusRef.current
			if (!target) return
			e.preventDefault()
			copyHighlight(target.id, target.exact)
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [copyHighlight])
	return copyHighlight
}
