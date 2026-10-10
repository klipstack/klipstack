import { TRASH_RETENTION_DAYS } from "@klipstack/api-contract/names"
import { SEARCH_LIMIT_MAX } from "@klipstack/api-contract/search-query"
import type { ArticleSummary } from "@klipstack/sdk"
import { Stack } from "expo-router"
import { useMemo } from "react"
import { ActivityIndicator, RefreshControl, StyleSheet, Text } from "react-native"
import { useArticleActions } from "@/components/article-actions"
import { ArticleList, type CardMenu, useImageHeaders } from "@/components/article-card"
import { LayoutButton } from "@/components/list-layout"
import { useMultiSelect } from "@/components/multi-select"
import { usePagedList } from "@/components/paged-list"
import { SELECTION_BAR_SPACE, SelectionBar } from "@/components/selection-bar"
import { HeaderButtons, HeaderTextButton, SaveLinkButton } from "@/components/tab-stack"
import { useTagSheet } from "@/components/tag-sheet"
import { retagged } from "@/lib/article-tags"
import { useAuth } from "@/lib/auth"
import { actedOn, bulkActions, bulkNotice, type LibraryView, stillShown } from "@/lib/bulk-actions"
import { loadList, saveList } from "@/lib/offline"
import { downloadAhead } from "@/lib/offline-download"
import { useColors } from "@/lib/theme"

const PAGE_SIZE = 30

/**
 * A place in the Library tab: a view of the library (`view`), newest saves first, 30 at a time,
 * or a search (`query`: a tag, a saved search) in the order the server gives, the next page
 * loading near the end. It reloads on each return to it and to the app (`usePagedList`). The
 * header has Select, the switch between the grid and rows and, where a new save shows
 * (`canSave`), the + button; on the left, the way back to the Library's places.
 *
 * Select is the web's multi-select on a phone (`useMultiSelect`). Articles an action moves out of
 * this list leave it, and the selection, at once (`stillShown`); the server's answer confirms
 * them. A long press on one article opens its menu, whose actions go the same way. The trash says
 * how long it keeps articles, and its articles can only be restored.
 */
export function LibraryList({
	view,
	query,
	empty,
	canSave = false,
}: ({ view: LibraryView; query?: never } | { query: string; view?: never }) & {
	empty: string
	canSave?: boolean
}) {
	const { state } = useAuth()
	const colors = useColors()
	const client = state.status === "signed-in" ? state.client : null
	const headers = useImageHeaders()
	const fetchPage = useMemo(() => {
		if (!client) return null
		if (view) {
			return (limit: number, cursor?: string) =>
				client.articles.list({ view, sort: "newest", limit, cursor })
		}
		// A search pages by offset: the cursor is the next one.
		return async (limit: number, cursor?: string) => {
			const page = await client.articles.search(query, { limit, offset: Number(cursor ?? 0) })
			return { items: page.items, nextCursor: page.nextOffset?.toString() ?? null }
		}
	}, [client, view, query])
	// Inbox and Starred are kept for offline reading, as on the web (src/lib/offline.ts).
	const offline = useMemo(() => {
		if (!client || (view !== "inbox" && view !== "starred")) return undefined
		return {
			loaded: (items: ArticleSummary[]) => {
				saveList(view, items)
				void downloadAhead(client, view, items)
			},
			kept: () => loadList(view),
		}
	}, [client, view])
	const list = usePagedList(fetchPage, PAGE_SIZE, view ? undefined : SEARCH_LIMIT_MAX, offline)
	const { items, error, edit, load } = list
	const select = useMultiSelect(items)

	const act = useArticleActions({
		client,
		apply: (changed) => edit((shown) => replaced(shown, changed, view ? { view } : { query })),
		done: (action, count, conflicts) => {
			if (select.selecting) select.say(bulkNotice(action, count, conflicts))
		},
		reload: () => void load(),
	})
	const tags = useTagSheet(client, (changed) =>
		edit((shown) => shown.map((a) => retagged(a, changed))),
	)
	const start = select.start
	const openTags = tags.open
	const menu = useMemo<CardMenu>(
		() => ({
			act: (item, action) => act(action, [item]),
			tag: (item) => openTags([item]),
			select: start,
		}),
		[act, openTags, start],
	)

	const note =
		view === "trash"
			? `Articles in the trash are deleted permanently after ${TRASH_RETENTION_DAYS} days.`
			: null
	return (
		<>
			<Stack.Screen
				options={
					select.header ?? {
						// The back button, after Select All.
						headerLeft: undefined,
						headerRight: () => (
							<HeaderButtons>
								{items?.length ? <HeaderTextButton label="Select" onPress={() => start()} /> : null}
								<LayoutButton />
								{canSave ? <SaveLinkButton /> : null}
							</HeaderButtons>
						),
					}
				}
			/>
			<ArticleList
				headers={headers}
				selection={select.selection}
				menu={menu}
				contentContainerStyle={
					select.selecting ? { paddingBottom: SELECTION_BAR_SPACE } : undefined
				}
				data={items ?? []}
				refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} />}
				onEndReached={list.loadMore}
				onEndReachedThreshold={0.5}
				ListHeaderComponent={
					error && items ? (
						<Text style={[styles.banner, { color: colors.mutedFg }]}>{error}</Text>
					) : note && items?.length ? (
						<Text style={[styles.banner, { color: colors.mutedFg }]}>{note}</Text>
					) : null
				}
				ListFooterComponent={
					list.loadingMore ? <ActivityIndicator style={styles.more} color={colors.mutedFg} /> : null
				}
				ListEmptyComponent={
					<Text style={[styles.empty, { color: colors.mutedFg }]}>
						{error ?? (items ? empty : "Loading…")}
					</Text>
				}
			/>
			{select.selecting ? (
				<SelectionBar
					count={select.cards.length}
					notice={select.notice}
					choice={bulkActions(select.cards)}
					onAction={(action) =>
						action === "tag" ? tags.open(actedOn(select.cards, action)) : act(action, select.cards)
					}
					colors={colors}
				/>
			) : null}
			{tags.sheet}
		</>
	)
}

/** The list with some articles changed; those that left it are gone. */
function replaced(
	shown: ArticleSummary[],
	changed: Map<string, ArticleSummary>,
	list: Parameters<typeof stillShown>[0],
): ArticleSummary[] {
	return shown.flatMap((a) => {
		const now = changed.get(a.id)
		if (!now) return [a]
		return stillShown(list, a, now) ? [now] : []
	})
}

const styles = StyleSheet.create({
	empty: { padding: 32, textAlign: "center", fontSize: 16 },
	// In line with the articles: the list has their margin already.
	banner: { paddingVertical: 10, fontSize: 14 },
	more: { paddingVertical: 20 },
})
