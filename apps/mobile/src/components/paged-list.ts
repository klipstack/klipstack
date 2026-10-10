import { useFocusEffect } from "expo-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { AppState } from "react-native"
import { onChange, settled } from "@/lib/article-changes"
import { canUseOffline, OFFLINE_NOTE } from "@/lib/offline"

type Page<T> = { items: T[]; nextCursor: string | null }

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
 */
export function usePagedList<T extends { id: string }>(
	fetchPage: ((limit: number, cursor?: string) => Promise<Page<T>>) | null,
	pageSize: number,
	max = 100,
	offline?: { loaded: (items: T[]) => void; kept: () => T[] | null },
) {
	const [items, setItems] = useState<T[] | null>(null)
	const [next, setNext] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [refreshing, setRefreshing] = useState(false)
	const [loadingMore, setLoadingMore] = useState(false)
	// An answer older than the latest load is dropped.
	const generation = useRef(0)
	// Asking for something else (a filter, a search): the list starts over, empty until it loads.
	// (Wrapped: `useState` would call a function.)
	const [asked, setAsked] = useState(() => fetchPage)
	if (fetchPage !== asked) {
		setAsked(() => fetchPage)
		setItems(null)
		setNext(null)
		setError(null)
	}

	const shown = useRef(0)
	useEffect(() => {
		shown.current = items?.length ?? 0
	}, [items])
	const load = useCallback(async () => {
		if (!fetchPage) return
		const mine = ++generation.current
		try {
			await settled()
			const page = await fetchPage(Math.min(max, Math.max(pageSize, shown.current)))
			if (mine !== generation.current) return
			setItems(page.items)
			setNext(page.nextCursor)
			setError(null)
			offline?.loaded(page.items)
		} catch (e) {
			if (mine !== generation.current) return
			if (offline && canUseOffline(e)) {
				const kept = offline.kept()
				if (kept) setItems((shown) => shown ?? kept)
				setError(OFFLINE_NOTE)
				return
			}
			setError(e instanceof Error ? e.message : String(e))
		}
	}, [fetchPage, pageSize, max, offline])

	async function loadMore() {
		if (!fetchPage || !next || loadingMore) return
		const mine = generation.current
		setLoadingMore(true)
		try {
			const page = await fetchPage(pageSize, next)
			if (mine !== generation.current) return
			setItems((shown) => {
				const seen = new Set(shown?.map((a) => a.id))
				return [...(shown ?? []), ...page.items.filter((a) => !seen.has(a.id))]
			})
			setNext(page.nextCursor)
		} catch (e) {
			if (mine === generation.current) setError(e instanceof Error ? e.message : String(e))
		} finally {
			setLoadingMore(false)
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

	const edit = useCallback((change: (shown: T[]) => T[]) => {
		generation.current++
		setItems((shown) => shown && change(shown))
	}, [])

	async function refresh() {
		setRefreshing(true)
		await load()
		setRefreshing(false)
	}

	return { items, error, refreshing, loadingMore, load, loadMore, refresh, edit }
}
