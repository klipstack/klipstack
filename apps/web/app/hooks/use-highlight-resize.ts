import type { Highlight } from "@klipstack/db"
import { useCallback, useEffect, useInsertionEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher, useRevalidator } from "react-router"
import {
	type Endpoint,
	endpointRect,
	moveBoundary,
	type Offsets,
	offsetAtPoint,
	pointerInside,
	sameOffsets,
	stepBoundary,
	type TextIndex,
	textIndex,
} from "~/lib/highlight-resize"
import {
	canBegin,
	IDLE,
	type ResizeEvent,
	type ResizeFlow,
	sessionOf,
	transition,
} from "~/lib/highlight-resize-flow"
import {
	firstRect,
	highlightsAtPoint,
	replaceHighlightRange,
	setActiveHighlight,
} from "~/lib/highlights.client"
import type { WebResult } from "~/lib/web-result"

interface Session {
	documentId: string
	versionId: string
	original: Highlight
	draft: Offsets
	endpoint: Endpoint
	index: TextIndex
	position?: { x: number; y: number }
	pointer?: {
		id: number
		control: HTMLElement
		x: number
		y: number
		dx: number
		dy: number
		moved: boolean
		originX: number
		originY: number
	}
}
interface Props {
	documentId: string
	versionId: string | null
	rootRef: React.RefObject<HTMLElement | null>
	headerRef: React.RefObject<HTMLElement | null>
	rangesRef: React.RefObject<Map<string, Range>>
	items: Highlight[]
	toolbarId: string | null
	editingId: string | null
	mutationPending: boolean
	onSaved: (item: Highlight) => void
	onDismiss: () => void
	onPosition: (id: string, rect: DOMRect) => void
}

