import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLocation } from "react-router"
import { Kbd } from "./more-menu"

/**
 * Props for a control that shows a tooltip: `label`, plus the key that does the same thing. The
 * tooltip is decoration; the control still needs its own accessible name (aria-label). `side:
 * "right"` suits controls along the left edge (the sidebar), where below would cover a neighbour.
 */
export function tooltip(label: string, kbd?: string, side?: "right") {
	return { "data-tooltip": label, "data-tooltip-kbd": kbd, "data-tooltip-side": side }
}

interface Shown {
	el: HTMLElement
	container: HTMLElement
	label: string
	kbd: string | null
	right: boolean
}

const DELAY_MS = 500
/** Moving from one control to the next soon after keeps tooltips coming without the delay. */
const WARM_MS = 400
const GAP = 6
const MARGIN = 8

/**
 * One tooltip for the whole app, for any element with `data-tooltip`. Shows after a short hover or
 * on keyboard focus; never on touch, where a tap would leave it stuck.
 */
export function TooltipHost() {
	const [shown, setShown] = useState<Shown | null>(null)
	const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
	const bubbleRef = useRef<HTMLDivElement>(null)
	const location = useLocation()

	useEffect(() => {
		let timer: number | undefined
		let current: HTMLElement | null = null
		let hiddenAt = 0
		const show = (el: HTMLElement) => {
			const label = el.dataset.tooltip
			if (!label) return
			setShown({
				el,
				// A native modal sits above body-level portals.
				container: el.closest("dialog") ?? document.body,
				label,
				kbd: el.dataset.tooltipKbd || null,
				right: el.dataset.tooltipSide === "right",
			})
		}
		const hide = () => {
			window.clearTimeout(timer)
			if (current) hiddenAt = Date.now()
			current = null
			setShown(null)
		}
		const target = (e: Event) =>
			e.target instanceof Element ? e.target.closest<HTMLElement>("[data-tooltip]") : null

		const onOver = (e: PointerEvent) => {
			if (e.pointerType === "touch") return
			const el = target(e)
			if (!el || el === current) return
			hide()
			current = el
			if (Date.now() - hiddenAt < WARM_MS) show(el)
			else timer = window.setTimeout(() => show(el), DELAY_MS)
		}
		const onOut = (e: PointerEvent) => {
			if (!current || (e.relatedTarget instanceof Node && current.contains(e.relatedTarget))) return
			hide()
		}
		const onFocus = (e: FocusEvent) => {
			const el = target(e)
			if (!el?.matches(":focus-visible")) return
			hide()
			current = el
			show(el)
		}

		document.addEventListener("pointerover", onOver)
		document.addEventListener("pointerout", onOut)
		document.addEventListener("focusin", onFocus)
		document.addEventListener("focusout", hide)
		document.addEventListener("pointerdown", hide)
		document.addEventListener("keydown", hide)
		document.addEventListener("scroll", hide, { capture: true, passive: true })
		window.addEventListener("resize", hide)
		return () => {
			window.clearTimeout(timer)
			document.removeEventListener("pointerover", onOver)
			document.removeEventListener("pointerout", onOut)
			document.removeEventListener("focusin", onFocus)
			document.removeEventListener("focusout", hide)
			document.removeEventListener("pointerdown", hide)
			document.removeEventListener("keydown", hide)
			document.removeEventListener("scroll", hide, { capture: true })
			window.removeEventListener("resize", hide)
		}
	}, [])

	// A navigation can remove the element without any pointer event.
	const [shownAt, setShownAt] = useState(location.key)
	if (shownAt !== location.key) {
		setShownAt(location.key)
		setShown(null)
	}

	// Below the control, centered; above it when there is no room; always inside the viewport.
	// Controls that ask for it get it to their right, vertically centered.
	useLayoutEffect(() => {
		const bubble = bubbleRef.current
		if (!shown || !bubble) return setPosition(null)
		const rect = shown.el.getBoundingClientRect()
		const { offsetWidth: w, offsetHeight: h } = bubble
		if (shown.right) {
			const top = Math.min(
				Math.max(MARGIN, rect.top + rect.height / 2 - h / 2),
				window.innerHeight - h - MARGIN,
			)
			return setPosition({ top, left: rect.right + GAP })
		}
		const below = rect.bottom + GAP
		const top = below + h + MARGIN > window.innerHeight ? rect.top - GAP - h : below
		const left = Math.min(
			Math.max(MARGIN, rect.left + rect.width / 2 - w / 2),
			window.innerWidth - w - MARGIN,
		)
		setPosition({ top, left })
	}, [shown])

	if (!shown) return null
	return createPortal(
		<div
			ref={bubbleRef}
			aria-hidden
			data-testid="tooltip"
			style={{
				position: "fixed",
				top: position?.top ?? 0,
				left: position?.left ?? 0,
				visibility: position ? "visible" : "hidden",
			}}
			className="pointer-events-none z-[60] flex max-w-64 items-center gap-2 rounded-md bg-fg px-2 py-1 text-xs text-bg shadow-md"
		>
			{shown.label}
			{shown.kbd ? <Kbd className="text-bg/70">{shown.kbd}</Kbd> : null}
		</div>,
		shown.container,
	)
}
