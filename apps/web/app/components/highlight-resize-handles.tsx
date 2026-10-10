import { useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { useHighlightResize } from "~/hooks/use-highlight-resize"
import { endpointRect, endpointVisible, pointerInside, textIndex } from "~/lib/highlight-resize"

type Controller = ReturnType<typeof useHighlightResize>
interface Props {
	resize: Controller
	articleRef: React.RefObject<HTMLElement | null>
	rootRef: React.RefObject<HTMLElement | null>
	headerRef: React.RefObject<HTMLElement | null>
	disabled: boolean
	onFocus: (id: string) => void
	focusId: string | null
	onFocused: () => void
}

type Geometry = Partial<
	Record<"start" | "end", { left: number; top: number; height: number; visible: boolean }>
>
const NOTHING: { id: string | null; rects: Geometry } = { id: null, rects: {} }

/** Controls are siblings of the canonical text root, never part of its offsets. */
export function HighlightResizeHandles({
	resize,
	articleRef,
	rootRef,
	headerRef,
	disabled,
	onFocus,
	focusId,
	onFocused,
}: Props) {
	const { t } = useTranslation("reader")
	const descriptionId = useId()
	const { item, session } = resize
	// The text index is built once per text root, the first time a highlight needs its handles.
	const indexRef = useRef<ReturnType<typeof textIndex> | null>(null)
	// Where the handles go, and for which highlight: another one's measurements never apply.
	const [measured, setMeasured] = useState<{ id: string | null; rects: Geometry }>(NOTHING)
	const itemId = item?.id ?? null
	if (itemId === null && measured !== NOTHING) setMeasured(NOTHING)
	const geometry = measured.id === itemId ? measured.rects : NOTHING.rects
	const start = session?.draft.start ?? item?.startOffset
	const end = session?.draft.end ?? item?.endOffset
	useEffect(() => {
		const article = articleRef.current
		const root = rootRef.current
		if (!article || !root || itemId === null || start === undefined || end === undefined) return
		if (indexRef.current?.root !== root) indexRef.current = textIndex(root)
		const index = indexRef.current
		let frame = 0
		let disposed = false
		const measure = () => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => {
				const origin = article.getBoundingClientRect()
				const top = headerRef.current?.getBoundingClientRect().bottom ?? 0
				const result: Geometry = {}
				for (const endpoint of ["start", "end"] as const) {
					const rect = endpointRect(index, { start, end }, endpoint)
					if (!rect) continue
					result[endpoint] = {
						left: rect.x - origin.left,
						top: rect.top - origin.top,
						height: rect.bottom - rect.top,
						visible: endpointVisible(rect, article, top + 12),
					}
				}
				setMeasured({ id: itemId, rects: result })
			})
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(article)
		observer.observe(index.root)
		if (article.parentElement) observer.observe(article.parentElement)
		window.addEventListener("resize", measure)
		document.addEventListener("scroll", measure, true)
		index.root.addEventListener("load", measure, true)
		document.fonts.addEventListener("loadingdone", measure)
		void document.fonts.ready.then(() => {
			if (!disposed) measure()
		})
		return () => {
			disposed = true
			cancelAnimationFrame(frame)
			observer.disconnect()
			window.removeEventListener("resize", measure)
			document.removeEventListener("scroll", measure, true)
			index.root.removeEventListener("load", measure, true)
			document.fonts.removeEventListener("loadingdone", measure)
		}
	}, [itemId, start, end, articleRef, rootRef, headerRef])
	useEffect(() => {
		if (!item || focusId !== item.id || !geometry.start?.visible) return
		articleRef.current
			?.querySelector<HTMLButtonElement>('[data-resize-handle="start"]')
			?.focus({ preventScroll: true })
		onFocused()
	}, [item, focusId, geometry, articleRef, onFocused])
	if (!item) return null
	const dragging = session?.mode === "pointer"
	return (
		<div
			data-resize-handles=""
			data-highlight-id={item.id}
			data-resize-state={resize.state}
			className="pointer-events-none absolute inset-0 z-10"
		>
			<p id={descriptionId} className="sr-only">
				{t("highlights.resize.instructions")}
			</p>
			{(["start", "end"] as const).map((endpoint) => {
				const rect = geometry[endpoint]
				return (
					<button
						key={endpoint}
						type="button"
						tabIndex={0}
						data-resize-handle={endpoint}
						aria-label={t(`highlights.resize.${endpoint}`)}
						aria-describedby={descriptionId}
						aria-disabled={disabled || session?.mode === "saving"}
						aria-pressed={session?.mode === "keyboard" && session.endpoint === endpoint}
						className="highlight-resize-handle"
						style={{
							left: rect?.left ?? 0,
							top: (rect?.top ?? 0) - 12,
							height: (rect?.height ?? 20) + 24,
							color: "var(--hl-solid)",
							visibility: rect?.visible ? "visible" : "hidden",
						}}
						onPointerEnter={(e) => {
							if (e.pointerType === "mouse") resize.hover(item.id)
						}}
						onPointerLeave={(e) => {
							if (e.pointerType !== "mouse") return
							// WebKit on Linux reports a leave as pointer capture ends, with the pointer still on
							// the handle: its hit test still sees the drag's `pointer-events: none`. A leave
							// that did not leave the handle keeps the handles up.
							if (pointerInside(e.currentTarget, e)) return
							resize.hover(null)
						}}
						onPointerDown={(e) => resize.pointerDown(e, item, endpoint)}
						onPointerMove={resize.pointerMove}
						onPointerUp={resize.pointerUp}
						onPointerCancel={resize.cancel}
						onLostPointerCapture={resize.cancel}
						onKeyDown={(e) => resize.keyDown(e, item, endpoint)}
						onFocus={() => onFocus(item.id)}
						onBlur={() => {
							if (session?.mode === "keyboard") resize.cancel()
						}}
						onClick={(e) => {
							e.preventDefault()
							e.stopPropagation()
						}}
					>
						<span aria-hidden className={dragging ? "resize-cue" : "resize-stem"} />
					</button>
				)
			})}
		</div>
	)
}