/** Confirmed items stay in the reader. A session owns only its draft and its one save request. */
export function useHighlightResize(props: Props) {
	const { t } = useTranslation("reader")
	const latest = useRef(props)
	useInsertionEffect(() => {
		latest.current = props
	})
	const fetcher = useFetcher<WebResult<{ highlight: Highlight }>>()
	const revalidator = useRevalidator()
	// The flow (lib/highlight-resize-flow.ts): the ref for event handlers, the state for rendering.
	const flowRef = useRef<ResizeFlow<Session>>(IDLE)
	const [flow, setFlow] = useState<ResizeFlow<Session>>(IDLE)
	const guard = useRef(false)
	const suppressClick = useRef(false)
	const mousePosition = useRef<{ x: number; y: number } | null>(null)
	const [hoverId, setHoverId] = useState<string | null>(null)
	const hoverRef = useRef<string | null>(null)
	const dismissed = useRef<string | null>(null)
	const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const frame = useRef(0)
	// What screen readers hear: the quote as it moves, saved, cancelled, failed.
	const [status, setStatus] = useState("")

	const dispatch = useCallback((event: ResizeEvent<Session>) => {
		const next = transition(flowRef.current, event)
		if (next === flowRef.current) return
		flowRef.current = next
		guard.current = sessionOf(next) !== null
		setFlow(next)
	}, [])
	const paint = useCallback((s: Session, dragging: boolean, offsets = s.draft) => {
		const p = latest.current
		const range = s.index.range(offsets)
		if (!range || !s.index.root.isConnected) return
		replaceHighlightRange(
			p.rangesRef.current,
			p.items.find((h) => h.id === s.original.id) ?? s.original,
			range,
			dragging,
		)
		if (dragging) setActiveHighlight(null)
		else if (p.toolbarId === s.original.id) setActiveHighlight(range)
	}, [])
	const release = useCallback((s: Session) => {
		cancelAnimationFrame(frame.current)
		if (s.pointer?.control.hasPointerCapture(s.pointer.id))
			s.pointer.control.releasePointerCapture(s.pointer.id)
		document.documentElement.removeAttribute("data-highlight-dragging")
	}, [])
	const restore = useCallback(
		(s: Session) => {
			const p = latest.current
			const item = p.items.find((h) => h.id === s.original.id)
			if (!item || p.versionId !== s.versionId) return
			paint(s, false, { start: item.startOffset, end: item.endOffset })
			const range = p.rangesRef.current.get(item.id)
			const rect = range && firstRect(range)
			if (rect) p.onPosition(item.id, rect)
		},
		[paint],
	)
	const cancel = useCallback(() => {
		const f = flowRef.current
		if (f.phase !== "pointer" && f.phase !== "keyboard") return
		// Clear ownership before releasing capture: lostpointercapture is also a cancellation.
		dispatch({ type: "cancelled" })
		release(f.session)
		restore(f.session)
		setStatus(t("highlights.resize.cancelled"))
	}, [dispatch, release, restore, t])
	const hover = useCallback((id: string | null) => {
		clearTimeout(hoverTimer.current)
		if (sessionOf(flowRef.current)) return
		if (id !== dismissed.current) dismissed.current = null
		hoverRef.current = id
		if (id) setHoverId(id === dismissed.current ? null : id)
		else hoverTimer.current = setTimeout(() => setHoverId(null), 150)
	}, [])
	const dismiss = useCallback(() => {
		dismissed.current = hoverRef.current ?? latest.current.toolbarId
		clearTimeout(hoverTimer.current)
		setHoverId(null)
		latest.current.onDismiss()
	}, [])

	const begin = (item: Highlight, endpoint: Endpoint, mode: "pointer" | "keyboard") => {
		const p = latest.current
		const root = p.rootRef.current
		if (
			!canBegin(flowRef.current) ||
			p.mutationPending ||
			p.editingId ||
			!root ||
			item.orphaned ||
			item.id.startsWith("tmp-") ||
			item.versionId !== p.versionId
		)
			return null
		const s: Session = {
			documentId: p.documentId,
			versionId: item.versionId,
			original: item,
			draft: { start: item.startOffset, end: item.endOffset },
			endpoint,
			index: textIndex(root),
		}
		clearTimeout(hoverTimer.current)
		window.getSelection()?.removeAllRanges()
		dispatch({ type: "begin", mode, session: s })
		return s
	}
	const move = useCallback(
		(s: Session, value: number) => {
			const draft = moveBoundary(s.index, s.draft, s.endpoint, value)
			if (draft === s.draft) return
			s.draft = draft
			paint(s, flowRef.current.phase === "pointer")
			dispatch({ type: "moved", session: { ...s } })
		},
		[dispatch, paint],
	)
	const resolvePointer = useCallback(
		(s: Session, x: number, y: number) => {
			const pointer = s.pointer
			if (!pointer) return
			s.position = { x, y }
			pointer.x = x
			pointer.y = y
			pointer.moved ||= Math.hypot(x - pointer.originX, y - pointer.originY) > 2
			if (!pointer.moved) return
			// Reject the raw pointer outside text, too: grab offsets must not reach into a sidebar.
			const root = s.index.root.getBoundingClientRect()
			if (x < root.left || x > root.right) return
			const value = offsetAtPoint(s.index, x - pointer.dx, y - pointer.dy)
			if (value !== null) move(s, value)
		},
		[move],
	)

	const send = useCallback(
		(s: Session) => {
			if (flowRef.current.phase === "saving") return
			release(s)
			if (sameOffsets(s.draft, { start: s.original.startOffset, end: s.original.endOffset })) {
				dispatch({ type: "cancelled" })
				restore(s)
				return
			}
			const saving: Session = { ...s, pointer: undefined }
			dispatch({ type: "sent", session: saving, before: fetcher.data })
			paint(saving, false)
			setStatus(t("highlights.resize.saving", { quote: s.index.selector(s.draft).exact }))
			void fetcher.submit(
				{
					intent: "resize",
					id: s.original.id,
					versionId: s.versionId,
					previous: {
						start: s.original.startOffset,
						end: s.original.endOffset,
						exact: s.original.exact,
					},
					selector: { ...s.index.selector(s.draft) },
				},
				{
					method: "post",
					action: `/documents/${s.documentId}/highlights`,
					encType: "application/json",
				},
			)
		},
		[dispatch, fetcher, paint, release, restore, t],
	)

	// A lost answer (`network`) may hide a save that happened: the refreshed highlights say. Asked
	// when the refresh settles and when the highlights change, whichever comes last.
	const reconcile = useCallback(() => {
		const f = flowRef.current
		if (f.phase !== "failed" || !f.refreshed || f.error !== "network") return
		const attempted = f.attempt
		const confirmed = latest.current.items.find((h) => h.id === attempted.original.id)
		if (
			confirmed &&
			confirmed.versionId === attempted.versionId &&
			confirmed.exact === attempted.index.selector(attempted.draft).exact &&
			sameOffsets(attempted.draft, { start: confirmed.startOffset, end: confirmed.endOffset })
		) {
			dispatch({ type: "settled" })
			setStatus(t("highlights.resize.saved", { quote: confirmed.exact }))
		}
	}, [dispatch, t])
	useEffect(reconcile, [props.items, reconcile])

	useEffect(() => {
		const f = flowRef.current
		if (
			f.phase !== "saving" ||
			fetcher.state !== "idle" ||
			!fetcher.data ||
			fetcher.data === f.before
		)
			return
		const s = f.session
		const result = fetcher.data
		dispatch({ type: "answered", error: result.ok ? null : result.error.code })
		if (result.ok) {
			latest.current.onSaved(result.highlight)
			if (s.position) {
				const pos = mousePosition.current ?? s.position
				const id =
					highlightsAtPoint(latest.current.rangesRef.current, pos.x, pos.y).find(
						(id) => !id.startsWith("tmp-"),
					) ?? null
				hoverRef.current = id
				setHoverId(id)
			}
			paint(s, false)
			const rect = firstRect(s.index.range(s.draft)!)
			if (rect) latest.current.onPosition(s.original.id, rect)
			setStatus(t("highlights.resize.saved", { quote: result.highlight.exact }))
		} else {
			restore(s)
			setStatus(t("highlights.resize.failed"))
			// Neither a retry nor a new resize starts from the highlights the failure may have made
			// stale: the promise settles once they have loaded again.
			const refreshed = () => {
				dispatch({ type: "refreshed", attempt: s })
				reconcile()
			}
			void revalidator.revalidate().then(refreshed, refreshed)
		}
	}, [fetcher.state, fetcher.data, dispatch, paint, reconcile, restore, revalidator, t])

	// Repaint a draft after loader updates, but never carry it into another document/version.
	// Loader changes must repaint the independently owned draft
	useEffect(() => {
		const f = flowRef.current
		const s = sessionOf(f)
		if (!s) return
		const p = latest.current
		if (
			p.documentId !== s.documentId ||
			p.versionId !== s.versionId ||
			!p.items.some((h) => h.id === s.original.id && !h.orphaned && !h.deletedAt)
		) {
			dispatch({ type: "gone" })
			release(s)
			return
		}
		paint(s, f.phase === "pointer")
	}, [props.items, props.documentId, props.versionId, dispatch, paint, release])

	const retry = () => {
		const f = flowRef.current
		const p = latest.current
		if (f.phase !== "failed" || !f.refreshed || revalidator.state !== "idle" || p.mutationPending)
			return
		const s = f.attempt
		const current = p.items.find((h) => h.id === s.original.id)
		if (!current || current.orphaned || p.versionId !== s.versionId) {
			dispatch({ type: "refused", error: "version_changed" })
			return
		}
		if (sameOffsets(s.draft, { start: current.startOffset, end: current.endOffset })) {
			dispatch({ type: "settled" })
			setStatus(t("highlights.resize.saved", { quote: current.exact }))
			return
		}
		if (
			current.startOffset !== s.original.startOffset ||
			current.endOffset !== s.original.endOffset ||
			current.exact !== s.original.exact
		) {
			dispatch({ type: "refused", error: "highlight_changed" })
			return
		}
		send({ ...s, original: current })
	}

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return
			const phase = flowRef.current.phase
			if (phase === "pointer" || phase === "keyboard") {
				event.preventDefault()
				event.stopImmediatePropagation()
				cancel()
			} else if (hoverRef.current || latest.current.toolbarId) dismiss()
		}
		const onClick = (event: MouseEvent) => {
			if (!suppressClick.current) return
			suppressClick.current = false
			event.preventDefault()
			event.stopImmediatePropagation()
		}
		const trackMouse = (event: PointerEvent) => {
			if (event.pointerType === "mouse")
				mousePosition.current = { x: event.clientX, y: event.clientY }
		}
		const onDown = () => {
			suppressClick.current = false
		}
		document.addEventListener("keydown", onKey, true)
		document.addEventListener("click", onClick, true)
		document.addEventListener("pointerdown", onDown, true)
		document.addEventListener("pointermove", trackMouse, true)
		window.addEventListener("blur", cancel)
		return () => {
			document.removeEventListener("keydown", onKey, true)
			document.removeEventListener("click", onClick, true)
			document.removeEventListener("pointerdown", onDown, true)
			document.removeEventListener("pointermove", trackMouse, true)
			window.removeEventListener("blur", cancel)
		}
	}, [cancel, dismiss])
	useEffect(
		() => () => {
			clearTimeout(hoverTimer.current)
			const s = sessionOf(flowRef.current)
			flowRef.current = IDLE
			if (s) release(s)
		},
		[release],
	)

	const pointerDown = (
		event: React.PointerEvent<HTMLButtonElement>,
		item: Highlight,
		endpoint: Endpoint,
	) => {
		if (event.pointerType !== "mouse" || event.button !== 0) return
		event.preventDefault()
		event.stopPropagation()
		const s = begin(item, endpoint, "pointer")
		if (!s) return
		const rect = endpointRect(s.index, s.draft, endpoint)
		if (!rect) {
			cancel()
			return
		}
		s.pointer = {
			id: event.pointerId,
			control: event.currentTarget,
			x: event.clientX,
			y: event.clientY,
			dx: event.clientX - rect.x,
			dy: event.clientY - (rect.top + rect.bottom) / 2,
			moved: false,
			originX: event.clientX,
			originY: event.clientY,
		}
		event.currentTarget.setPointerCapture(event.pointerId)
		suppressClick.current = true
		document.documentElement.setAttribute("data-highlight-dragging", "")
		paint(s, true)
		let lastTime = performance.now()
		const tick = (time: number) => {
			const f = flowRef.current
			const current = f.phase === "pointer" ? f.session : null
			if (!current?.pointer) return
			const { x, y, moved } = current.pointer
			const root = current.index.root.getBoundingClientRect()
			const top = latest.current.headerRef.current?.getBoundingClientRect().bottom ?? 60
			const speed =
				y < top + 48
					? -Math.min(600, (top + 48 - y) * 12)
					: y > window.innerHeight - 48
						? Math.min(600, (y - window.innerHeight + 48) * 12)
						: 0
			if (moved && x >= root.left && x <= root.right && speed) {
				window.scrollBy(0, (speed * Math.min(32, time - lastTime)) / 1000)
				resolvePointer(current, x, Math.max(top + 2, Math.min(window.innerHeight - 2, y)))
			}
			lastTime = time
			frame.current = requestAnimationFrame(tick)
		}
		frame.current = requestAnimationFrame(tick)
	}
	const pointerMove = (event: React.PointerEvent) => {
		const f = flowRef.current
		if (f.phase === "pointer" && f.session.pointer?.id === event.pointerId)
			resolvePointer(f.session, event.clientX, event.clientY)
	}
	const pointerUp = (event: React.PointerEvent) => {
		const f = flowRef.current
		if (f.phase !== "pointer" || f.session.pointer?.id !== event.pointerId) return
		const s = f.session
		event.preventDefault()
		resolvePointer(s, event.clientX, event.clientY)
		// lostpointercapture must not cancel the commit.
		s.pointer = undefined
		send(s)
		// Released on the handle (a click, or a drag back to it), the pointer is still there: no
		// pointerenter will come to keep the handles up.
		hover(pointerInside(event.currentTarget, event) ? s.original.id : null)
	}
	const keyDown = (event: React.KeyboardEvent, item: Highlight, endpoint: Endpoint) => {
		event.stopPropagation()
		const f = flowRef.current
		const s = f.phase === "keyboard" ? f.session : null
		if (event.key === "Tab") {
			if (s) cancel()
			return
		}
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault()
			if (s && event.key === "Enter") send(s)
			else if (!sessionOf(f)) begin(item, endpoint, "keyboard")
		} else if (s && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
			event.preventDefault()
			move(s, stepBoundary(s.index, s.draft[endpoint], event.key === "ArrowLeft" ? -1 : 1))
			setStatus(t("highlights.resize.quote", { quote: s.index.selector(s.draft).exact }))
		}
	}
	const session = sessionOf(flow)
	const state = session ? (flow.phase as "pointer" | "keyboard" | "saving") : "idle"
	const ownerId = session?.original.id ?? props.toolbarId ?? hoverId
	const item = props.items.find(
		(h) =>
			h.id === ownerId &&
			!h.orphaned &&
			!h.id.startsWith("tmp-") &&
			h.versionId === props.versionId,
	)
	return {
		session,
		guard,
		item: props.editingId ? undefined : item,
		hover,
		dismiss,
		pointerDown,
		pointerMove,
		pointerUp,
		cancel,
		keyDown,
		failure: flow.phase === "failed" ? flow.error : null,
		retry,
		status,
		refreshing: revalidator.state !== "idle" || (flow.phase === "failed" && !flow.refreshed),
		blocked: (id: string) => sessionOf(flowRef.current)?.original.id === id,
		state,
	}
}
