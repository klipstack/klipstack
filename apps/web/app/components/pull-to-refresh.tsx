import { Loader2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useRevalidator } from "react-router"

const THRESHOLD = 64
const MAX = 96

/**
 * Pull down at the top of the scroll container to refresh the current view. Touch only; the
 * container must be the element that scrolls (the phone layout's content area).
 */
export function PullToRefresh({
	scrollRef,
	children,
}: {
	scrollRef: React.RefObject<HTMLDivElement | null>
	children: React.ReactNode
}) {
	const { revalidate, state } = useRevalidator()
	const [pull, setPull] = useState(0)
	const [refreshing, setRefreshing] = useState(false)
	const start = useRef<number | null>(null)
	const pulling = useRef(false)
	// The same flag for rendering: the indicator follows the finger without a transition.
	const [dragging, setDragging] = useState(false)

	useEffect(() => {
		const el = scrollRef.current
		if (!el) return
		const onStart = (e: TouchEvent) => {
			if (el.scrollTop > 0 || refreshing) return
			start.current = e.touches[0]?.clientY ?? null
			pulling.current = false
			setDragging(false)
		}
		const onMove = (e: TouchEvent) => {
			if (start.current === null || el.scrollTop > 0) return
			const dy = (e.touches[0]?.clientY ?? 0) - start.current
			if (dy <= 0) {
				if (pulling.current) setPull(0)
				pulling.current = false
				setDragging(false)
				return
			}
			pulling.current = true
			setDragging(true)
			// resistance: the indicator grows slower than the finger moves
			setPull(Math.min(MAX, dy * 0.5))
		}
		const onEnd = () => {
			if (start.current === null) return
			start.current = null
			if (!pulling.current) return
			pulling.current = false
			setDragging(false)
			setPull((current) => {
				if (current >= THRESHOLD) {
					setRefreshing(true)
					void revalidate()
					return THRESHOLD
				}
				return 0
			})
		}
		el.addEventListener("touchstart", onStart, { passive: true })
		el.addEventListener("touchmove", onMove, { passive: true })
		el.addEventListener("touchend", onEnd)
		el.addEventListener("touchcancel", onEnd)
		return () => {
			el.removeEventListener("touchstart", onStart)
			el.removeEventListener("touchmove", onMove)
			el.removeEventListener("touchend", onEnd)
			el.removeEventListener("touchcancel", onEnd)
		}
	}, [scrollRef, revalidate, refreshing])

	// Once the refresh settles, hold the spinner a beat so it reads as "done", then collapse.
	useEffect(() => {
		if (!refreshing || state !== "idle") return
		const id = window.setTimeout(() => {
			setRefreshing(false)
			setPull(0)
		}, 350)
		return () => window.clearTimeout(id)
	}, [refreshing, state])

	const height = refreshing ? THRESHOLD : pull
	return (
		<>
			<div
				aria-hidden={height === 0}
				data-testid="pull-to-refresh"
				data-state={refreshing ? "refreshing" : pull >= THRESHOLD ? "ready" : "idle"}
				className="flex items-end justify-center overflow-hidden text-muted-fg"
				style={{
					height,
					transition: dragging ? undefined : "height 200ms ease-out",
				}}
			>
				<Loader2
					className="mb-3 size-5"
					style={{
						transform: refreshing ? undefined : `rotate(${(pull / THRESHOLD) * 360}deg)`,
						animation: refreshing ? "spin 1s linear infinite" : undefined,
						opacity: Math.min(1, pull / THRESHOLD),
					}}
					aria-hidden
				/>
			</div>
			{children}
		</>
	)
}
