import { endState, secondsToFinish } from "@klipstack/api-contract/reading"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useBlocker } from "react-router"
import { BULK_ACTION } from "~/lib/bulk-actions"
import { showToast } from "~/lib/toast"
import type { BulkDone } from "~/routes/documents.bulk"

/** The longest the way out waits for the finish; it lands on its own after that. */
const LEAVE_WAIT_MS = 1500

/**
 * Finishing on the way out. Once the end of the article came into view (`reached`), after long
 * enough on the page for what was left to read, leaving the reader finishes the article: a
 * navigation waits for it, then the page it lands on shows "Finished" with an undo; closing the tab
 * sends it as a beacon. `keep` turns it off for this visit (also for leaving after a delete or
 * "mark unread"); `finish` finishes now and leaves, the same way.
 */
export function useFinishOnLeave({
	documentId,
	ready,
	finished,
	archived,
	readingMinutes,
	openedAt,
	leave,
}: {
	documentId: string
	ready: boolean
	finished: boolean
	archived: boolean
	readingMinutes: number | null
	/** The position the reader opened at, 0–1. */
	openedAt: number
	/** Back where the reader came from. */
	leave: () => void
}) {
	const { t } = useTranslation("reader")
	const { t: tl } = useTranslation("library")
	const [reachedEnd, setReachedEnd] = useState(false)
	const [kept, setKept] = useState(false)
	// Seconds with the page in view, counted until they are enough.
	const [needed] = useState(() => secondsToFinish(readingMinutes, openedAt))
	const [seconds, setSeconds] = useState(0)
	useEffect(() => {
		if (!ready || seconds >= needed) return
		const id = window.setInterval(() => {
			if (document.visibilityState === "visible") setSeconds((s) => s + 1)
		}, 1000)
		return () => window.clearInterval(id)
	}, [ready, seconds, needed])

	const state = endState({ finished, reachedEnd, seconds, needed, kept })
	const armed = useRef(false)
	useLayoutEffect(() => {
		armed.current = state === "finishing"
	})

	// Finishes the article and shows the toast with its undo: the toast host outlives the reader.
	const finishNow = useCallback(async () => {
		armed.current = false
		const body = new FormData()
		body.set("intent", "finish")
		body.set("ids", documentId)
		const res = await fetch(BULK_ACTION, { method: "POST", body, keepalive: true })
		const done = (await res.json()) as BulkDone & { ok: boolean }
		if (!done.ok || done.changed.length === 0) return
		showToast({
			message: archived ? t("end.toastFinished") : t("end.toastArchived"),
			undo: done.undo
				? {
						action: BULK_ACTION,
						intent: done.undo.intent,
						fields: done.undo.fields,
						label: tl("toast.undo"),
					}
				: undefined,
		})
	}, [documentId, archived, t, tl])

	const blocker = useBlocker(
		({ currentLocation, nextLocation }) =>
			armed.current && currentLocation.pathname !== nextLocation.pathname,
	)
	useEffect(() => {
		if (blocker.state !== "blocked") return
		let gone = false
		const go = () => {
			if (gone) return
			gone = true
			blocker.proceed()
		}
		// Offline, or refused: leave anyway; the article stays as it was.
		void finishNow()
			.catch(() => {})
			.finally(go)
		const timer = window.setTimeout(go, LEAVE_WAIT_MS)
		return () => window.clearTimeout(timer)
	}, [blocker, finishNow])

	// Closing the tab (or the phone's browser) leaves too. No toast: there is no page to show it.
	useEffect(() => {
		const onHide = () => {
			if (!armed.current) return
			armed.current = false
			const body = new FormData()
			body.set("intent", "finish")
			navigator.sendBeacon(`/documents/${documentId}/state`, body)
		}
		window.addEventListener("pagehide", onHide)
		return () => window.removeEventListener("pagehide", onHide)
	}, [documentId])

	return {
		state,
		reached: () => setReachedEnd(true),
		keep: setKept,
		/** "Mark as finished": now, then back, with the same toast. */
		finish: () => {
			void finishNow()
				.catch(() => {})
				.finally(leave)
		},
	}
}
