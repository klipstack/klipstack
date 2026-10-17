import { Animated, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { Colors } from "@/lib/theme"

/**
 * The reader's status line, at the bottom, always in view: how far along (a thin line), the
 * article's title and the minutes left. It stays while the controls at the top hide, so the
 * article is named wherever the reader is in it.
 */
export function ReaderStatus({
	title,
	minutesLeft,
	line,
	colors,
}: {
	title: string
	minutesLeft: number | null
	/** How far along, 0–1. */
	line: Animated.Value
	colors: Colors
}) {
	const insets = useSafeAreaInsets()
	const left = minutesLeft ? `${minutesLeft} min left` : null
	return (
		<View
			pointerEvents="none"
			accessible
			accessibilityLabel={left ? `${title}, ${left}` : title}
			style={[styles.wrap, { height: statusHeight(insets.bottom) }]}
		>
			{/* The page fades into the line's background, which text scrolls under. */}
			<View
				style={[
					styles.fade,
					{
						experimental_backgroundImage: `linear-gradient(to bottom, ${colors.bg}00, ${colors.bg})`,
					},
				]}
			/>
			<View
				style={[styles.body, { backgroundColor: colors.bg, paddingBottom: padding(insets.bottom) }]}
			>
				<View style={[styles.track, { backgroundColor: `${colors.fg}1a` }]}>
					<Animated.View
						style={[
							styles.fill,
							{ backgroundColor: colors.inkLine, transform: [{ scaleX: line }] },
						]}
					/>
				</View>
				<View style={styles.row}>
					<Text style={[styles.text, styles.title, { color: colors.mutedFg }]} numberOfLines={1}>
						{title}
					</Text>
					{left ? <Text style={[styles.text, { color: colors.mutedFg }]}>{left}</Text> : null}
				</View>
			</View>
		</View>
	)
}

/** Points the status line covers at the bottom of the screen, with `bottomInset` the safe area's. */
export function statusHeight(bottomInset: number): number {
	return FADE + BODY + padding(bottomInset)
}

// Over the home indicator's area, not above it: the line is text to glance at, not to tap.
function padding(bottomInset: number): number {
	return Math.max(bottomInset - 16, 8)
}

const FADE = 12
const BODY = 25

const styles = StyleSheet.create({
	wrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
	fade: { height: FADE },
	body: { flex: 1, paddingHorizontal: 20, paddingTop: 2 },
	track: { height: 2, borderRadius: 1, overflow: "hidden" },
	fill: { height: 2, transformOrigin: "left" },
	row: { flexDirection: "row", alignItems: "baseline", gap: 12, marginTop: 6 },
	text: { fontSize: 12, lineHeight: 15, fontVariant: ["tabular-nums"] },
	title: { flex: 1 },
})
