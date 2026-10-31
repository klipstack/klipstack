import { canSaveSearch } from "@klipstack/api-contract/search-query"
import type { ArticleSummary, SavedSearch, Topic } from "@klipstack/sdk"
import { Stack, useFocusEffect } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import type { SearchBarCommands } from "react-native-screens"
import { AccountButton } from "@/components/account-button"
import { useArticleActions } from "@/components/article-actions"
import { ArticleList, type CardMenu, useImageHeaders } from "@/components/article-card"
import { LayoutButton } from "@/components/list-layout"
import { useMultiSelect } from "@/components/multi-select"
import { PlaceButton, PlaceGroup } from "@/components/place-list"
import { saveSearch, savedSearchSheet } from "@/components/saved-search-actions"
import { SearchAnnotations } from "@/components/search-annotations"
import { SELECTION_BAR_SPACE, SelectionBar } from "@/components/selection-bar"
import { HeaderButtons, HeaderTextButton } from "@/components/tab-stack"
import { useTagSheet } from "@/components/tag-sheet"
import { retagged } from "@/lib/article-tags"
import { useAuth } from "@/lib/auth"
import { actedOn, bulkActions, bulkNotice } from "@/lib/bulk-actions"
import { errorMessage, t } from "@/lib/i18n"
import { searchHint, topicQuery } from "@/lib/library-topics"
import { useColors } from "@/lib/theme"

/** Waits this long after the last keystroke before searching. */
const DEBOUNCE_MS = 300

/**
 * Full-text search of the library, as the web's (`GET /search`: words and operators such as
 * `is:starred` or `site:`). The field sits in the header; on iOS 26 the search tab puts it in the
 * tab bar. A long press on a result opens its menu, and Select checks several, as in the library
 * (`useMultiSelect`). While selecting, the selection bar takes the tab bar's place, and the field's.
 * Results in the trash (`in:trash`) can only be restored, and not with others, as on the web.
 *
 * A reader with topics finds them under the empty field, as Mail suggests searches: one searches
 * `topic:` and its name.
 *
 * Highlights and notes with the words show too, as on the web, in groups of their own
 * (`SearchAnnotations`). They come before the articles, not after as on the web: under a page of
 * articles a phone would hide them.
 */
