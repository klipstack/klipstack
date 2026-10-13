import { useEffect, useState } from "react"
import { inkLines, inkStroke, type Stroke } from "~/lib/highlight-ink"
import { onPaintChange, paintedRanges } from "~/lib/highlights.client"

/** How long after it is made a highlight's strokes are still drawn in (`.hl-ink[data-fresh]`). */
const DRAWN_IN_MS = 1500

interface Painted {
	key: string
	color: string
	index: number
	active: boolean
	fresh: boolean
	strokes: Stroke[]
}

/**
 * Paints the highlights inside `rootRef` with a marker: one stroke per line of each, in its color
 * (`.hl-inks` in app.css). The layer lies over the text and blends into it, so the letters stay
 * as dark (or, in dark mode, as light) as they are, and strokes that cross get darker. Measured
 * again whenever the highlights change, the text reflows, a font or an image loads, or a box
 * inside the text scrolls. Pointer events go through to the text.
 *
 * The highlight in focus (`outlined`) also gets a line around each of its strokes (`.hl-pop`), drawn
 * over the ink and not blended into the text.
 *
 * Place it after the text, inside the positioned element `containerRef` it covers.
 */
export function HighlightInk({
	rootRef,
	containerRef,
	outlined = null,
}: {
	rootRef: React.RefObject<HTMLElement | null>
	containerRef: React.RefObject<HTMLElement | null>
	/** The id of the highlight in focus. */
	outlined?: string | null
}) {
	const [painted, setPainted] = useState<Painted[]>([])
	useEffect(() => {
		const root = rootRef.current
		const container = containerRef.current
		if (!root || !container) return
		let frame = 0
		let drawnIn: ReturnType<typeof setTimeout> | undefined
		const draw = () => {
			const origin = container.getBoundingClientRect()
			const now = performance.now()
			const ranges = paintedRanges(root)
			// Once the newest is drawn in, again without the mark: a reflow then won't draw it in again.
			const newest = Math.max(...ranges.map((p) => p.created ?? Number.NEGATIVE_INFINITY))
			clearTimeout(drawnIn)
			if (now - newest < DRAWN_IN_MS) drawnIn = setTimeout(measure, DRAWN_IN_MS - (now - newest))
			setPainted(
				ranges.map((p) => ({
					key: p.seed,
					color: p.color,
					index: p.index,
					active: p.active,
					fresh: p.created !== undefined && now - p.created < DRAWN_IN_MS,
					strokes: inkLines(p.range.getClientRects()).map((line, i) =>
						inkStroke(line, origin, p.seed, i),
					),
				})),
			)
		}
		const measure = () => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(draw)
		}
		draw()
		const unsubscribe = onPaintChange(measure)
		const observer = new ResizeObserver(measure)
		observer.observe(root)
		observer.observe(container)
		window.addEventListener("resize", measure)
		root.addEventListener("load", measure, true)
		root.addEventListener("scroll", measure, true)
		document.fonts.addEventListener("loadingdone", measure)
		return () => {
			cancelAnimationFrame(frame)
			clearTimeout(drawnIn)
			unsubscribe()
			observer.disconnect()
			window.removeEventListener("resize", measure)
			root.removeEventListener("load", measure, true)
			root.removeEventListener("scroll", measure, true)
			document.fonts.removeEventListener("loadingdone", measure)
		}
	}, [rootRef, containerRef])

	const focus = outlined === null ? undefined : painted.find((p) => p.key === outlined)
	return (
		<>
			<div aria-hidden className="hl-inks" data-testid="highlight-ink">
				{painted.map((p) => (
					<div
						key={p.key}
						data-hl={p.color}
						data-index={p.index}
						data-active={p.active || undefined}
					>
						{p.strokes.map((s) => (
							<span
								// Same line, same element: a reflow moves the stroke without drawing it again.
								key={s.line}
								className="hl-ink"
								data-fresh={p.fresh || undefined}
								style={{
									...strokeStyle(s),
									animationDelay: p.fresh ? `${s.line * 0.12}s` : undefined,
								}}
							/>
						))}
					</div>
				))}
			</div>
			{focus ? (
				<div
					aria-hidden
					data-hl={focus.color}
					className="pointer-events-none absolute inset-0 z-[5]"
				>
					{focus.strokes.map((s) => (
						<span
							key={`${focus.key}:${s.line}`}
							className="hl-pop hl-outline"
							style={strokeStyle(s)}
						/>
					))}
				</div>
			) : null}
		</>
	)
}

const strokeStyle = (s: Stroke): React.CSSProperties => ({
	left: s.left,
	top: s.top,
	width: s.width,
	height: s.height,
	borderRadius: s.radius,
	transform: s.tilt ? `rotate(${s.tilt}deg)` : undefined,
})
