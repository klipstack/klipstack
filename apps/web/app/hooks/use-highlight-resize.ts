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
	firstRect,
	highlightsAtPoint,
	replaceHighlightRange,
	setActiveHighlight,
} from "~/lib/highlights.client"
import type { WebResult } from "~/lib/web-result"

interface Session {
	mode: "pointer" | "keyboard" | "saving"
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
	const sessionRef = useRef<Session | null>(null)
	const [session, setSession] = useState<Session | null>(null)
	const guard = useRef(false)
	const suppressClick = useRef(false)
	const mousePosition = useRef<{ x: number; y: number } | null>(null)
	const [hoverId, setHoverId] = useState<string | null>(null)
	const hoverRef = useRef<string | null>(null)
	const dismissed = useRef<string | null>(null)
	const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const frame = useRef(0)
	const retryRef = useRef<Session | null>(null)
	const [failure, setFailure] = useState<string | null>(null)
	const [status, setStatus] = useState("")
	const busyResponse = useRef<unknown>(null)
	const needsRefresh = useRef(false)

	const publish = useCallback((next: Session | null) => {
		sessionRef.current = next
		guard.current = next !== null
		setSession(next)
	}, [])
	const paint = useCallback((s: Session, offsets = s.draft) => {
		const p = latest.current
		const range = s.index.range(offsets)
		if (!range || !s.index.root.isConnected) return
		replaceHighlightRange(
			p.rangesRef.current,
			p.items.find((h) => h.id === s.original.id) ?? s.original,
			range,
			s.mode === "pointer",
		)
		if (s.mode === "pointer") setActiveHighlight(null)
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
			const restored = { ...s, mode: "keyboard" as const }
			paint(restored, { start: item.startOffset, end: item.endOffset })
			const range = p.rangesRef.current.get(item.id)
			const rect = range && firstRect(range)
			if (rect) p.onPosition(item.id, rect)
		},
		[paint],
	)
	const cancel = useCallback(() => {
		const s = sessionRef.current
		if (!s || s.mode === "saving") return
		// Clear ownership before releasing capture: lostpointercapture is also a cancellation.
		publish(null)
		release(s)
		restore(s)
		setStatus(t("highlights.resize.cancelled"))
	}, [publish, release, restore, t])
	const hover = useCallback((id: string | null) => {
		clearTimeout(hoverTimer.current)
		if (sessionRef.current) return
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
			sessionRef.current ||
			p.mutationPending ||
			needsRefresh.current ||
			p.editingId ||
			!root ||
			item.orphaned ||
			item.id.startsWith("tmp-") ||
			item.versionId !== p.versionId
		)
			return null
		const s: Session = {
			mode,
			documentId: p.documentId,
			versionId: item.versionId,
			original: item,
			draft: { start: item.startOffset, end: item.endOffset },
			endpoint,
			index: textIndex(root),
		}
		clearTimeout(hoverTimer.current)
		setFailure(null)
		retryRef.current = null
		guard.current = true
		window.getSelection()?.removeAllRanges()
		publish(s)
		return s
	}
	const move = useCallback(
		(s: Session, value: number) => {
			const draft = moveBoundary(s.index, s.draft, s.endpoint, value)
			if (draft === s.draft) return
			s.draft = draft
			paint(s)
			publish({ ...s })
		},
		[paint, publish],
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
			if (sessionRef.current?.mode === "saving") return
			release(s)
			if (sameOffsets(s.draft, { start: s.original.startOffset, end: s.original.endOffset })) {
				publish(null)
				restore(s)
				return
			}
			const saving: Session = { ...s, mode: "saving", pointer: undefined }
			publish(saving)
			paint(saving)
			busyResponse.current = fetcher.data
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
		[fetcher, paint, publish, release, restore, t],
	)

