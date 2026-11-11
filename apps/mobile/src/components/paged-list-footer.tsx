import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"
import { t } from "@/lib/i18n"
import { useColors } from "@/lib/theme"

/**
 * The end of a paged list: a spinner while the next page loads; after it failed, why, and Try
 * Again (scrolling doesn't ask again: `paged-list-machine.ts`). Nothing otherwise.
 */
export function PagedListFooter({
	list,
}: {
	/** `usePagedList`'s answer. */
	list: { loadingMore: boolean; moreFailed: boolean; error: string | null; retryMore: () => void }
}) {
	const colors = useColors()
	if (list.loadingMore) return <ActivityIndicator style={styles.footer} color={colors.mutedFg} />
	if (!list.moreFailed) return null
	return (
		<View style={styles.footer}>
			{list.error ? (
				<Text style={[styles.message, { color: colors.mutedFg }]}>{list.error}</Text>
			) : null}
			<Pressable
				accessibilityRole="button"
				onPress={list.retryMore}
				hitSlop={8}
				style={({ pressed }) => pressed && styles.pressed}
			>
				<Text style={[styles.action, { color: colors.accent }]}>{t("common.actions.retry")}</Text>
			</Pressable>
		</View>
	)
}

const styles = StyleSheet.create({
	footer: { paddingVertical: 20, paddingHorizontal: 32, alignItems: "center", gap: 10 },
	message: { fontSize: 15, lineHeight: 21, textAlign: "center" },
	action: { fontSize: 17, fontWeight: "600" },
	pressed: { opacity: 0.6 },
})
