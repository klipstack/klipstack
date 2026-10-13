import {
	HIGHLIGHT_COLORS,
	type NotebookFilter,
	type NotebookView,
} from "@klipstack/api-contract/enums"
import type { Highlight } from "@klipstack/sdk"
import { router, Stack } from "expo-router"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
	ActivityIndicator,
	Alert,
	FlatList,
	Pressable,
	RefreshControl,
	StyleSheet,
	Text,
	View,
} from "react-native"
import { useImageHeaders } from "@/components/article-card"
import type { NoteLinking } from "@/components/note-field"
import {
	ArticleSection,
	BlankPostIt,
	Card,
	type CardContext,
	TopicSection,
} from "@/components/notebook-cards"
import { usePagedList } from "@/components/paged-list"
import { useAuth } from "@/lib/auth"
import {
	filterLabel,
	newSeed,
	type NotebookRow,
	notebookRows,
	withArticleNote,
	withHighlight,
	withoutHighlight,
} from "@/lib/notebook"
import { useColors } from "@/lib/theme"

/** Articles a By article page holds, and cards a Stream page holds. */
const PAGE_SIZE = { articles: 20, stream: 50 } as const
/** Waits this long after the last keystroke before searching. */
const DEBOUNCE_MS = 300

const VIEWS: {
	view: NotebookView
	label: string
	icon: "rectangle.stack" | "list.bullet" | "square.grid.2x2" | "shuffle"
}[] = [
	{ view: "articles", label: "By Article", icon: "rectangle.stack" },
	{ view: "stream", label: "Stream", icon: "list.bullet" },
	{ view: "topics", label: "By Topic", icon: "square.grid.2x2" },
	{ view: "shuffle", label: "Shuffle", icon: "shuffle" },
]

/** What the answer says besides its rows: the filters' counts, the tags, links' targets. */
type Meta = {
	counts: Record<"all" | NotebookFilter, number>
	tags: { id: string; name: string; count: number }[]
	topicsInUse: boolean
	topic: { id: string | null; name: string | null } | null
	linkTargets: Record<string, "ok" | "trash">
	view: NotebookView
}

/**
 * The Notebook, as the web's (/notebook): everything kept from what was read, the highlights, their
 * notes and the articles' notes. By article (the default) shows each article with its note on a
 * large post-it, written on in place, and its highlights as cards; Stream, By topic and Shuffle show
 * cards, an article's note one of its own. The header's search finds words in quotes and notes; its
 * menus choose the view and narrow to notes, highlights, a color, a tag or a topic. A tap opens the
 * reader at the highlight or the article; a long press, a card's menu. It reloads on each return to
 * the tab and the app, 20 articles or 50 cards at a time.
 */
