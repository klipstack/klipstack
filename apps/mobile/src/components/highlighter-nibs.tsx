import { HIGHLIGHT_COLORS, type HighlightColor } from "@klipstack/api-contract/enums"
import { useEffect, useState } from "react"
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, View } from "react-native"
import type { Colors } from "@/lib/theme"

export const COLOR_NAMES: Record<HighlightColor, string> = {
	yellow: "Yellow",
	green: "Green",
	blue: "Blue",
	pink: "Pink",
	orange: "Orange",
}

// The tip's width; it is a little taller than wide, its top cut on a slant (a third of its height).
const TIP = 28
const TIP_HEIGHT = TIP * 1.05
const CUT = TIP_HEIGHT * 0.32
const SLANT = `${(-Math.atan(CUT / TIP) * 180) / Math.PI}deg`
// How far the current color stands raised.
const RAISED = -5

/**
 * The five highlight colors as marker tips, slanted like a chisel highlighter: the current one
 * stands raised over a line. The web's `HighlighterNibs` (apps/web/app/components/highlighter-nibs.tsx).
 */
export function HighlighterNibs({
	value,
	onChange,
	colors,
}: {
	value: HighlightColor
	onChange: (color: HighlightColor) => void
	colors: Colors
}) {
	return (
		<View accessibilityRole="radiogroup" accessibilityLabel="Highlight color" style={styles.nibs}>
			{HIGHLIGHT_COLORS.map((color) => (
				<Nib
					key={color}
					color={color}
					selected={value === color}
					onPress={() => onChange(color)}
					colors={colors}
				/>
			))}
		</View>
	)
}

function Nib({
	color,
	selected,
	onPress,
	colors,
}: {
	color: HighlightColor
	selected: boolean
	onPress: () => void
	colors: Colors
}) {
	const [lift] = useState(() => new Animated.Value(selected ? RAISED : 0))
	useEffect(() => {
		let live = true
		void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
			if (!live) return
			const toValue = selected ? RAISED : 0
			if (reduce) lift.setValue(toValue)
			else
				Animated.timing(lift, {
					toValue,
					duration: 180,
					easing: Easing.bezier(0.3, 0.7, 0.2, 1),
					useNativeDriver: true,
				}).start()
		})
		return () => {
			live = false
		}
	}, [selected, lift])
	return (
		<Pressable
			accessibilityRole="radio"
			accessibilityLabel={COLOR_NAMES[color]}
			accessibilityState={{ selected }}
			onPress={onPress}
			hitSlop={{ top: 8, bottom: 8 }}
			style={styles.nib}
		>
			<Animated.View style={[styles.tip, { transform: [{ translateY: lift }] }]}>
				<View
					style={[
						styles.ink,
						{ backgroundColor: colors.nib[color], transform: [{ rotate: SLANT }] },
					]}
				/>
			</Animated.View>
			{selected ? <View style={[styles.line, { backgroundColor: colors.fg }]} /> : null}
		</Pressable>
	)
}

const styles = StyleSheet.create({
	nibs: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
	nib: {
		width: TIP + 6,
		height: TIP * 1.45,
		paddingBottom: 6,
		alignItems: "center",
		justifyContent: "flex-end",
	},
	tip: {
		width: TIP,
		height: TIP_HEIGHT,
		overflow: "hidden",
		borderBottomLeftRadius: 3,
		borderBottomRightRadius: 3,
	},
	// Wider than the tip and turned about its left top corner, so its top edge is the slant.
	ink: {
		position: "absolute",
		left: -TIP,
		top: CUT,
		width: TIP * 3,
		height: TIP_HEIGHT * 2,
		transformOrigin: [TIP, 0, 0],
	},
	line: { position: "absolute", left: 4, right: 4, bottom: 0, height: 2, borderRadius: 1 },
})
