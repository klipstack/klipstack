import { useEffect, useState } from "react"
import {
	AccessibilityInfo,
	Animated,
	Easing,
	type StyleProp,
	StyleSheet,
	Text,
	type TextStyle,
	View,
} from "react-native"
import Svg, { Path } from "react-native-svg"
import type { Colors } from "@/lib/theme"

const AnimatedPath = Animated.createAnimatedComponent(Path)

/** The stroke's length in its viewBox's units: react-native-svg has no `pathLength`. */
const LENGTH = 27.4

/**
 * While an answer is on its way, in place of a spinner: a short pen stroke beside what is happening
 * ("Thinking…"), drawing itself again and again in the notes' ink. The web's `InkThinking`. Still,
 * and drawn, with Reduce Motion.
 */
export function InkThinking({
	label,
	colors,
	style,
}: {
	label: string
	colors: Colors
	style?: StyleProp<TextStyle>
}) {
	// 1 is not drawn yet, 0 drawn: the dash's offset, as the web's `ink-stroke` keyframes.
	const [offset] = useState(() => new Animated.Value(1.05))
	useEffect(() => {
		let loop: Animated.CompositeAnimation | null = null
		let live = true
		void AccessibilityInfo.isReduceMotionEnabled().then((still) => {
			if (!live) return
			if (still) return offset.setValue(0)
			const draw = Easing.bezier(0.3, 0.7, 0.2, 1)
			loop = Animated.loop(
				Animated.sequence([
					Animated.timing(offset, {
						toValue: 0,
						duration: 720,
						easing: draw,
						useNativeDriver: false,
					}),
					Animated.delay(400),
					Animated.timing(offset, {
						toValue: -1.05,
						duration: 480,
						easing: draw,
						useNativeDriver: false,
					}),
				]),
			)
			loop.start()
		})
		return () => {
			live = false
			loop?.stop()
		}
	}, [offset])
	const fontSize = StyleSheet.flatten(style)?.fontSize ?? 15
	return (
		<View style={styles.row} accessible accessibilityLabel={label}>
			<Svg width={fontSize * 1.75} height={fontSize * 0.75} viewBox="0 0 28 12" fill="none">
				<AnimatedPath
					d="M2 8.5c2.6-2.4 4.6-2.6 6.4-.6s3.6 2 6-.4 4.4-2.6 6.4-.8c1.4 1.2 2.8 1.3 5.2.1"
					stroke={colors.note.fg}
					strokeWidth={1.6}
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeDasharray={`${LENGTH} ${2 * LENGTH}`}
					strokeDashoffset={Animated.multiply(offset, LENGTH)}
				/>
			</Svg>
			<Text style={[styles.label, { color: colors.mutedFg }, style]}>{label}</Text>
		</View>
	)
}

const styles = StyleSheet.create({
	row: { flexDirection: "row", alignItems: "center", gap: 8 },
	label: { fontSize: 15 },
})