export default function Notebook() {
	const { state } = useAuth()
	const colors = useColors()
	const headers = useImageHeaders()
	const client = state.status === "signed-in" ? state.client : null
	const [view, setView] = useState<NotebookView>("articles")
	const [filter, setFilter] = useState<NotebookFilter | null>(null)
	const [tag, setTag] = useState<string | null>(null)
	const [topic, setTopic] = useState<string | null>(null)
	const [seed, setSeed] = useState(newSeed)
	const [typed, setTyped] = useState("")
	const [q, setQ] = useState("")
	useEffect(() => {
		const timer = setTimeout(() => setQ(typed.trim()), DEBOUNCE_MS)
		return () => clearTimeout(timer)
	}, [typed])
	const [meta, setMeta] = useState<Meta | null>(null)

	// By topic shows every topic: no topic of its own.
	const narrowTopic = view === "topics" ? null : topic
	const fetchPage = useMemo(
		() =>
			client &&
			(async (limit: number, cursor?: string) => {
				const pages = view === "articles" || view === "stream"
				const answer = await client.notebook.get({
					view,
					q: q || undefined,
					filter: filter ?? undefined,
					tag: tag ?? undefined,
					topic: narrowTopic ?? undefined,
					seed: view === "shuffle" ? seed : undefined,
					limit: pages ? limit : undefined,
					cursor,
				})
				setMeta((shown) => ({
					counts: answer.counts,
					tags: answer.tags,
					topicsInUse: answer.topicsInUse,
					topic: answer.topic,
					view: answer.view,
					// A later page's links join the first's.
					linkTargets: cursor
						? { ...shown?.linkTargets, ...answer.linkTargets }
						: answer.linkTargets,
				}))
				return {
					items: notebookRows(answer),
					// Only By article and Stream page; By topic answers By article while topics are off,
					// and its cursor would be refused with `view=topics`.
					nextCursor: pages && "nextCursor" in answer ? answer.nextCursor : null,
				}
			}),
		[client, view, q, filter, tag, narrowTopic, seed],
	)
	const pageSize = view === "stream" ? PAGE_SIZE.stream : PAGE_SIZE.articles
	const list = usePagedList<NotebookRow>(fetchPage, pageSize, 50)
	const { items, error, edit, load } = list

	// The reader's topics, for the topic menu: only while they are in use.
	const [topics, setTopics] = useState<{ id: string; name: string }[]>([])
	const topicsInUse = meta?.topicsInUse ?? false
	useEffect(() => {
		if (!client || !topicsInUse) return
		let live = true
		client.topics
			.list()
			.then((answer) => live && setTopics(answer.items))
			.catch(() => undefined)
		return () => {
			live = false
		}
	}, [client, topicsInUse])

	// Links in notes: shown as their targets are, open their articles, and are picked from the library.
	const linkTargets = meta?.linkTargets
	const linking = useCallback(
		(articleId: string): NoteLinking => ({
			// An id the answer leaves out is gone.
			status: (id) => linkTargets?.[id] ?? "missing",
			open: (id) => router.push({ pathname: "/read/[id]", params: { id } }),
			search: async (text) =>
				client ? (await client.articles.search(text, { limit: 20 })).items : [],
			recent: async () =>
				client
					? (await client.articles.list({ view: "inbox", sort: "recent", limit: 9 })).items
					: [],
			articleId,
		}),
		[client, linkTargets],
	)

	// Gone at once; back with a reload when the server refused. Its note goes with it: ask first.
	const remove = useCallback(
		(highlight: Highlight) => {
			if (!client) return
			const go = async () => {
				edit((shown) => withoutHighlight(shown, highlight.id))
				try {
					await client.highlights.delete(highlight.id)
				} catch (e) {
					Alert.alert("Not deleted", e instanceof Error ? e.message : String(e))
					void load()
				}
			}
			if (!highlight.note) return void go()
			Alert.alert("Delete this highlight?", "Its note will be deleted too.", [
				{ text: "Cancel", style: "cancel" },
				{ text: "Delete", style: "destructive", onPress: () => void go() },
			])
		},
		[client, edit, load],
	)

	const ctx: CardContext | null = useMemo(
		() =>
			client && {
				client,
				colors,
				headers,
				linking,
				onArticleNote: (articleId, saved) =>
					edit((shown) => withArticleNote(shown, articleId, saved)),
				onHighlightNote: (id, note) =>
					edit((shown) => withHighlight(shown, id, (h) => ({ ...h, note }))),
				onDelete: remove,
			},
		[client, colors, headers, linking, edit, remove],
	)

	function choose(next: NotebookView) {
		if (next === "shuffle") setSeed(newSeed())
		setView(next)
	}

	const shownView = meta?.view ?? view
	const counts = meta?.counts
	const narrowed = filter !== null || tag !== null || narrowTopic !== null || q !== ""
	// Nothing kept at all yet: no search or narrowing could find anything.
	const blank = !narrowed && counts?.all === 0
	const tagName = meta?.tags.find((t) => t.id === tag)?.name ?? null
	const topicName =
		topic === "none"
			? "No Topic"
			: (meta?.topic?.name ?? topics.find((t) => t.id === topic)?.name ?? null)

	const header = (
		<View style={styles.header}>
			{error && items ? (
				<Text style={[styles.banner, { color: colors.mutedFg }]}>{error}</Text>
			) : null}
			{filter !== null || tag !== null || narrowTopic !== null ? (
				<View style={styles.narrowed}>
					<Text style={[styles.narrowedText, { color: colors.mutedFg }]} numberOfLines={1}>
						{[
							filter !== null ? filterLabel(filter) : null,
							tagName ? `Tag: ${tagName}` : null,
							narrowTopic !== null && topicName ? `Topic: ${topicName}` : null,
						]
							.filter(Boolean)
							.join(" · ")}
					</Text>
					<Pressable
						accessibilityRole="button"
						hitSlop={8}
						onPress={() => {
							setFilter(null)
							setTag(null)
							setTopic(null)
						}}
					>
						<Text style={[styles.action, { color: colors.accent }]}>Show All</Text>
					</Pressable>
				</View>
			) : null}
			{shownView === "shuffle" && items?.length ? (
				<View style={styles.shuffle}>
					<Text style={[styles.shuffleTitle, { color: colors.fg }]}>A random handful</Text>
					<Pressable
						accessibilityRole="button"
						onPress={() => setSeed(newSeed())}
						style={[styles.deal, { backgroundColor: colors.accent }]}
					>
						<Text style={[styles.dealText, { color: colors.accentFg }]}>Deal Again</Text>
					</Pressable>
					<Pressable accessibilityRole="button" hitSlop={8} onPress={() => setView("articles")}>
						<Text style={[styles.action, { color: colors.mutedFg }]}>Done</Text>
					</Pressable>
				</View>
			) : null}
		</View>
	)

	return (
		<>
			<Stack.Screen
				options={{
					headerSearchBarOptions: {
						placeholder: "Search quotes and notes",
						autoCapitalize: "none",
						hideNavigationBar: false,
						onChangeText: (event) => setTyped(event.nativeEvent.text),
					},
				}}
			/>
			{blank ? null : (
				<Stack.Toolbar placement="right">
					<Stack.Toolbar.Menu
						icon={VIEWS.find((v) => v.view === shownView)?.icon ?? "rectangle.stack"}
						accessibilityLabel="View"
						tintColor={colors.accent}
					>
						{VIEWS.filter((v) => v.view !== "topics" || topicsInUse).map((v) => (
							<Stack.Toolbar.MenuAction
								key={v.view}
								icon={v.icon}
								isOn={view === v.view}
								onPress={() => choose(v.view)}
							>
								{v.label}
							</Stack.Toolbar.MenuAction>
						))}
					</Stack.Toolbar.Menu>
					<Stack.Toolbar.Menu
						icon={
							filter || tag || narrowTopic
								? "line.3.horizontal.decrease.circle.fill"
								: "line.3.horizontal.decrease.circle"
						}
						accessibilityLabel="Filter"
						tintColor={colors.accent}
					>
						{([null, "notes", "highlights"] as const).map((f) => (
							<Stack.Toolbar.MenuAction
								key={f ?? "all"}
								isOn={filter === f}
								subtitle={counts ? String(counts[f ?? "all"]) : undefined}
								onPress={() => setFilter(f)}
							>
								{filterLabel(f)}
							</Stack.Toolbar.MenuAction>
						))}
						<Stack.Toolbar.Menu inline>
							{HIGHLIGHT_COLORS.filter((c) => filter === c || (counts?.[c] ?? 0) > 0).map((c) => (
								<Stack.Toolbar.MenuAction
									key={c}
									isOn={filter === c}
									subtitle={counts ? String(counts[c]) : undefined}
									onPress={() => setFilter(c)}
								>
									{filterLabel(c)}
								</Stack.Toolbar.MenuAction>
							))}
						</Stack.Toolbar.Menu>
						<Stack.Toolbar.Menu inline>
							{meta?.tags.length || tag ? (
								<Stack.Toolbar.Menu title={tagName ? `Tag: ${tagName}` : "Tag"} icon="tag">
									<Stack.Toolbar.MenuAction isOn={tag === null} onPress={() => setTag(null)}>
										Every Tag
									</Stack.Toolbar.MenuAction>
									{(meta?.tags ?? []).map((t) => (
										<Stack.Toolbar.MenuAction
											key={t.id}
											isOn={tag === t.id}
											subtitle={String(t.count)}
											onPress={() => setTag(t.id)}
										>
											{t.name}
										</Stack.Toolbar.MenuAction>
									))}
								</Stack.Toolbar.Menu>
							) : null}
							{topicsInUse && view !== "topics" ? (
								<Stack.Toolbar.Menu
									title={topicName ? `Topic: ${topicName}` : "Topic"}
									icon="square.grid.2x2"
								>
									<Stack.Toolbar.MenuAction isOn={topic === null} onPress={() => setTopic(null)}>
										Every Topic
									</Stack.Toolbar.MenuAction>
									{topics.map((t) => (
										<Stack.Toolbar.MenuAction
											key={t.id}
											isOn={topic === t.id}
											onPress={() => setTopic(t.id)}
										>
											{t.name}
										</Stack.Toolbar.MenuAction>
									))}
									<Stack.Toolbar.MenuAction
										isOn={topic === "none"}
										onPress={() => setTopic("none")}
									>
										No Topic
									</Stack.Toolbar.MenuAction>
								</Stack.Toolbar.Menu>
							) : null}
						</Stack.Toolbar.Menu>
					</Stack.Toolbar.Menu>
				</Stack.Toolbar>
			)}
			<FlatList
				data={ctx ? (items ?? []) : []}
				keyExtractor={(row) => row.id}
				contentInsetAdjustmentBehavior="automatic"
				automaticallyAdjustKeyboardInsets
				keyboardShouldPersistTaps="handled"
				keyboardDismissMode="on-drag"
				style={{ backgroundColor: colors.bg }}
				contentContainerStyle={styles.list}
				renderItem={({ item: row, index }) =>
					!ctx ? null : row.kind === "article" ? (
						<ArticleSection entry={row.entry} ctx={ctx} />
					) : row.kind === "topic" ? (
						<TopicSection
							group={row.group}
							ctx={ctx}
							onSeeAll={(id) => {
								setTopic(id)
								setView("stream")
							}}
						/>
					) : (
						<Card item={row.item} dealt={shownView === "shuffle" ? index : undefined} ctx={ctx} />
					)
				}
				ItemSeparatorComponent={() => (
					<View
						style={
							shownView === "articles"
								? [styles.rule, { backgroundColor: colors.divider }]
								: shownView === "topics"
									? styles.topicGap
									: styles.cardGap
						}
					/>
				)}
				refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} />}
				onEndReached={list.loadMore}
				onEndReachedThreshold={0.5}
				ListHeaderComponent={header}
				ListFooterComponent={
					list.loadingMore ? <ActivityIndicator style={styles.more} color={colors.mutedFg} /> : null
				}
				ListEmptyComponent={
					blank ? (
						<View style={styles.blank}>
							<BlankPostIt colors={colors} />
							<Text style={[styles.blankTitle, { color: colors.fg }]}>Your notebook is empty</Text>
							<Text style={[styles.blankText, { color: colors.mutedFg }]}>
								Everything you keep from what you read lands here, by article: the passages you
								highlight, and the notes you write on them and on whole articles.
							</Text>
							<Pressable
								accessibilityRole="button"
								onPress={() => router.navigate("/library")}
								style={[styles.deal, styles.open, { backgroundColor: colors.accent }]}
							>
								<Text style={[styles.dealText, { color: colors.accentFg }]}>Open Your Library</Text>
							</Pressable>
						</View>
					) : (
						<Text style={[styles.empty, { color: colors.mutedFg }]}>
							{error ??
								(!items ? "Loading…" : q ? "Nothing matches that search." : "Nothing here.")}
						</Text>
					)
				}
			/>
		</>
	)
}

