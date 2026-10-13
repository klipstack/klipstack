import { memo, useEffect, useMemo, useState } from "react"
import { type Crossing, inkCrossings, inkLines, inkStroke, type Stroke } from "~/lib/highlight-ink"
import { onPaintChange, paintedRanges } from "~/lib/highlights.client"

/** How long after it is made a highlight's strokes are still drawn in (`.hl-ink[data-fresh]`). */
const DRAWN_IN_MS = 1500
/** Strokes go in bands this tall: scrolling adds or drops a band, and leaves the others alone. */
const BAND = 1000

interface Painted {
	/** The highlight's id. */
	key: string
	/** Its strokes' shape: kept from its temporary id to its saved one. */
	seed: string
	/** Right to left: drawn in from the right. */
	rtl: boolean
	color: string
	index: number
	active: boolean
	fresh: boolean
	strokes: Stroke[]
}

interface Band {
	index: number
	strokes: Array<
		Stroke & {
			key: string
			seed: string
			color: string
			active: boolean
			fresh: boolean
			rtl: boolean
		}
	>
	crossings: Array<Crossing & { active: boolean }>
}

/**
 * Paints the highlights inside `rootRef` with a marker: one stroke per line of each, in its color
 * (`.hl-inks` in app.css). The layer lies under the text, so the letters keep their full strength,
 * and strokes that cross get darker. Measured
 * again whenever the highlights change, the text reflows, a font or an image loads, or a box
 * inside the text scrolls. Pointer events go through to the text.
 *
 * The highlight in focus (`outlined`) also gets a line around each of its strokes (`.hl-pop`), drawn
 * over the ink and not blended into the text.
 *
 * Place it after the text, inside the positioned element `containerRef` it covers. That element
 * must isolate (`isolate`): the ink goes under its text, not under the page.
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
	const [{ painted, crossings }, setPainted] = useState<{
		painted: Painted[]
		crossings: Crossing[]
	}>({ painted: [], crossings: [] })
	// The part of the container on screen, a screen more above and below, in steps of half a screen:
	// only strokes there are in the page, however long the article and however many highlights.
	const [view, setView] = useState<{ top: number; bottom: number } | null>(null)
	useEffect(() => {
		const container = containerRef.current
		if (!container) return
		let frame = 0
		const update = () => {
			const screen = window.innerHeight
			const step = Math.max(screen / 2, 100)
			const top = Math.floor(-container.getBoundingClientRect().top / step) * step - screen
			setView((v) => (v?.top === top ? v : { top, bottom: top + 3 * screen + step }))
		}
		const onScroll = () => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(update)
		}
		update()
		document.addEventListener("scroll", onScroll, { capture: true, passive: true })
		window.addEventListener("resize", onScroll)
		// Something above the text grows or shrinks (a card, an image): it moves without a scroll.
		const observer = new ResizeObserver(onScroll)
		observer.observe(document.body)
		return () => {
			cancelAnimationFrame(frame)
			observer.disconnect()
			document.removeEventListener("scroll", onScroll, { capture: true })
			window.removeEventListener("resize", onScroll)
		}
	}, [containerRef])
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
			const clips = new Map<Element, DOMRect | null>()
			const next = ranges.map((p) => ({
				key: p.id ?? p.seed,
				seed: p.seed,
				rtl: getComputedStyle(parentOf(p.range.startContainer) ?? root).direction === "rtl",
				color: p.color,
				index: p.index,
				active: p.active,
				fresh: p.created !== undefined && now - p.created < DRAWN_IN_MS,
				strokes: inkLines(textRects(p.range, root, clips)).map((line, i) =>
					inkStroke(line, origin, p.seed, i),
				),
			}))
			setPainted({ painted: next, crossings: inkCrossings(next) })
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
	const bands = useMemo(() => inBands(painted, crossings), [painted, crossings])
	return (
		<>
			<div aria-hidden className="hl-inks" data-testid="highlight-ink">
				<InkIndex painted={painted} />
				{bands.map((band) => (
					<InkBand
						key={band.index}
						band={band}
						shown={!view || ((band.index + 1) * BAND > view.top && band.index * BAND < view.bottom)}
					/>
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

/** One empty mark per highlight painted, on screen or not: its color, place and lines (e2e/helpers.ts). */
const InkIndex = memo(({ painted }: { painted: Painted[] }) => {
	return painted.map((p) => (
		<i
			key={p.key}
			hidden
			data-key={p.key}
			data-hl={p.color}
			data-index={p.index}
			data-lines={p.strokes.length}
		/>
	))
})