	useEffect(() => {
		const s = sessionRef.current
		if (
			s?.mode !== "saving" ||
			fetcher.state !== "idle" ||
			!fetcher.data ||
			fetcher.data === busyResponse.current
		)
			return
		const result = fetcher.data
		publish(null)
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
			const saved = { ...s, mode: "keyboard" as const }
			paint(saved)
			const rect = firstRect(s.index.range(s.draft)!)
			if (rect) latest.current.onPosition(s.original.id, rect)
			setStatus(t("highlights.resize.saved", { quote: result.highlight.exact }))
			retryRef.current = null
			setFailure(null)
		} else {
			restore(s)
			const error = result.error.code
			setFailure(error)
			setStatus(t("highlights.resize.failed"))
			retryRef.current = s
			needsRefresh.current = true
			void revalidator.revalidate()
		}
	}, [fetcher.state, fetcher.data, paint, publish, restore, revalidator, t])

	// Repaint a draft after loader updates, but never carry it into another document/version.
	// Loader changes must repaint the independently owned draft
	useEffect(() => {
		const s = sessionRef.current
		if (!s) return
		const p = latest.current
		if (
			p.documentId !== s.documentId ||
			p.versionId !== s.versionId ||
			!p.items.some((h) => h.id === s.original.id && !h.orphaned && !h.deletedAt)
		) {
			publish(null)
			release(s)
			setFailure(null)
			retryRef.current = null
			return
		}
		paint(s)
	}, [props.items, props.documentId, props.versionId, paint, publish, release])

	useEffect(() => {
		if (revalidator.state !== "idle") return
		needsRefresh.current = false
		const attempted = retryRef.current
		if (failure !== "network" || !attempted) return
		const confirmed = props.items.find((h) => h.id === attempted.original.id)
		if (
			confirmed &&
			confirmed.versionId === attempted.versionId &&
			confirmed.exact === attempted.index.selector(attempted.draft).exact &&
			sameOffsets(attempted.draft, { start: confirmed.startOffset, end: confirmed.endOffset })
		) {
			retryRef.current = null
			setFailure(null)
			setStatus(t("highlights.resize.saved", { quote: confirmed.exact }))
		}
	}, [revalidator.state, props.items, failure, t])
	const retry = () => {
		const s = retryRef.current
		const p = latest.current
		if (!s || needsRefresh.current || revalidator.state !== "idle" || p.mutationPending) return
		const current = p.items.find((h) => h.id === s.original.id)
		if (!current || current.orphaned || p.versionId !== s.versionId) {
			setFailure("version_changed")
			return
		}
		if (sameOffsets(s.draft, { start: current.startOffset, end: current.endOffset })) {
			setFailure(null)
			retryRef.current = null
			setStatus(t("highlights.resize.saved", { quote: current.exact }))
			return
		}
		if (
			current.startOffset !== s.original.startOffset ||
			current.endOffset !== s.original.endOffset ||
			current.exact !== s.original.exact
		) {
			setFailure("highlight_changed")
			return
		}
		setFailure(null)
		send({ ...s, original: current, mode: "keyboard" })
	}

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return
			if (sessionRef.current && sessionRef.current.mode !== "saving") {
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
			const s = sessionRef.current
			sessionRef.current = null
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
		paint(s)
		let lastTime = performance.now()
		const tick = (time: number) => {
			const current = sessionRef.current
			if (current?.mode !== "pointer" || !current.pointer) return
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
		const s = sessionRef.current
		if (s?.mode === "pointer" && s.pointer?.id === event.pointerId)
			resolvePointer(s, event.clientX, event.clientY)
	}
	const pointerUp = (event: React.PointerEvent) => {
		const s = sessionRef.current
		if (s?.mode !== "pointer" || s.pointer?.id !== event.pointerId) return
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
		const s = sessionRef.current
		if (event.key === "Tab") {
			if (s?.mode === "keyboard") cancel()
			return
		}
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault()
			if (s?.mode === "keyboard" && event.key === "Enter") send(s)
			else if (!s) begin(item, endpoint, "keyboard")
		} else if (s?.mode === "keyboard" && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
			event.preventDefault()
			move(s, stepBoundary(s.index, s.draft[endpoint], event.key === "ArrowLeft" ? -1 : 1))
			setStatus(t("highlights.resize.quote", { quote: s.index.selector(s.draft).exact }))
		}
	}
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
		failure,
		retry,
		status,
		refreshing: revalidator.state !== "idle",
		blocked: (id: string) => sessionRef.current?.original.id === id,
		state: session?.mode ?? "idle",
	}
}