const GAP = 16

const styles = StyleSheet.create({
	list: { paddingHorizontal: GAP, paddingBottom: 48 },
	header: { paddingBottom: 12, gap: 12 },
	banner: { paddingTop: 10, fontSize: 14 },
	narrowed: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 4 },
	narrowedText: { flex: 1, fontSize: 15 },
	action: { fontSize: 15, fontWeight: "500" },
	shuffle: { flexDirection: "row", alignItems: "center", gap: 16, paddingTop: 4 },
	shuffleTitle: { flex: 1, fontFamily: "Iowan Old Style", fontStyle: "italic", fontSize: 20 },
	deal: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
	dealText: { fontSize: 15, fontWeight: "500" },
	// Between articles: a full point, from edge to edge, with room.
	rule: { height: 1, marginHorizontal: -GAP, marginVertical: 32 },
	cardGap: { height: 20 },
	topicGap: { height: 40 },
	empty: { padding: 32, textAlign: "center", fontSize: 16, lineHeight: 22 },
	more: { paddingVertical: 20 },
	blank: { alignItems: "center", gap: 12, paddingTop: 48, paddingHorizontal: 24 },
	blankTitle: { marginTop: 16, fontSize: 18, fontWeight: "600" },
	blankText: { fontSize: 15, lineHeight: 21, textAlign: "center" },
	open: { marginTop: 8, paddingHorizontal: 18, paddingVertical: 10 },
})