const InkBand = memo(({ band, shown }: { band: Band; shown: boolean }) => {
	if (!shown) return null
	return (
		<>
			{band.strokes.map((s) => (
				<span
					// Same line, same element: a reflow moves the stroke without drawing it again.
					key={`${s.seed}:${s.line}`}
					className="hl-ink"
					data-key={s.key}
					data-hl={s.color}
					data-active={s.active || undefined}
					data-fresh={s.fresh || undefined}
					data-rtl={(s.fresh && s.rtl) || undefined}
					style={{ ...strokeStyle(s), animationDelay: s.fresh ? `${s.line * 0.12}s` : undefined }}
				/>
			))}
			{band.crossings.map((c) => (
				<span
					key={`${c.keys.join()}:${c.left},${c.top}`}
					className="hl-cross"
					data-active={c.active || undefined}
					style={
						{
							left: c.left,
							top: c.top,
							width: c.width,
							height: c.height,
							"--a": `var(--hl-${c.colors[0]})`,
							"--b": `var(--hl-${c.colors[1]})`,
						} as React.CSSProperties
					}
				/>
			))}
		</>
	)
})

function inBands(painted: Painted[], crossings: Crossing[]): Band[] {
	const bands = new Map<number, Band>()
	const band = (top: number) => {
		const index = Math.floor(top / BAND)
		let found = bands.get(index)
		if (!found) bands.set(index, (found = { index, strokes: [], crossings: [] }))
		return found
	}
	const active = new Set<string>()
	for (const p of painted) {
		if (p.active) active.add(p.key)
		for (const s of p.strokes)
			band(s.top).strokes.push({
				...s,
				key: p.key,
				seed: p.seed,
				color: p.color,
				active: p.active,
				fresh: p.fresh,
				rtl: p.rtl,
			})
	}
	for (const c of crossings)
		band(c.top).crossings.push({ ...c, active: c.keys.some((k) => active.has(k)) })
	return [...bands.values()].sort((a, b) => a.index - b.index)
}

const strokeStyle = (s: Stroke): React.CSSProperties => ({
	left: s.left,
	top: s.top,
	width: s.width,
	height: s.height,
	borderRadius: s.radius,
	transform: s.tilt ? `rotate(${s.tilt}deg)` : undefined,
})

const parentOf = (node: Node) => (node instanceof Element ? node : node.parentElement)

/**
 * The rectangles of a range's text, its text alone: `Range.getClientRects` also gives the box of
 * every element wholly inside it (a paragraph, an image), which would paint as one block. Each is cut
 * to the box that scrolls it sideways (a code block, a wide table), whose overflow the ink, outside
 * it, would not be clipped by.
 */
function textRects(range: Range, root: Element, clips: Map<Element, DOMRect | null>): DOMRect[] {
	const rects: DOMRect[] = []
	const start = range.startContainer
	const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT)
	let node: Node | null
	if (start.nodeType === Node.TEXT_NODE) node = walker.currentNode = start
	else {
		walker.currentNode = start.childNodes[range.startOffset] ?? start
		node = walker.currentNode.nodeType === Node.TEXT_NODE ? walker.currentNode : walker.nextNode()
	}
	const part = document.createRange()
	for (; node; node = walker.nextNode()) {
		if (range.comparePoint(node, 0) > 0) break
		if (!range.intersectsNode(node)) continue
		part.selectNodeContents(node)
		if (node === start) part.setStart(node, range.startOffset)
		if (node === range.endContainer) part.setEnd(node, range.endOffset)
		const clip = clipOf(node.parentElement, root, clips)
		for (const r of part.getClientRects()) {
			if (!clip) rects.push(r)
			else {
				const left = Math.max(r.left, clip.left)
				const right = Math.min(r.right, clip.right)
				if (right > left) rects.push(new DOMRect(left, r.top, right - left, r.height))
			}
		}
	}
	return rects
}

/** The box of the nearest element inside `root` that scrolls or clips `el` sideways, if any. */
function clipOf(
	el: Element | null,
	root: Element,
	clips: Map<Element, DOMRect | null>,
): DOMRect | null {
	if (!el || el === root || !root.contains(el)) return null
	let clip = clips.get(el)
	if (clip === undefined) {
		clip =
			getComputedStyle(el).overflowX !== "visible"
				? el.getBoundingClientRect()
				: clipOf(el.parentElement, root, clips)
		clips.set(el, clip)
	}
	return clip
}
