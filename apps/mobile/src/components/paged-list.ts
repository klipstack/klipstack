import { useFocusEffect } from "expo-router"
import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { AppState } from "react-native"
import { onChange, settled } from "@/lib/article-changes"
import { errorMessage } from "@/lib/i18n"
import { canUseOffline, OFFLINE_NOTE } from "@/lib/offline"
import {
	type Page,
	type PagedList,
	type PagedListEvent,
	pagedListStart,
	pagedListTransition,
} from "@/lib/paged-list-machine"

/**
 * A list loaded a page at a time (`fetchPage`, which changes when what it asks for does): the
 * next page near the end (`loadMore`), and a reload on each return to the screen and to the app,
 * as the share extension or the reader may have changed it. A reload asks for as many as are
 * shown, so the list keeps its length and the reader their place. `edit` changes what is shown at
 * once, as an action does; a load on its way, which answers for before it, is dropped. A load waits
 * for changes on their way from a closing reader, and runs again when one lands (`article-changes`).
 * `max`: the most items one request returns (the API's `limit` at most).
 *
 * `offline`, for a list kept for offline reading (src/lib/offline.ts): `loaded` gets each load's
 * items, to keep, and `kept` gives them back when a load can't reach the server and the list
 * shows nothing yet. Keep it from changing on each render, as `fetchPage`.
 *
 * What it shows and what is on its way are in `paged-list-machine.ts`; this hook runs the requests
 * and feeds their answers back.
 */
export function usePagedList<T extends { id: string }>(
	fetchPage: ((limit: number, cursor?: string) => Promise<Page<T>>) | null,
	pageSize: number,
	max = 100,
	offline?: { loaded: (items: T[]) => void; kept: () => T[] | null },
) {
	const [state, setState] = useState<PagedList<T>>(pagedListStart)
	// Read and changed through the ref: answers and scroll events arrive between renders.
	const machine = useRef(state)
	useLayoutEffect(() => {
		machine.current = state
	}, [state])
	/** False when the event changed nothing (a stale answer, a next page already on its way). */
	const send = useCallback((event: PagedListEvent<T>) => {
		const next = pagedListTransition(machine.current, event)
		if (next === machine.current) return false
		machine.current = next
		setState(next)
		return true
	}, [])
	// Asking for something else (a filter, a search): the list starts over, empty until it loads.
	// (Wrapped: `useState` would call a function.)
	const [asked, setAsked] = useState(() => fetchPage)
	if (fetchPage !== asked) {
		setAsked(() => fetchPage)
		setState((now) => pagedListTransition(now, { type: "asked" }))
	}

	const load = useCallback(async () => {
		if (!fetchPage) return
		send({ type: "load" })
		const { ticket } = machine.current
		try {
			await settled()
			const shown = machine.current.items?.length ?? 0
			const page = await fetchPage(Math.min(max, Math.max(pageSize, shown)))
			if (send({ type: "loaded", ticket, page })) offline?.loaded(page.items)
		} catch (e) {
			if (offline && canUseOffline(e))
				send({ type: "loadFailed", ticket, message: OFFLINE_NOTE, kept: offline.kept() })
			else send({ type: "loadFailed", ticket, message: errorMessage(e) })
		}
	}, [fetchPage, pageSize, max, offline, send])

	/** The next page, near the end of the list; `retry`, by Try Again after it failed. */
	async function loadMore(retry = false) {
		if (!fetchPage || !send({ type: retry ? "retryMore" : "more" })) return
		const { ticket, next } = machine.current
		try {
			const page = await fetchPage(pageSize, next ?? undefined)
			send({ type: "moreLoaded", ticket, page })
		} catch (e) {
			send({ type: "moreFailed", ticket, message: errorMessage(e) })
		}
	}

	useFocusEffect(
		useCallback(() => {
			void load()
			const sub = AppState.addEventListener("change", (appState) => {
				if (appState === "active") void load()
			})
			const off = onChange(() => void load())
			return () => {
				sub.remove()
				off()
			}
		}, [load]),
	)

	const edit = useCallback(
		(change: (shown: T[]) => T[]) => void send({ type: "edited", change }),
		[send],
	)

	async function refresh() {
		send({ type: "refreshing", on: true })
		await load()
		send({ type: "refreshing", on: false })
	}

	const { items, error, refreshing } = state
	const loadingMore = state.more.status === "loading"
	const moreFailed = state.more.status === "failed"
	return {
		items,
		error,
		refreshing,
		loadingMore,
		moreFailed,
		load,
		loadMore: () => loadMore(),
		retryMore: () => loadMore(true),
		refresh,
		edit,
	}
}
