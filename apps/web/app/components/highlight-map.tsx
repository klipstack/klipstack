import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { tooltip } from "~/components/tooltip-host"
import { scrollSpan } from "~/hooks/use-reading-progress"
import { highlightColor } from "~/lib/highlight-colors"
import { flashCited, onPaintChange } from "~/lib/highlights.client"
import { cn } from "~/lib/utils"

/** The room the map takes at the page's right edge: its 1rem strip, 1.5rem in, and a gap. */
export const HIGHLIGHT_MAP_ROOM = 24 + 16 + 8

interface MapItem {
	id: string
	color?: number
	note?: string | null
	exact: string
}

interface Span {
	id: string
	/** Fractions of the text's height, 0 at its top. */
	top: number
	bottom: number
}

interface Mark {
	ids: string[]
	colors: Array<number | undefined>
	noted: boolean
	top: number
	bottom: number
	label: string
}

/** Marks closer than this (px on the strip) become one. */
const MERGE_PX = 4
/** The thinnest a mark is drawn, however short its highlight. */
const MIN_PX = 3
/** A tooltip's quote of a highlight: its start. */
const LABEL_CHARS = 80

/**
 * The marks for highlights at `spans` on a strip `height` px tall: one for each, in its color, or
 * one for several that would touch, its colors stacked.
 */
