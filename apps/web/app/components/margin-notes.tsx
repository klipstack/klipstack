import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { HIGHLIGHT_MAP_ROOM } from "~/components/highlight-map"
import { highlightColor, highlightColorName } from "~/lib/highlight-colors"
import { firstRect, type RenderableHighlight } from "~/lib/highlights.client"
import { layoutMargin, sameTops } from "~/lib/margin-layout"
import type { LinkTargets } from "~/lib/note-links"
import { cn } from "~/lib/utils"
import { NoteText } from "./note-text"
import { PostIt, tiltFor } from "./post-it"

/**
 * Note column width (13rem), its gap to the article (8px, plus the article's own padding), and the
 * highlight map's room at the page's edge.
 */
const NOTE_WIDTH = 208
const NEEDED = NOTE_WIDTH + 8 + HIGHLIGHT_MAP_ROOM
const GAP = 12

/**
 * A note in the margin, shown or being written: the same paper, size, lean, edge and type, so the
 * text stays put when one becomes the other. The edge, in the highlight's color, ties it to its
 * highlight. Notes stand against the article, as wide as their text needs.
 */
export const MARGIN_NOTE = "border-l-[3px] border-(--hl-solid) text-sm leading-snug"

/**
 * True when there is room right of the article for the notes: a mouse (not touch) and enough free
 * space between the article and the page's right edge (the open sidebar's room is the sidebar's).
 */
export function useMarginRoom(
	articleRef: React.RefObject<HTMLElement | null>,
	enabled: boolean,
): boolean {
	const [room, setRoom] = useState(false)
	useEffect(() => {
		const article = articleRef.current
		const page = article?.parentElement
		if (!enabled || !article || !page) {
			setRoom(false)
			return
		}
		const fine = window.matchMedia("(pointer: fine)")
		const measure = () => {
			const right =
				page.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(page).paddingRight)
			setRoom(fine.matches && right - article.getBoundingClientRect().right >= NEEDED)
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(page)
		observer.observe(article)
		window.addEventListener("resize", measure)
		fine.addEventListener("change", measure)
		return () => {
			observer.disconnect()
			window.removeEventListener("resize", measure)
			fine.removeEventListener("change", measure)
		}
	}, [articleRef, enabled])
	return room
}

interface Props {
	articleRef: React.RefObject<HTMLElement | null>
	paused?: boolean
	rangesRef: React.RefObject<Map<string, Range>>
	/** Highlights with a note, plus the one whose note is being written. */
	items: RenderableHighlight[]
	editingId: string | null
	hoveredId: string | null
	linkTargets: LinkTargets
	/** Where Back should return to, for the links inside a note. */
	from: string
	onOpen: (id: string) => void
	onHover: (id: string | null) => void
	renderEditor: (item: RenderableHighlight) => React.ReactNode
	/** AI threads' cards, stacked with the notes. */
	cards?: MarginCard[]
	cardRangesRef?: React.RefObject<Map<string, Range>>
}

/** Anything else that sits in the margin next to its passage. */
export interface MarginCard {
	id: string
	start: number
	/** Above the notes: an open card covers what it grows over. */
	front?: boolean
	node: React.ReactNode
}

/**
 * Highlight notes in the margin right of the article, each level with the first line of its
 * highlight. The layer lives inside the article, so notes scroll with the text on their own. Notes
 * that would overlap are pushed down (`layoutMargin`).
 */
