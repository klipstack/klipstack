import type { KlipstackClient, NoteReminder } from "@klipstack/sdk"
import { router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { showToast } from "@/lib/article-changes"
import { finishedLabel } from "@/lib/note-reminders"
import type { Colors } from "@/lib/theme"

/**
 * Home's gentle question about articles finished lately without a note, as on the web: each opens
 * in the reader with its notes (its note and highlights) to write in, or speak; "Nothing to add"
 * leaves one out for good, with undo; "Not now" puts the card off for a week.
 */
export function NoteReminders({
	items,
	client,
	onSkip,
	onUnskip,
	onLater,
	colors,
}: {
	items: NoteReminder[]
	client: KlipstackClient
	/** Taken off the card at once; `onUnskip` puts it back. */
	onSkip: (id: string) => void
	onUnskip: (item: NoteReminder) => void
	onLater: () => void
	colors: Colors
}) {
	if (!items.length) return null
	const skip = (item: NoteReminder) => {
		onSkip(item.article.id)
		client.articles.skipNote(item.article.id).then(
			() =>
				showToast({
					message: "It won't be asked about again.",
					action: {
						label: "Undo",
						run: () => {
							onUnskip(item)
							void client.articles.unskipNote(item.article.id).catch(() => {})
						},
					},
				}),
			() => {
				onUnskip(item)
				showToast({ message: "Couldn't save that. Try again." })
			},
		)
	}
	return (
		<View style={[styles.card, { backgroundColor: colors.muted }]}>
			<Text style={[styles.title, { color: colors.fg }]}>Anything to keep from these?</Text>
			<Text style={[styles.description, { color: colors.mutedFg }]}>
				You finished these without a note. A line on what you take from each helps it stay with you.
				Nothing to add is fine too.
			</Text>
			{items.map((item) => (
				<View key={item.article.id} style={[styles.item, { borderTopColor: colors.border }]}>
					<Pressable
						accessibilityRole="button"
						accessibilityHint="Opens it with its notes, to write one"
						onPress={() =>
							router.push({
								pathname: "/read/[id]",
								params: { id: item.article.id, notes: "1" },
							})
						}
						style={({ pressed }) => [styles.grow, pressed && styles.pressed]}
					>
						<Text style={[styles.articleTitle, { color: colors.fg }]} numberOfLines={2}>
							{item.article.title ?? item.article.site ?? item.article.url}
						</Text>
						<View style={styles.meta}>
							{item.listened ? (
								<SymbolView
									name="headphones"
									tintColor={colors.mutedFg}
									size={13}
									accessibilityElementsHidden
								/>
							) : null}
							<Text style={[styles.metaText, { color: colors.mutedFg }]} numberOfLines={1}>
								{finishedLabel(item)}
							</Text>
						</View>
						{item.highlights[0] ? (
							<Text
								style={[styles.quote, { color: colors.fg, borderLeftColor: colors.border }]}
								numberOfLines={2}
							>
								{item.highlights[0].quote}
							</Text>
						) : null}
						<View style={styles.write}>
							<SymbolView
								name="square.and.pencil"
								tintColor={colors.accent}
								size={15}
								accessibilityElementsHidden
							/>
							<Text style={[styles.action, { color: colors.accent }]}>Write a note</Text>
						</View>
					</Pressable>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`Nothing to add on ${item.article.title ?? "this article"}`}
						onPress={() => skip(item)}
						hitSlop={8}
						style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
					>
						<Text style={[styles.action, { color: colors.mutedFg }]}>Nothing to add</Text>
					</Pressable>
				</View>
			))}
			<Pressable
				accessibilityRole="button"
				onPress={onLater}
				hitSlop={8}
				style={({ pressed }) => [styles.later, pressed && styles.pressed]}
			>
				<Text style={[styles.action, { color: colors.mutedFg }]}>Not now</Text>
			</Pressable>
		</View>
	)
}

const styles = StyleSheet.create({
	card: { marginHorizontal: 16, borderRadius: 16, padding: 16, gap: 6 },
	title: { fontSize: 17, fontWeight: "600" },
	description: { fontSize: 14, lineHeight: 19, marginBottom: 6 },
	item: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 12,
		paddingTop: 12,
		marginTop: 6,
		borderTopWidth: StyleSheet.hairlineWidth,
	},
	grow: { flex: 1, gap: 4 },
	articleTitle: { fontFamily: "Iowan Old Style", fontSize: 18, lineHeight: 23, fontWeight: "600" },
	meta: { flexDirection: "row", alignItems: "center", gap: 5 },
	metaText: { fontSize: 13 },
	quote: {
		fontFamily: "Iowan Old Style",
		fontSize: 15,
		lineHeight: 20,
		borderLeftWidth: 2,
		paddingLeft: 8,
		marginTop: 4,
	},
	write: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
	action: { fontSize: 15 },
	skip: { paddingTop: 2 },
	later: { alignSelf: "flex-start", marginTop: 10 },
	pressed: { opacity: 0.6 },
})