export default function Search() {
	const { state } = useAuth()
	const colors = useColors()
	const client = state.status === "signed-in" ? state.client : null
	const headers = useImageHeaders()
	const [query, setQuery] = useState("")
	// Searches again, after an action failed.
	const [attempt, setAttempt] = useState(0)
	// The answer for one query: shown only while that is still the query.
	const [answer, setAnswer] = useState<{
		q: string
		items: ArticleSummary[] | null
		error: string | null
	} | null>(null)
	const q = query.trim()
	const current = answer?.q === q ? answer : null
	const items = current?.items ?? null
	const error = current?.error ?? null

	useEffect(() => {
		if (!client || !q) return
		let live = true
		const timer = setTimeout(async () => {
			try {
				const page = await client.articles.search(q, { limit: 50 })
				if (live) setAnswer({ q, items: page.items, error: null })
			} catch (e) {
				if (live) setAnswer({ q, items: null, error: errorMessage(e) })
			}
		}, DEBOUNCE_MS)
		return () => {
			live = false
			clearTimeout(timer)
		}
	}, [client, q, attempt])

	const select = useMultiSelect(items)
	// A result keeps its place whatever the action (the query may still match it); one deleted goes.
	const act = useArticleActions({
		client,
		apply: (changed) =>
			setAnswer((shown) =>
				shown?.items
					? {
							...shown,
							items: shown.items.flatMap((a) => {
								const now = changed.get(a.id)
								if (!now) return [a]
								return now.trashedAt && !a.trashedAt ? [] : [now]
							}),
						}
					: shown,
			),
		done: (action, count, conflicts) => {
			// A delete says so in its toast, with the undo.
			if (select.selecting && action !== "delete") select.say(bulkNotice(action, count, conflicts))
		},
		reload: () => setAttempt((n) => n + 1),
	})
	const tags = useTagSheet(client, (changed) =>
		setAnswer((shown) =>
			shown?.items ? { ...shown, items: shown.items.map((a) => retagged(a, changed)) } : shown,
		),
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

	// The saved searches, to show whether this query is one (the same text, as on the web): loaded
	// on each return here, and after a change.
	const [saved, setSaved] = useState<SavedSearch[]>([])
	const loadSaved = useCallback(() => {
		client?.savedSearches
			.list()
			.then((answer) => setSaved(answer.items))
			.catch(() => {})
	}, [client])
	useFocusEffect(loadSaved)
	const savedAs = saved.find((s) => s.query === q) ?? null

	// The reader's topics, most articles first: none while topics are off.
	const [topics, setTopics] = useState<Topic[]>([])
	const loadTopics = useCallback(() => {
		client?.topics
			.list()
			.then((answer) => setTopics(answer.items))
			.catch(() => {})
	}, [client])
	useFocusEffect(loadTopics)
	const field = useRef<SearchBarCommands>(null)
	const searchFor = (text: string) => {
		field.current?.setText(text)
		setQuery(text)
	}

	const hint = !q
		? searchHint(topics.length > 0)
		: items
			? t("library.empty.noMatch")
			: t("library.search.searching")

	return (
		<>
			<Stack.Screen
				options={{
					headerSearchBarOptions: {
						ref: field,
						placeholder: t("library.search.placeholder"),
						autoCapitalize: "none",
						// The header stays while searching: it has Select.
						hideNavigationBar: false,
						onChangeText: (event) => setQuery(event.nativeEvent.text),
					},
					...(select.header ?? {
						headerLeft: () => <AccountButton />,
						headerRight: () => (
							<HeaderButtons>
								{items?.length ? (
									<HeaderTextButton label={t("library.header.select")} onPress={() => start()} />
								) : null}
								{client && canSaveSearch(q) ? (
									<SaveSearchButton
										saved={savedAs}
										onPress={() =>
											savedAs
												? savedSearchSheet(client, savedAs, loadSaved)
												: saveSearch(client, q, loadSaved)
										}
									/>
								) : null}
								<LayoutButton />
							</HeaderButtons>
						),
					}),
				}}
			/>
			<ArticleList
				headers={headers}
				keyboardDismissMode="on-drag"
				data={items ?? []}
				selection={select.selection}
				menu={menu}
				ListHeaderComponent={
					client && q && !select.selecting ? (
						<SearchAnnotations client={client} q={q} colors={colors} />
					) : undefined
				}
				contentContainerStyle={
					select.selecting ? { paddingBottom: SELECTION_BAR_SPACE } : undefined
				}
				ListEmptyComponent={
					!q && topics.length > 0 ? (
						<View style={styles.suggestions}>
							<Text style={[styles.hint, styles.hintAbove, { color: colors.mutedFg }]}>{hint}</Text>
							<PlaceGroup title={t("library.places.topics")} colors={colors}>
								{topics.map((topic) => (
									<PlaceButton
										key={topic.id}
										title={topic.name}
										icon="square.stack.3d.up"
										detail={String(topic.articles)}
										label={`${topic.name}, ${t("library.articles", { count: topic.articles })}`}
										onPress={() => searchFor(topicQuery(topic.name))}
										colors={colors}
									/>
								))}
							</PlaceGroup>
						</View>
					) : (
						<Text style={[styles.hint, { color: colors.mutedFg }]}>{error ?? hint}</Text>
					)
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

/**
 * Saves the query, as the web's bookmark button: filled when the query is saved already, and then
 * it renames or deletes that saved search.
 */
function SaveSearchButton({ saved, onPress }: { saved: SavedSearch | null; onPress: () => void }) {
	const colors = useColors()
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={
				saved
					? t("library.savedSearches.savedAsLabel", { name: saved.name })
					: t("library.savedSearches.save")
			}
			hitSlop={8}
			onPress={onPress}
		>
			<SymbolView name={saved ? "bookmark.fill" : "bookmark"} tintColor={colors.accent} size={22} />
		</Pressable>
	)
}

const styles = StyleSheet.create({
	hint: { padding: 32, textAlign: "center", fontSize: 16, lineHeight: 22 },
	hintAbove: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },
	suggestions: { paddingBottom: 32 },
})
