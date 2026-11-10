/**
 * Where a highlight's resize is: the one place `useHighlightResize` keeps it. `S` is the session
 * (the draft, the text index, the pointer), which this file never looks into: `transition` is the
 * whole flow, tested on its own.
 */
export type ResizeFlow<S> =
	| { phase: "idle" }
	/** Dragging a handle with the mouse, or moving it with the arrow keys. */
	| { phase: "pointer" | "keyboard"; session: S }
	/** The draft sent; `before` is the fetcher's answer before it, so an old one is not taken for this one's. */
	| { phase: "saving"; session: S; before: unknown }
	/**
	 * The save was refused, or its answer lost: `error` says which. The highlights load again first
	 * (`refreshed`); until then neither a retry nor a new resize can start from them.
	 */
	| { phase: "failed"; attempt: S; error: string; refreshed: boolean }

export type ResizeEvent<S> =
	| { type: "begin"; mode: "pointer" | "keyboard"; session: S }
	/** The draft moved, or the pointer did. */
	| { type: "moved"; session: S }
	/** Escape, blur, a lost pointer, or a commit that changed nothing. */
	| { type: "cancelled" }
	| { type: "sent"; session: S; before: unknown }
	| { type: "answered"; error: string | null }
	/** The highlights loaded again after `attempt` failed. */
	| { type: "refreshed"; attempt: S }
	/** A retry found the highlight changed since: it is not sent. */
	| { type: "refused"; error: string }
	/** The failed attempt turned out to be saved after all, or there is nothing left to retry. */
	| { type: "settled" }
	/** The document, its version or the highlight went away under the session. */
	| { type: "gone" }

export const IDLE = { phase: "idle" } as const

/** Whether a resize can start: not during another, and not before a failure's refresh. */
export const canBegin = <S>(flow: ResizeFlow<S>) =>
	flow.phase === "idle" || (flow.phase === "failed" && flow.refreshed)

/** The session being edited (dragged, moved or saved), if any. */
export const sessionOf = <S>(flow: ResizeFlow<S>): S | null =>
	flow.phase === "idle" || flow.phase === "failed" ? null : flow.session

/** The flow after `event`. The same object when the event changes nothing. */
export function transition<S>(flow: ResizeFlow<S>, event: ResizeEvent<S>): ResizeFlow<S> {
	switch (event.type) {
		case "begin":
			return canBegin(flow) ? { phase: event.mode, session: event.session } : flow
		case "moved":
			return flow.phase === "pointer" || flow.phase === "keyboard"
				? { phase: flow.phase, session: event.session }
				: flow
		case "cancelled":
			return flow.phase === "pointer" || flow.phase === "keyboard" ? IDLE : flow
		case "sent":
			return flow.phase === "pointer" ||
				flow.phase === "keyboard" ||
				(flow.phase === "failed" && flow.refreshed)
				? { phase: "saving", session: event.session, before: event.before }
				: flow
		case "answered":
			if (flow.phase !== "saving") return flow
			return event.error === null
				? IDLE
				: { phase: "failed", attempt: flow.session, error: event.error, refreshed: false }
		case "refreshed":
			return flow.phase === "failed" && flow.attempt === event.attempt && !flow.refreshed
				? { ...flow, refreshed: true }
				: flow
		case "refused":
			return flow.phase === "failed" ? { ...flow, error: event.error } : flow
		case "settled":
			return flow.phase === "failed" ? IDLE : flow
		case "gone":
			return sessionOf(flow) ? IDLE : flow
	}
}
