import { useEffect, useState, useSyncExternalStore } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { currentToast, dismissToast, onToast } from "@/lib/article-changes"
import { useColors } from "@/lib/theme"

/** The tab bar's height above the home indicator: the toast sits over it. */
const TAB_BAR = 49

/**
 * The app's toast (`showToast` in src/lib/article-changes.ts), over every screen; and over a sheet,
 * which covers them, `above` its bottom controls (points from the screen's bottom).
 */
export function ToastHost({ above }: { above?: number }) {
	const toast = useSyncExternalStore(onToast, currentToast)
	const colors = useColors()
	const insets = useSafeAreaInsets()
	const bar = colors.floating
	const [shown] = useState(() => new Animated.Value(0))
	useEffect(() => {
		Animated.timing(shown, {
			toValue: toast ? 1 : 0,
			duration: 180,
			useNativeDriver: true,
		}).start()
	}, [toast, shown])
	if (!toast) return null
	return (
		<Animated.View
			pointerEvents="box-none"
			accessibilityLiveRegion="polite"
			style={[
				styles.wrap,
				{
					bottom: above ?? insets.bottom + TAB_BAR + 12,
					opacity: shown,
					transform: [
						{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
					],
				},
			]}
		>
			<View style={[styles.toast, { backgroundColor: bar.bg, borderColor: bar.border }]}>
				<Text style={[styles.message, { color: bar.fg }]} numberOfLines={2}>
					{toast.message}
				</Text>
				{toast.action ? (
					<Pressable
						accessibilityRole="button"
						hitSlop={10}
						onPress={() => {
							dismissToast(toast.id)
							toast.action?.run()
						}}
						style={({ pressed }) => pressed && styles.pressed}
					>
						<Text style={[styles.action, { color: bar.accent }]}>{toast.action.label}</Text>
					</Pressable>
				) : null}
			</View>
		</Animated.View>
	)
}

const styles = StyleSheet.create({
	wrap: { position: "absolute", left: 16, right: 16, alignItems: "center" },
	toast: {
		flexDirection: "row",
		alignItems: "center",
		gap: 16,
		maxWidth: 480,
		width: "100%",
		paddingVertical: 12,
		paddingHorizontal: 16,
		borderRadius: 14,
		borderWidth: StyleSheet.hairlineWidth,
		shadowColor: "#000",
		shadowOpacity: 0.2,
		shadowRadius: 12,
		shadowOffset: { width: 0, height: 4 },
	},
	message: { flex: 1, fontSize: 15 },
	action: { fontSize: 15, fontWeight: "600" },
	pressed: { opacity: 0.6 },
})
