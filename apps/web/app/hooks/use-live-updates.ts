import { useEffect } from "react"
import { useRevalidator } from "react-router"

/** The documents the live refresh starting now is about; null when it is about everything. */
let refreshScope: ReadonlySet<string> | null = null

/**
 * Whether the refresh React Router is starting comes from live events about other documents than
 * this one (for a route's `shouldRevalidate`). Routes decide while the refresh starts; a later
 * refresh counts as one about everything.
 */
export function liveRefreshSkips(documentId: string | undefined) {
	return refreshScope !== null && (!documentId || !refreshScope.has(documentId))
}

/** Starts a refresh about `documents` (null: about everything). */
export function refreshAbout(documents: ReadonlySet<string> | null, revalidate: () => unknown) {
	refreshScope = documents
	void revalidate()
	refreshScope = null
}

/**
 * Keeps the current view fresh: a server-sent event stream announces document changes (saves
 * from the extension, extraction finishing…) and the page refreshes its data; on becoming
 * visible again it refreshes once to cover anything missed while the stream was suspended.
 */
export function useLiveUpdates(enabled: boolean) {
	const { revalidate } = useRevalidator()
	useEffect(() => {
		if (!enabled || typeof EventSource === "undefined") return
		let timer: number | undefined
		let documents = new Set<string>()
		let everything = false
		const refresh = (documentId?: string) => {
			if (documentId) documents.add(documentId)
			window.clearTimeout(timer)
			timer = window.setTimeout(() => {
				refreshAbout(everything ? null : documents, revalidate)
				documents = new Set()
				everything = false
			}, 250)
		}
		const onDocument = (event: MessageEvent<string>) => {
			try {
				const { documentId } = JSON.parse(event.data) as { documentId?: unknown }
				if (typeof documentId === "string") return refresh(documentId)
			} catch {
				// no payload: about any document
			}
			everything = true
			refresh()
		}
		const source = new EventSource("/api/events")
		source.addEventListener("document", onDocument)
		source.addEventListener("feed", () => refresh())
		const onVisible = () => {
			if (document.visibilityState !== "visible") return
			everything = true
			refresh()
		}
		document.addEventListener("visibilitychange", onVisible)
		return () => {
			source.close()
			document.removeEventListener("visibilitychange", onVisible)
			window.clearTimeout(timer)
		}
	}, [enabled, revalidate])
}
