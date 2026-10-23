import { SymbolView, type SymbolViewProps } from "expo-symbols"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { BulkAction, BulkChoice } from "@/lib/bulk-actions"
import { t } from "@/lib/i18n"
import type { Colors } from "@/lib/theme"

const BUTTONS: Record<BulkAction, { icon: SymbolViewProps["name"]; label: string }> = {
	star: { icon: "star", label: t("library.actions.star") },
	unstar: { icon: "star.slash", label: t("library.actions.unstar") },
	shortlist: { icon: "newspaper", label: t("library.actions.shortlist") },
	unshortlist: { icon: "newspaper", label: t("library.actions.unshortlist") },
	archive: { icon: "archivebox", label: t("common.actions.archive") },
	unarchive: { icon: "tray.and.arrow.up", label: t("library.actions.unarchive") },
	finish: { icon: "checkmark.circle", label: t("library.actions.finish") },
	unread: { icon: "eye.slash", label: t("library.actions.unread") },
	tag: { icon: "tag", label: t("library.actions.tags") },
	delete: { icon: "trash", label: t("common.actions.delete") },
	restore: { icon: "arrow.uturn.backward", label: t("library.actions.restore") },
	purge: { icon: "trash", label: t("common.actions.deleteForever") },
}

/** How much of the list's end the bar covers: the list leaves that much room below its last item. */
export const SELECTION_BAR_SPACE = 88

/**
 * Multi-select's actions, as the web's selection bar on a phone: a bar floating at the bottom, in
 * the tab bar's place, with how many articles are checked (or what was just done to them) and what
 * they allow (`bulkActions`). Articles in the trash and others together allow nothing: it says so.
 */
export function SelectionBar({
	count,
	notice,
	choice,
	onAction,
	colors,
}: {
	count: number
	/** What the last action did, shown for a moment in place of the count. */
	notice: string | null
	choice: BulkChoice
	onAction: (action: BulkAction) => void
	colors: Colors
}) {
	const text =
		notice ??
		(count === 0
			? t("library.select.hint")
			: choice.kind === "mixed"
				? t("library.select.mixed")
				: t("library.select.count", { count }))
	const quiet = notice !== null || count === 0 || choice.kind === "mixed"
	const bar = colors.floating
	const insets = useSafeAreaInsets()
	return (
		<View pointerEvents="box-none" style={[styles.wrap, { bottom: Math.max(insets.bottom, 16) }]}>
			<View
				accessibilityRole="toolbar"
				accessibilityLabel={t("library.select.toolbar")}
				style={[styles.pill, { backgroundColor: bar.bg, borderColor: bar.border }]}
			>
				<Text
					accessibilityLiveRegion="polite"
					numberOfLines={1}
					style={[styles.count, { color: quiet ? bar.mutedFg : bar.fg }, !quiet && styles.strong]}
				>
					{text}
				</Text>
				{choice.actions.map((action) => (
					<Pressable
						key={action}
						accessibilityRole="button"
						accessibilityLabel={BUTTONS[action].label}
						onPress={() => onAction(action)}
						style={({ pressed }) => [styles.button, pressed && styles.pressed]}
					>
						<SymbolView name={BUTTONS[action].icon} tintColor={bar.fg} size={22} />
					</Pressable>
				))}
			</View>
		</View>
	)
}

const styles = StyleSheet.create({
	wrap: { position: "absolute", left: 16, right: 16 },
	pill: {
		flexDirection: "row",
		alignItems: "center",
		minHeight: 56,
		paddingLeft: 20,
		paddingRight: 6,
		borderRadius: 999,
		borderWidth: StyleSheet.hairlineWidth,
		shadowColor: "#000",
		shadowOpacity: 0.15,
		shadowRadius: 12,
		shadowOffset: { width: 0, height: 4 },
	},
	count: { flex: 1, fontSize: 15 },
	strong: { fontWeight: "600" },
	button: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
	pressed: { opacity: 0.6 },
})
