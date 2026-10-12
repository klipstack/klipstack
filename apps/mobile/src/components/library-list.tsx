import { TRASH_RETENTION_DAYS } from "@klipstack/api-contract/names"
import { SEARCH_LIMIT_MAX } from "@klipstack/api-contract/search-query"
import { type ArticleSummary, KlipstackApiError } from "@klipstack/sdk"
import { Stack, useFocusEffect } from "expo-router"
import { useCallback, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native"
import { useArticleActions } from "@/components/article-actions"
import { ArticleList, type CardMenu, useImageHeaders } from "@/components/article-card"
import { LayoutButton } from "@/components/list-layout"
import { useMultiSelect } from "@/components/multi-select"
import { usePagedList } from "@/components/paged-list"
import { SELECTION_BAR_SPACE, SelectionBar } from "@/components/selection-bar"
import { HeaderButtons, HeaderTextButton, SaveLinkButton } from "@/components/tab-stack"
import { useTagSheet } from "@/components/tag-sheet"
import { topicHeaderItem, topicOf, useTopicChoice } from "@/components/topic-choice"
import { retagged } from "@/lib/article-tags"
import { useAuth } from "@/lib/auth"
import { actedOn, bulkActions, bulkNotice, type LibraryView, stillShown } from "@/lib/bulk-actions"
import { chosenTopic, type TopicsInList, topicStillThere } from "@/lib/library-topics"
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
 *
 * Inbox, Starred and Archive narrow to one of the reader's topics, or to No topic, as on the web:
 * the header's filter menu, only for a reader with topics. The line above the list says what the
 * topic holds. Each list keeps its choice while the app runs (`useTopicChoice`); a topic that
 * ended shows every topic again, and says so.
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
	const filterable = view === "inbox" || view === "starred" || view === "archive" ? view : null
	const [topic, setTopic] = useTopicChoice(filterable)
	const [gone, setGone] = useState(false)
	const choose = useCallback(
		(next: string | null) => {
			setGone(false)
			setTopic(next)
		},
		[setTopic],
	)
	const ended = useCallback(() => {
		setGone(true)
		setTopic(null)
	}, [setTopic])
	// The reader's topics with what each holds of this list: none while topics are off.
	const [topics, setTopics] = useState<TopicsInList | null>(null)
	const loadTopics = useCallback(() => {
		if (!client || !filterable) return
		client.topics
			.list({ view: filterable })
			.then((answer) => {
				const next = { items: answer.items, none: answer.none ?? 0, sorting: answer.sorting ?? 0 }
				setTopics(next)
				const chosen = topicOf(filterable)
				if (chosen && !topicStillThere(next, chosen)) ended()
			})
			.catch(() => {})
	}, [client, filterable, ended])
	useFocusEffect(loadTopics)

	const fetchPage = useMemo(() => {
		if (!client) return null
		if (view) {
			return async (limit: number, cursor?: string) => {
				try {
					return await client.articles.list({
						view,
						sort: "newest",
						limit,
						cursor,
						topic: topic ?? undefined,
					})
				} catch (e) {
					// The topic ended, or topics were turned off, since the list loaded them.
					if (topic && e instanceof KlipstackApiError && e.code === "not_found") ended()
					throw e
				}
			}
		}
		// A search pages by offset: the cursor is the next one.
		return async (limit: number, cursor?: string) => {
			const page = await client.articles.search(query, { limit, offset: Number(cursor ?? 0) })
			return { items: page.items, nextCursor: page.nextOffset?.toString() ?? null }
		}
	}, [client, view, query, topic, ended])
	// Inbox and Starred are kept for offline reading, as on the web (src/lib/offline.ts); one topic's
	// share of them is not the list to keep.
	const offline = useMemo(() => {
		if (!client || (view !== "inbox" && view !== "starred") || topic) return undefined
		return {
			loaded: (items: ArticleSummary[]) => {
				saveList(view, items)
				void downloadAhead(client, view, items)
			},
			kept: () => loadList(view),
		}
	}, [client, view, topic])
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
			: gone
				? "That topic ended, so this shows every topic."
				: null
	const shown = topics && topic ? chosenTopic(topics, topic) : null
	const topicMenu = filterable && topics?.items.length ? topics : null
	const buttons = (
		<HeaderButtons>
			{items?.length ? <HeaderTextButton label="Select" onPress={() => start()} /> : null}
			<LayoutButton />
			{canSave ? <SaveLinkButton /> : null}
		</HeaderButtons>
	)
	return (
		<>
			<Stack.Screen
				options={
					select.header
						? { ...select.header, unstable_headerRightItems: undefined }
						: {
								// The back button, after Select All.
								headerLeft: undefined,
								headerRight: () => buttons,
								// With topics, the topic menu first: a native menu, which only these items can hold.
								unstable_headerRightItems: topicMenu
									? () => [
											topicHeaderItem(topicMenu, topic, choose, colors.accent),
											{ type: "custom", element: buttons, hidesSharedBackground: true },
										]
									: undefined,
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
				refreshControl={
					<RefreshControl
						refreshing={list.refreshing}
						onRefresh={() => {
							loadTopics()
							void list.refresh()
						}}
					/>
				}
				onEndReached={list.loadMore}
				onEndReachedThreshold={0.5}
				ListHeaderComponent={
					<>
						{shown ? (
							<View style={styles.topic}>
								<Text style={[styles.topicName, { color: colors.fg }]}>{shown.name}</Text>
								<Text style={[styles.topicText, { color: colors.mutedFg }]}>
									{shown.description}
								</Text>
								<Pressable accessibilityRole="button" hitSlop={8} onPress={() => choose(null)}>
									{({ pressed }) => (
										<Text
											style={[
												styles.topicText,
												{ color: colors.accent },
												pressed && styles.pressed,
											]}
										>
											Show every topic
										</Text>
									)}
								</Pressable>
							</View>
						) : null}
						{error && items ? (
							<Text style={[styles.banner, { color: colors.mutedFg }]}>{error}</Text>
						) : note && (items?.length || gone) ? (
							<Text style={[styles.banner, { color: colors.mutedFg }]}>{note}</Text>
						) : null}
					</>
				}
				ListFooterComponent={
					list.loadingMore ? <ActivityIndicator style={styles.more} color={colors.mutedFg} /> : null
				}
				ListEmptyComponent={
					<Text style={[styles.empty, { color: colors.mutedFg }]}>
						{error ?? (items ? (topic ? "No articles in this topic here." : empty) : "Loading…")}
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
	topic: { paddingTop: 4, paddingBottom: 12, gap: 4 },
	topicName: { fontSize: 17, fontWeight: "600" },
	topicText: { fontSize: 15, lineHeight: 20 },
	pressed: { opacity: 0.5 },
})
