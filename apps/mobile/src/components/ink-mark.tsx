import { type ReactNode, useState } from "react"
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native"
import { mix } from "@/components/marker-text"
import type { Colors } from "@/lib/theme"

/**
 * Where the reader is, marked as they mark a passage: a stroke of highlighter ink behind a chip's
 * words, in place of a filled pill (the web's `marked`). `pressed`: a lighter stroke of grey ink,
 * where a tap would mark (the web's `ink-hover`). Without either, just the words.
 */
export function InkMark({
	on,
	pressed = false,
	colors,
	style,
	children,
}: {
	on: boolean
	pressed?: boolean
	colors: Colors
	style?: StyleProp<ViewStyle>
	children: ReactNode
}) {
	const [{ width, height }, setSize] = useState({ width: 0, height: 0 })
	const ink = on ? colors.highlight.yellow : null
	// The web's stroke: darker where the pen lands and lifts, 80% as tall as the chip, a little low.
	const start = width ? Math.min(45, (10 / width) * 100) : 10
	const end = width ? Math.max(55, 100 - (13 / width) * 100) : 90
	const background = ink
		? `linear-gradient(to right, ${mix(ink, colors.fg, 0.09)} 0%, ${ink} ${start.toFixed(1)}%, ${ink} ${end.toFixed(1)}%, ${mix(ink, colors.fg, 0.06)} 100%)`
		: pressed
			? `linear-gradient(to right, ${colors.fg}24 0%, ${colors.fg}1c ${start.toFixed(1)}%, ${colors.fg}1c ${end.toFixed(1)}%, ${colors.fg}21 100%)`
			: null
	return (
		<View
			style={style}
			onLayout={(e) =>
				setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
			}
		>
			{background && height ? (
				<View
					pointerEvents="none"
					style={[
						styles.stroke,
						// In points, from the chip's measured height (the web's `0 60% / 100% 80%`): a percentage
						// here would be of the height inside the padding, which puts the stroke high.
						{ top: height * 0.12, height: height * 0.8, experimental_backgroundImage: background },
					]}
				/>
			) : null}
			{children}
		</View>
	)
}

const styles = StyleSheet.create({
	// The web's 0.55em 0.8em 0.7em 0.45em corners, at a chip's 14pt: a stroke, not a pill.
	stroke: {
		position: "absolute",
		left: 0,
		right: 0,
		borderTopLeftRadius: 8,
		borderTopRightRadius: 11,
		borderBottomRightRadius: 10,
		borderBottomLeftRadius: 6,
		overflow: "hidden",
	},
})
