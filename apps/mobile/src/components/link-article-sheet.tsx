import type { ArticleSummary } from "@klipstack/sdk"
import { SymbolView } from "expo-symbols"
import { useEffect, useState } from "react"
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native"
import type { Colors } from "@/lib/theme"

/** Waits this long after the last keystroke before searching, as the web's link menu does. */
const DEBOUNCE_MS = 150

/**
 * Picks an article to link from a note: the web's `[[` menu as a sheet. Empty, it lists recent
 * articles; typing searches the library (`GET /search`). The article being read is left out.
 */
export function LinkArticleSheet({
	visible,
	onClose,
	onPick,
	onDismissed,
	search,
	recent,
	exclude,
	colors,
}: {
	visible: boolean
	onClose: () => void
	onPick: (article: ArticleSummary) => void
	/** After the sheet is gone, however it was closed. */
	onDismissed: () => void
	search: (q: string) => Promise<ArticleSummary[]>
	recent: () => Promise<ArticleSummary[]>
	exclude: string
	colors: Colors
}) {
	const [query, setQuery] = useState("")
	// The answer for one query: shown only while that is still the query.
	const [answer, setAnswer] = useState<{
		q: string
		items: ArticleSummary[] | null
		error: string | null
	} | null>(null)
	const q = query.trim()
	const current = answer?.q === q ? answer : null

	useEffect(() => {
		if (!visible) return
		let live = true
		const timer = setTimeout(
			async () => {
				try {
					const items = await (q ? search(q) : recent())
					if (live) setAnswer({ q, items, error: null })
				} catch (e) {
					if (live) setAnswer({ q, items: null, error: e instanceof Error ? e.message : String(e) })
				}
			},
			q ? DEBOUNCE_MS : 0,
		)
		return () => {
			live = false
			clearTimeout(timer)
		}
	}, [visible, q, search, recent])

	const items = (current?.items ?? []).filter((a) => a.id !== exclude).slice(0, q ? 20 : 8)
	const hint = current?.error ?? (current ? (q ? "No articles match." : null) : "Searching…")

	return (
		<Modal
			visible={visible}
			presentationStyle="pageSheet"
			animationType="slide"
			onRequestClose={onClose}
			onDismiss={() => {
				setQuery("")
				onDismissed()
			}}
		>
			<View style={[styles.sheet, { backgroundColor: colors.bg }]}>
				<View style={styles.bar}>
					<Pressable
						accessibilityRole="button"
						onPress={onClose}
						hitSlop={12}
						style={styles.cancel}
					>
						<Text style={[styles.cancelText, { color: colors.accent }]}>Cancel</Text>
					</Pressable>
					<Text style={[styles.title, { color: colors.fg }]}>Link Article</Text>
				</View>
				<View style={[styles.field, { backgroundColor: colors.muted }]}>
					<SymbolView name="magnifyingglass" tintColor={colors.mutedFg} size={17} />
					<TextInput
						accessibilityLabel="Search your library"
						value={query}
						onChangeText={setQuery}
						autoFocus
						autoCapitalize="none"
						autoCorrect={false}
						clearButtonMode="while-editing"
						returnKeyType="search"
						placeholder="Search your library"
						placeholderTextColor={colors.mutedFg}
						style={[styles.input, { color: colors.fg }]}
					/>
				</View>
				<FlatList
					data={items}
					keyExtractor={(a) => a.id}
					keyboardShouldPersistTaps="handled"
					keyboardDismissMode="on-drag"
					automaticallyAdjustKeyboardInsets
					ListHeaderComponent={
						!q && items.length ? (
							<Text style={[styles.label, { color: colors.mutedFg }]}>RECENT</Text>
						) : null
					}
					ListEmptyComponent={
						hint ? <Text style={[styles.hint, { color: colors.mutedFg }]}>{hint}</Text> : null
					}
					renderItem={({ item }) => (
						<Pressable
							accessibilityRole="button"
							onPress={() => onPick(item)}
							style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.muted }]}
						>
							<Text style={[styles.rowTitle, { color: colors.fg }]} numberOfLines={2}>
								{item.title ?? item.url}
							</Text>
							<Text style={[styles.rowMeta, { color: colors.mutedFg }]} numberOfLines={1}>
								{[item.site ?? hostOf(item.url), item.location === "archive" ? "Archived" : null]
									.filter(Boolean)
									.join(" · ")}
							</Text>
						</Pressable>
					)}
				/>
			</View>
		</Modal>
	)
}

function hostOf(url: string): string {
	try {
		return new URL(url).host
	} catch {
		return url
	}
}

const styles = StyleSheet.create({
	sheet: { flex: 1 },
	bar: { height: 56, alignItems: "center", justifyContent: "center" },
	title: { fontSize: 17, fontWeight: "600" },
	cancel: { position: "absolute", left: 16 },
	cancelText: { fontSize: 17 },
	field: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		marginHorizontal: 16,
		marginBottom: 8,
		paddingHorizontal: 10,
		borderRadius: 10,
		height: 38,
	},
	input: { flex: 1, fontSize: 17, height: 38 },
	label: {
		fontSize: 13,
		fontWeight: "500",
		letterSpacing: 0.4,
		paddingHorizontal: 16,
		paddingTop: 12,
		paddingBottom: 4,
	},
	hint: { padding: 32, textAlign: "center", fontSize: 16, lineHeight: 22 },
	row: { paddingHorizontal: 16, paddingVertical: 10, gap: 2 },
	rowTitle: { fontSize: 17, lineHeight: 22 },
	rowMeta: { fontSize: 14 },
})
