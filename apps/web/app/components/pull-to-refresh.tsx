import { Loader2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useRevalidator } from "react-router"

const THRESHOLD = 64
const MAX = 96

/** Where the gesture is: at rest, following the finger (`height`), or refreshing. */
export type Pull =
	| { phase: "idle" }
	| { phase: "pulling"; height: number }
	| { phase: "refreshing" }
export type PullEvent =
	/** The finger moved `dy` down from where it touched (up when negative). */
	| { type: "moved"; dy: number }
	| { type: "released" }
	/** The refresh is done and has been shown long enough. */
	| { type: "settled" }

export const IDLE: Pull = { phase: "idle" }

/** The gesture after `event`. The same object when the event changes nothing. */
export function transition(pull: Pull, event: PullEvent): Pull {
	if (pull.phase === "refreshing") return event.type === "settled" ? IDLE : pull
	switch (event.type) {
		case "moved":
			if (event.dy <= 0) return pull.phase === "idle" ? pull : IDLE
			// Resistance: the indicator grows slower than the finger moves.
			return { phase: "pulling", height: Math.min(MAX, event.dy * 0.5) }
		case "released":
			if (pull.phase !== "pulling") return pull
			return pull.height >= THRESHOLD ? { phase: "refreshing" } : IDLE
		case "settled":
			return pull
	}
}

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
	// The ref for the touch handlers, the state for rendering.
	const pullRef = useRef<Pull>(IDLE)
	const [pull, setPull] = useState<Pull>(IDLE)
	const start = useRef<number | null>(null)

	useEffect(() => {
		const el = scrollRef.current
		if (!el) return
		const dispatch = (event: PullEvent) => {
			const before = pullRef.current
			const next = transition(before, event)
			if (next === before) return
			pullRef.current = next
			setPull(next)
			if (next.phase === "refreshing") void revalidate()
		}
		const onStart = (e: TouchEvent) => {
			if (el.scrollTop > 0 || pullRef.current.phase === "refreshing") return
			start.current = e.touches[0]?.clientY ?? null
		}
		const onMove = (e: TouchEvent) => {
			if (start.current === null || el.scrollTop > 0) return
			dispatch({ type: "moved", dy: (e.touches[0]?.clientY ?? 0) - start.current })
		}
		const onEnd = () => {
			if (start.current === null) return
			start.current = null
			dispatch({ type: "released" })
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
	}, [scrollRef, revalidate])

	// Once the refresh settles, hold the spinner a beat so it reads as "done", then collapse.
	const refreshing = pull.phase === "refreshing"
	useEffect(() => {
		if (!refreshing || state !== "idle") return
		const id = window.setTimeout(() => {
			pullRef.current = transition(pullRef.current, { type: "settled" })
			setPull(pullRef.current)
		}, 350)
		return () => window.clearTimeout(id)
	}, [refreshing, state])

	const height = refreshing ? THRESHOLD : pull.phase === "pulling" ? pull.height : 0
	return (
		<>
			<div
				aria-hidden={height === 0}
				data-testid="pull-to-refresh"
				data-state={refreshing ? "refreshing" : height >= THRESHOLD ? "ready" : "idle"}
				className="flex items-end justify-center overflow-hidden text-muted-fg"
				style={{
					height,
					// The indicator follows the finger without a transition.
					transition: pull.phase === "pulling" ? undefined : "height 200ms ease-out",
				}}
			>
				<Loader2
					className="mb-3 size-5"
					style={{
						transform: refreshing ? undefined : `rotate(${(height / THRESHOLD) * 360}deg)`,
						animation: refreshing ? "spin 1s linear infinite" : undefined,
						opacity: Math.min(1, height / THRESHOLD),
					}}
					aria-hidden
				/>
			</div>
			{children}
		</>
	)
}