export function mapMarks(
	spans: Span[],
	items: Map<string, MapItem>,
	height: number,
	many: (count: number) => string,
): Mark[] {
	const marks: Mark[] = []
	const least = MIN_PX / Math.max(height, 1)
	for (const span of [...spans].sort((a, b) => a.top - b.top)) {
		const item = items.get(span.id)
		if (!item) continue
		const bottom = Math.max(span.bottom, span.top + least)
		const last = marks.at(-1)
		if (last && (span.top - last.bottom) * height < MERGE_PX) {
			last.ids.push(span.id)
			last.colors.push(item.color)
			last.noted ||= Boolean(item.note)
			last.bottom = Math.max(last.bottom, bottom)
			last.label = many(last.ids.length)
			continue
		}
		const text = item.exact.replace(/\s+/g, " ").trim()
		marks.push({
			ids: [span.id],
			colors: [item.color],
			noted: Boolean(item.note),
			top: span.top,
			bottom,
			label: text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS)}…` : text,
		})
	}
	return marks
}

/**
 * Where the article's highlights are: a thin strip near the window's right edge stands for the
 * whole text, with a tick in each highlight's colour where it sits, a dot beside those with a note,
 * and the ribbon's end where the reader left off last time. A click goes there. Not on phones,
 * where the sidebar's list does this, and not for an article with neither highlights nor a place
 * left off.
 */
export function HighlightMap({
	contentRef,
	rangesRef,
	items,
	sidebarOpen,
	resumedAt,
}: {
	contentRef: React.RefObject<HTMLElement | null>
	rangesRef: React.RefObject<Map<string, Range>>
	items: MapItem[]
	sidebarOpen: boolean
	/** The saved reading position the article opened at (useReadingProgress); null for none. */
	resumedAt: number | null
}) {
	const { t } = useTranslation("reader")
	const [height, setHeight] = useState(0)
	const [spans, setSpans] = useState<Span[]>([])
	const [left, setLeft] = useState<{ at: number; y: number } | null>(null)
	// Room for it between the text and the page's right edge (narrow windows, a wide text, the
	// open sidebar's column): never over the text.
	const [room, setRoom] = useState(false)

	// Where each highlight is in the text, measured again whenever the text or the paint changes.
	useEffect(() => {
		const root = contentRef.current
		if (!root) return
		let frame = 0
		const measure = () => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => {
				const box = root.getBoundingClientRect()
				const page = root.closest("article")?.parentElement
				if (page) {
					const right =
						page.getBoundingClientRect().right -
						Number.parseFloat(getComputedStyle(page).paddingRight)
					setRoom(right - box.right >= HIGHLIGHT_MAP_ROOM)
				}
				if (box.height <= 0) return
				const next: Span[] = []
				for (const [id, range] of rangesRef.current) {
					const rect = range.getBoundingClientRect()
					if (!rect.height) continue
					next.push({
						id,
						top: (rect.top - box.top) / box.height,
						bottom: (rect.bottom - box.top) / box.height,
					})
				}
				setSpans(next)
				if (resumedAt === null) return setLeft(null)
				// The inverse of useReadingProgress: the position is where the line a fifth down the
				// window was, measured over the page's reading span.
				const el = document.documentElement
				const line = resumedAt * scrollSpan(el)
				const at = (line - (box.top + window.scrollY)) / box.height
				setLeft(at > 0 && at < 1 ? { at, y: line - el.clientHeight * 0.2 } : null)
			})
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(root)
		const page = root.closest("article")?.parentElement
		if (page) observer.observe(page)
		const off = onPaintChange(measure)
		window.addEventListener("resize", measure)
		return () => {
			cancelAnimationFrame(frame)
			observer.disconnect()
			off()
			window.removeEventListener("resize", measure)
		}
		// The open sidebar moves the page's right edge.
	}, [contentRef, rangesRef, resumedAt, sidebarOpen])

	// The strip's height, for merging marks that would touch and for the thinnest ones.
	const trackRef = useCallback((track: HTMLDivElement | null) => {
		if (!track) return
		const observer = new ResizeObserver(() => setHeight(track.clientHeight))
		observer.observe(track)
		setHeight(track.clientHeight)
		return () => observer.disconnect()
	}, [])

	const marks = mapMarks(spans, new Map(items.map((h) => [h.id, h])), height, (count) =>
		t("highlights.map.many", { count }),
	)
	if (!room || (!marks.length && !left)) return null

	const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
	const go = (id: string) => {
		const range = rangesRef.current.get(id)
		if (!range) return
		const y = range.getBoundingClientRect().top + window.scrollY - window.innerHeight / 3
		window.scrollTo({ top: Math.max(0, y), behavior: still() ? "auto" : "smooth" })
		flashCited(range)
	}

	return (
		<nav
			aria-label={t("highlights.map.label")}
			data-testid="highlight-map"
			className={cn(
				"group/map pointer-events-none fixed top-24 right-6 bottom-10 z-10 w-4 max-md:hidden",
				// The open sidebar takes the page's right edge: the map moves to its edge.
				// Below lg it covers the map: no map then, not even for the keyboard.
				sidebarOpen && "max-lg:hidden lg:right-[calc(20rem+1.5rem)]",
			)}
		>
			{/* The text, top to bottom: a hairline. */}
			<div
				ref={trackRef}
				className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70"
			/>
			{left ? (
				// Where the reader left off last time: the reading ribbon's notched end, small.
				<button
					type="button"
					data-testid="highlight-map-left-off"
					onClick={() =>
						window.scrollTo({ top: Math.max(0, left.y), behavior: still() ? "auto" : "smooth" })
					}
					aria-label={t("highlights.map.leftOff")}
					{...tooltip(t("highlights.map.leftOff"))}
					className="pointer-events-auto absolute right-0 flex h-4 w-3 translate-x-full -translate-y-1/2 cursor-pointer justify-center"
					style={{ top: `${left.at * 100}%` }}
				>
					<span className="ribbon-end ink-line !static block !h-2.5 !w-1.5 opacity-80 transition-opacity hover:opacity-100" />
				</button>
			) : null}
			{marks.map((mark) => {
				const px = Math.max((mark.bottom - mark.top) * height, MIN_PX)
				return (
					<button
						key={mark.ids[0]}
						type="button"
						data-testid="highlight-map-mark"
						onClick={() => go(mark.ids[0]!)}
						aria-label={mark.label}
						{...tooltip(mark.label)}
						// The hit area is taller than its tick: at least 12px.
						className="pointer-events-auto absolute inset-x-0 flex min-h-3 -translate-y-1/2 cursor-pointer items-center justify-center"
						style={{ top: `${((mark.top + mark.bottom) / 2) * 100}%`, height: px }}
					>
						<span
							className="flex w-2 flex-col overflow-hidden rounded-[1px] opacity-85 transition-[width,opacity] duration-150 group-hover/map:w-2.5 group-hover/map:opacity-100 hover:!w-3.5"
							style={{ height: px }}
						>
							{mark.colors.map((color, i) => (
								<span
									key={mark.ids[i]}
									{...highlightColor(color)}
									className="block min-h-px flex-1 bg-(--hl-solid)"
								/>
							))}
						</span>
						{mark.noted ? (
							// A note in the margin: a dot on the text's side.
							<span
								aria-hidden
								className="absolute left-0 size-1 -translate-x-0.5 rounded-full bg-muted-fg/70"
							/>
						) : null}
					</button>
				)
			})}
		</nav>
	)
}