export function MarginNotes({
	articleRef,
	paused,
	rangesRef,
	items,
	editingId,
	hoveredId,
	linkTargets,
	from,
	onOpen,
	onHover,
	renderEditor,
	cards = [],
	cardRangesRef,
}: Props) {
	const { t } = useTranslation("reader")
	const layerRef = useRef<HTMLElement>(null)
	const [tops, setTops] = useState<Map<string, number>>(new Map())
	const frame = useRef(0)

	const layout = useCallback(() => {
		cancelAnimationFrame(frame.current)
		if (paused) return
		// Next frame: the reader's effect rebuilds the highlight ranges after this component's effects.
		frame.current = requestAnimationFrame(() => {
			const article = articleRef.current
			const layer = layerRef.current
			if (!article || !layer) return
			const origin = article.getBoundingClientRect().top
			const measured = []
			for (const el of layer.querySelectorAll<HTMLElement>(":scope > [data-note-id]")) {
				const id = el.dataset.noteId ?? ""
				const range = rangesRef.current.get(id) ?? cardRangesRef?.current.get(id)
				const rect = range ? firstRect(range) : null
				if (!rect) continue
				measured.push({
					id,
					wantedTop: rect.top - origin,
					height: el.offsetHeight,
					start: Number(el.dataset.start),
				})
			}
			const next = layoutMargin(measured, GAP)
			setTops((prev) => (sameTops(prev, next) ? prev : next))
		})
	}, [articleRef, rangesRef, cardRangesRef, paused])

	// What sits in the margin, and where it starts: the parent passes new arrays on every render
	// (each streamed word of an answer), so the effects below follow this instead.
	const placed = [
		...items.map((item) => `${item.id}:${item.startOffset}:${item.endOffset}`),
		...cards.map((card) => `${card.id}:${card.start}:${card.front ? 1 : 0}`),
	].join()

	// Lay out again whenever the notes change
	useLayoutEffect(() => {
		layout()
	}, [layout, placed, editingId])

	// The article reflows (images load, reader prefs, window width) and notes change height (typing).
	// Observe the current note elements
	useEffect(() => {
		const article = articleRef.current
		const layer = layerRef.current
		if (!article || !layer) return
		const observer = new ResizeObserver(layout)
		observer.observe(article)
		for (const el of layer.children) observer.observe(el)
		void document.fonts?.ready.then(layout)
		return () => {
			observer.disconnect()
			cancelAnimationFrame(frame.current)
		}
	}, [articleRef, layout, placed, editingId])

	return (
		<section
			ref={layerRef}
			aria-label={t("highlights.margin.label")}
			// A layer of its own, under the top bar and the outline: a note or card brought to the front
			// (z-30) is in front of the margin's others, not of the page.
			className="absolute top-0 left-full z-10 ml-2 font-sans"
			style={{ width: NOTE_WIDTH }}
		>
			{items.map((item) => {
				const top = tops.get(item.id)
				const editing = item.id === editingId
				return (
					<div
						key={item.id}
						data-note-id={item.id}
						data-start={item.startOffset}
						className={cn("absolute inset-x-0", editing ? "z-30" : "z-10")}
						// Not yet measured: invisible but still focusable, so a new note's editor takes the keyboard.
						style={{ top: top ?? 0, opacity: top === undefined ? 0 : undefined }}
					>
						{editing ? (
							renderEditor(item)
						) : (
							// Not a <button>: a note holds links, and a link inside a button is invalid HTML.
							<PostIt
								variant="compact"
								fit={item.note ?? ""}
								tilt={tiltFor(item.id)}
								role="button"
								tabIndex={0}
								{...highlightColor(item.color)}
								color={highlightColorName(item.color)}
								onMouseEnter={() => onHover(item.id)}
								onMouseLeave={() => onHover(null)}
								onClick={(e) => {
									// A chip opens its article; only the note itself opens the editor.
									if ((e.target as Element).closest("a")) return
									// Selecting text in the note is not a request to edit it.
									if (window.getSelection()?.isCollapsed === false) return
									onOpen(item.id)
								}}
								onKeyDown={(e) => {
									if (e.key !== "Enter" && e.key !== " ") return
									if ((e.target as Element).closest("a")) return
									e.preventDefault()
									onOpen(item.id)
								}}
								className={cn(
									MARGIN_NOTE,
									"mr-auto block cursor-text select-text text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									hoveredId === item.id && "ring-1 ring-(--hl-solid)",
								)}
							>
								<span className="line-clamp-6">
									<NoteText text={item.note ?? ""} linkTargets={linkTargets} from={from} />
								</span>
							</PostIt>
						)}
					</div>
				)
			})}
			{cards.map((card) => {
				const top = tops.get(card.id)
				return (
					<div
						key={card.id}
						data-note-id={card.id}
						data-start={card.start}
						className={cn("absolute inset-x-0", card.front ? "z-30" : "z-10")}
						style={{ top: top ?? 0, opacity: top === undefined ? 0 : undefined }}
					>
						{card.node}
					</div>
				)
			})}
		</section>
	)
}
