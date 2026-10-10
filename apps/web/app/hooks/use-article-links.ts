import { useCallback, useEffect, useState } from "react"
import { useRevalidator } from "react-router"
import type { LinkTarget } from "~/components/link-popover"
import { useLinkHover } from "~/hooks/use-link-hover"
import { useLinkPreviews } from "~/hooks/use-link-previews"

const linkTarget = (a: HTMLAnchorElement, hovered: boolean): LinkTarget => ({
	href: a.href,
	text: (a.textContent ?? "").trim(),
	savedId: a.dataset.savedId ?? null,
	rect: a.getBoundingClientRect(),
	hovered,
})

/**
 * Links inside the article: marks the ones already in the library (`loaded`: href as written →
 * id), and opens their card on hover or click. `blocked` says the reader is highlighting (a
 * selection, the highlight toolbar, a handle held): no card opens on hover then.
 */
export function useArticleLinks(
	contentRef: React.RefObject<HTMLElement | null>,
	loaded: Record<string, string>,
	blocked: () => boolean,
) {
	const revalidator = useRevalidator()
	const [savedLinks, setSavedLinks] = useState(loaded)
	const [seen, setSeen] = useState(loaded)
	if (seen !== loaded) {
		setSeen(loaded)
		setSavedLinks(loaded)
	}
	const [card, setCard] = useState<LinkTarget | null>(null)
	const previews = useLinkPreviews(contentRef, true)
	useEffect(() => {
		const root = contentRef.current
		if (!root) return
		for (const a of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
			const id = savedLinks[a.getAttribute("href") ?? ""]
			if (id) a.dataset.savedId = id
			else delete a.dataset.savedId
		}
	}, [contentRef, savedLinks])

	/** Opens the card of the link clicked, if the click was on one; true when it did. */
	const onClick = (e: React.MouseEvent): boolean => {
		const a = (e.target as Element).closest("a[href]") as HTMLAnchorElement | null
		if (!a || !contentRef.current?.contains(a)) return false
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return false
		const raw = a.getAttribute("href") ?? ""
		if (raw.startsWith("#") || !/^https?:/i.test(a.href)) return false
		e.preventDefault()
		// A click pins the card: the one the mouse already opened, or a new one, even before the
		// hover would have opened it.
		const target = linkTarget(a, false)
		setCard((current) => (current?.href === target.href ? { ...current, hovered: false } : target))
		return true
	}
	const hover = useLinkHover(contentRef, true, {
		open: (a) => {
			if (blocked() || window.getSelection()?.isCollapsed === false) return
			const target = linkTarget(a, true)
			// A pinned card stays until closed; a hovered one gives way to the next link.
			setCard((current) =>
				current && (!current.hovered || current.href === target.href) ? current : target,
			)
		},
		close: () => setCard((current) => (current?.hovered ? null : current)),
	})
	const pin = useCallback(
		() => setCard((current) => (current?.hovered ? { ...current, hovered: false } : current)),
		[],
	)
	const onSaved = useCallback(
		(href: string, id: string) => {
			setSavedLinks((prev) => {
				const next = { ...prev }
				const root = contentRef.current
				for (const a of root?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])
					if (a.href === href) next[a.getAttribute("href") ?? ""] = id
				return next
			})
			// The saved article is now one this content links to: the sidebar lists it.
			void revalidator.revalidate()
		},
		[contentRef, revalidator],
	)
	const close = useCallback(() => setCard(null), [])

	return { card, previews, hover, onClick, pin, onSaved, close }
}
