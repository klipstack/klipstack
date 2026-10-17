import { Pressable, StyleSheet, Text, View } from "react-native"
import type { Colors } from "@/lib/theme"

/**
 * Home's word about topics, as the web's: the invitation to turn them on, once the library is big
 * enough (honest about where the text goes), or the first topics ready to look over. Either opens
 * the Topics screen; "No thanks" ends the invitation for good, "Not now" puts the card away.
 */
export function TopicsHomeCard({
	kind,
	count,
	onOpen,
	onLater,
	colors,
}: {
	kind: "invitation" | "ready"
	/** The library's articles, for the invitation. */
	count: number
	onOpen: () => void
	onLater: () => void
	colors: Colors
}) {
	const invitation = kind === "invitation"
	return (
		<View
			style={[styles.card, { backgroundColor: colors.muted }]}
			testID={invitation ? "home-topics-invitation" : "home-topics"}
		>
			<Text style={[styles.title, { color: colors.fg }]}>
				{invitation ? "Your library is big enough to sort itself" : "Your first topics are ready"}
			</Text>
			<Text style={[styles.description, { color: colors.mutedFg }]}>
				{invitation
					? `You've saved ${count} articles: enough for topics to sort them into shelves, like a bookstore's sections, and keep them sorted as you save more.`
					: "Klipstack found topics in your library. Look them over and confirm them."}
			</Text>
			{invitation ? (
				<Text style={[styles.description, { color: colors.mutedFg }]}>
					Once you turn topics on, article text is sent to TypeSafe and Anthropic.
				</Text>
			) : null}
			<View style={styles.actions}>
				<Pressable
					accessibilityRole="button"
					onPress={onOpen}
					style={({ pressed }) => [
						styles.open,
						{ backgroundColor: colors.accent },
						pressed && styles.pressed,
					]}
				>
					<Text style={[styles.openText, { color: colors.accentFg }]}>
						{invitation ? "See Topics" : "See Your Topics"}
					</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					onPress={onLater}
					hitSlop={8}
					style={({ pressed }) => pressed && styles.pressed}
				>
					<Text style={[styles.later, { color: colors.mutedFg }]}>
						{invitation ? "No thanks" : "Not now"}
					</Text>
				</Pressable>
			</View>
		</View>
	)
}

const styles = StyleSheet.create({
	card: { marginHorizontal: 16, borderRadius: 16, padding: 16, gap: 6 },
	title: { fontSize: 17, fontWeight: "600" },
	description: { fontSize: 14, lineHeight: 19 },
	actions: { flexDirection: "row", alignItems: "center", gap: 20, marginTop: 8 },
	open: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
	openText: { fontSize: 15, fontWeight: "600" },
	later: { fontSize: 15 },
	pressed: { opacity: 0.6 },
})
