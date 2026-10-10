import { type RefObject, useEffect, useMemo, useRef } from "react"

/** How long the pointer rests on a link before its card opens: long enough to skip a pass. */
export const HOVER_OPEN_MS = 300
/** How long the card stays once the pointer has left both the link and the card. */
export const HOVER_CLOSE_MS = 1000

interface Handlers {
	/** The pointer rested on this link. */
	open: (link: HTMLAnchorElement) => void
	/** The pointer left the link and the card for good. */
	close: () => void
}

/**
 * The link card on mouse hover. It opens after the pointer rests on a link for `HOVER_OPEN_MS`,
 * and closes `HOVER_CLOSE_MS` after the pointer leaves both the link and the card: time to cross
 * the gap between them, or to come back. Touch and pens have no hover; a tap opens the card as a
 * click does. Spread `cardHover` on the card, so the pointer inside it keeps it open.
 */
export function useLinkHover(
	rootRef: RefObject<HTMLElement | null>,
	enabled: boolean,
	handlers: Handlers,
) {
	const timers = useRef<{
		open?: ReturnType<typeof setTimeout>
		close?: ReturnType<typeof setTimeout>
	}>({})
	// The latest handlers, for timers that fire after a render.
	const latest = useRef(handlers)
	useEffect(() => {
		latest.current = handlers
	})

	useEffect(() => {
		const root = rootRef.current
		const t = timers.current
		if (!enabled || !root) return
		const linkAt = (target: EventTarget | null) => {
			const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null
			return link &&
				root.contains(link) &&
				!link.getAttribute("href")?.startsWith("#") &&
				/^https?:/i.test(link.href)
				? link
				: null
		}
		const onOver = (event: PointerEvent) => {
			if (event.pointerType !== "mouse" || event.buttons) return
			const link = linkAt(event.target)
			if (!link || link === linkAt(event.relatedTarget)) return
			clearTimeout(t.close)
			clearTimeout(t.open)
			t.open = setTimeout(() => latest.current.open(link), HOVER_OPEN_MS)
		}
		const onOut = (event: PointerEvent) => {
			if (event.pointerType !== "mouse") return
			const link = linkAt(event.target)
			if (!link || link === linkAt(event.relatedTarget)) return
			clearTimeout(t.open)
			clearTimeout(t.close)
			t.close = setTimeout(() => latest.current.close(), HOVER_CLOSE_MS)
		}
		root.addEventListener("pointerover", onOver)
		root.addEventListener("pointerout", onOut)
		return () => {
			clearTimeout(t.open)
			clearTimeout(t.close)
			root.removeEventListener("pointerover", onOver)
			root.removeEventListener("pointerout", onOut)
		}
	}, [rootRef, enabled])

	const cardHover = useMemo(
		() => ({
			onPointerEnter: (event: React.PointerEvent) => {
				if (event.pointerType === "mouse") clearTimeout(timers.current.close)
			},
			onPointerLeave: (event: React.PointerEvent) => {
				if (event.pointerType !== "mouse") return
				clearTimeout(timers.current.close)
				timers.current.close = setTimeout(() => latest.current.close(), HOVER_CLOSE_MS)
			},
		}),
		[],
	)
	return cardHover
}
