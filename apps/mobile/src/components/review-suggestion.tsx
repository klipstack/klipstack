import { Pressable, StyleSheet, Text, View } from "react-native"
import { t } from "@/lib/i18n"
import type { Colors } from "@/lib/theme"

/**
 * Home's suggestion of the review of old saves, as the web's: a quiet card, without a count. Going
 * through them or "Not now" puts it off for a month.
 */
export function ReviewSuggestion({
	onOpen,
	onLater,
	colors,
}: {
	onOpen: () => void
	onLater: () => void
	colors: Colors
}) {
	return (
		<View style={[styles.card, { backgroundColor: colors.muted }]}>
			<Text style={[styles.title, { color: colors.fg }]}>{t("home.review.card.title")}</Text>
			<Text style={[styles.description, { color: colors.mutedFg }]}>
				{t("home.review.card.description")}
			</Text>
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
						{t("home.review.card.open")}
					</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					onPress={onLater}
					hitSlop={8}
					style={({ pressed }) => pressed && styles.pressed}
				>
					<Text style={[styles.later, { color: colors.mutedFg }]}>
						{t("home.review.card.notNow")}
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
