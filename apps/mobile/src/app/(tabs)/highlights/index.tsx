import { HIGHLIGHT_COLORS, type HighlightFilter } from "@klipstack/api-contract/enums"
import type { Highlight } from "@klipstack/sdk"
import { Stack } from "expo-router"
import { useEffect, useMemo, useState } from "react"
import {
	ActivityIndicator,
	Alert,
	FlatList,
	RefreshControl,
	StyleSheet,
	Text,
	View,
} from "react-native"
import { HighlightRow } from "@/components/highlight-row"
import { COLOR_NAMES } from "@/components/highlighter-nibs"
import { usePagedList } from "@/components/paged-list"
import { useAuth } from "@/lib/auth"
import { useColors } from "@/lib/theme"

const PAGE_SIZE = 50
/** Waits this long after the last keystroke before searching. */
const DEBOUNCE_MS = 300

/**
 * Every highlight, newest first, as the web's highlights page streams them (`GET /highlights`),
 * 50 at a time. A tap opens the article at the highlight; a long press, the highlight's menu. It
 * reloads on each return to the tab and to the app, as reading adds highlights. As on the web, a
 * filter keeps those with a note or of one color (the menu at the top right), and the search field
 * finds words in the quote, the note, or the article's title, author or site (`q`).
 */
export default function Highlights() {
	const { state } = useAuth()
	const colors = useColors()
	const client = state.status === "signed-in" ? state.client : null
	const [filter, setFilter] = useState<HighlightFilter | null>(null)
	const [typed, setTyped] = useState("")
	const [q, setQ] = useState("")
	useEffect(() => {
		const timer = setTimeout(() => setQ(typed.trim()), DEBOUNCE_MS)
		return () => clearTimeout(timer)
	}, [typed])
	const fetchPage = useMemo(
		() =>
			client &&
			((limit: number, cursor?: string) =>
				client.highlights.list({ limit, cursor, filter: filter ?? undefined, q: q || undefined })),
		[client, filter, q],
	)
	const list = usePagedList(fetchPage, PAGE_SIZE)
	const { items, error, edit, load } = list

	// Gone at once; back with a reload when the server refused. Its note goes with it: ask first.
	function remove(highlight: Highlight) {
		if (!client) return
		const go = async () => {
			edit((shown) => shown.filter((h) => h.id !== highlight.id))
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
	}

	const narrowed = filter !== null || q !== ""
	return (
		<>
			<Stack.Screen
				options={{
					headerSearchBarOptions: {
						placeholder: "Search highlights",
						autoCapitalize: "none",
						hideNavigationBar: false,
						onChangeText: (event) => setTyped(event.nativeEvent.text),
					},
				}}
			/>
			<Stack.Toolbar placement="right">
				<Stack.Toolbar.Menu
					icon={
						filter ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"
					}
					accessibilityLabel="Filter"
					tintColor={colors.accent}
				>
					<Stack.Toolbar.MenuAction isOn={filter === null} onPress={() => setFilter(null)}>
						All Highlights
					</Stack.Toolbar.MenuAction>
					<Stack.Toolbar.MenuAction
						icon="note.text"
						isOn={filter === "notes"}
						onPress={() => setFilter("notes")}
					>
						With Notes
					</Stack.Toolbar.MenuAction>
					<Stack.Toolbar.Menu inline>
						{HIGHLIGHT_COLORS.map((color) => (
							<Stack.Toolbar.MenuAction
								key={color}
								isOn={filter === color}
								onPress={() => setFilter(color)}
							>
								{COLOR_NAMES[color]}
							</Stack.Toolbar.MenuAction>
						))}
					</Stack.Toolbar.Menu>
				</Stack.Toolbar.Menu>
			</Stack.Toolbar>
			<FlatList
				data={items ?? []}
				keyExtractor={(h) => h.id}
				contentInsetAdjustmentBehavior="automatic"
				style={{ backgroundColor: colors.bg }}
				contentContainerStyle={styles.list}
				renderItem={({ item }) => (
					<HighlightRow highlight={item} colors={colors} onDelete={remove} />
				)}
				ItemSeparatorComponent={() => (
					<View style={[styles.separator, { backgroundColor: colors.divider }]} />
				)}
				refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} />}
				onEndReached={list.loadMore}
				onEndReachedThreshold={0.5}
				ListHeaderComponent={
					error && items ? (
						<Text style={[styles.banner, { color: colors.mutedFg }]}>{error}</Text>
					) : null
				}
				ListFooterComponent={
					list.loadingMore ? <ActivityIndicator style={styles.more} color={colors.mutedFg} /> : null
				}
				ListEmptyComponent={
					<Text style={[styles.empty, { color: colors.mutedFg }]}>
						{error ??
							(!items
								? "Loading…"
								: narrowed
									? "No highlights match."
									: "No highlights yet. Select text while reading to highlight it.")}
					</Text>
				}
				keyboardDismissMode="on-drag"
			/>
		</>
	)
}

const GAP = 16

const styles = StyleSheet.create({
	list: { paddingHorizontal: GAP, paddingBottom: 32 },
	// A full point, from edge to edge, as the library's rows.
	separator: { height: 1, marginHorizontal: -GAP },
	empty: { padding: 32, textAlign: "center", fontSize: 16, lineHeight: 22 },
	banner: { paddingVertical: 10, fontSize: 14 },
	more: { paddingVertical: 20 },
})
