import type { HighlightColor } from "@klipstack/api-contract/enums"
import { type ReactNode, useState } from "react"
import {
	type StyleProp,
	StyleSheet,
	Text,
	type TextLayoutEvent,
	type TextStyle,
	View,
	type ViewStyle,
} from "react-native"
import { inkLines, inkStroke } from "@/lib/highlight-ink"
import type { Colors } from "@/lib/theme"

// React Native 0.88 no longer exports the line type itself.
type TextLayoutLine = TextLayoutEvent["nativeEvent"]["lines"][number]

/**
 * A highlight's quote, marked as it is in the reader: one marker stroke per line, in its color,
 * under the text (`inkStroke`, from the lines the text laid out). The web's `.marker` quotes.
 * `seed` (the highlight's id) gives the strokes their shapes, the same as in the reader.
 */
export function MarkerText({
	text,
	color,
	seed,
	numberOfLines,
	colors,
	style,
	containerStyle,
}: {
	/** The quote; runs of `Text` inside, such as the words a search found in bold, are fine. */
	text: ReactNode
	color: HighlightColor
	seed: string
	numberOfLines?: number
	colors: Colors
	style: StyleProp<TextStyle>
	containerStyle?: StyleProp<ViewStyle>
}) {
	const [lines, setLines] = useState<TextLayoutLine[]>([])
	const fontSize = StyleSheet.flatten(style)?.fontSize ?? 17
	const ink = colors.highlight[color]
	// Darker where the pen lands and lifts, as the web's ink.
	const landing = mix(ink, colors.fg, 0.09)
	const lifting = mix(ink, colors.fg, 0.06)
	const shown = numberOfLines ? lines.slice(0, numberOfLines) : lines
	const strokes = inkLines(
		shown.map((line) => {
			// The text's own height, centered in the line: what the web measures. The line's ascender and
			// descender can span the whole line box, so no more than the font's own.
			const height = Math.min(line.ascender + line.descender || Infinity, fontSize * 1.2)
			const top = line.y + (line.height - height) / 2
			return { left: line.x, right: line.x + line.width, top, bottom: top + height }
		}),
	).map((line, i) => inkStroke(line, { left: 0, top: 0 }, seed, i))
	return (
		<View style={containerStyle}>
			{strokes.map((s) => {
				const start = Math.min(45, ((0.6 * fontSize) / s.width) * 100)
				const end = Math.max(55, 100 - ((0.8 * fontSize) / s.width) * 100)
				return (
					<View
						key={s.line}
						pointerEvents="none"
						style={{
							position: "absolute",
							left: s.left,
							top: s.top,
							width: s.width,
							height: s.height,
							borderTopLeftRadius: s.corners[0],
							borderTopRightRadius: s.corners[1],
							borderBottomRightRadius: s.corners[2],
							borderBottomLeftRadius: s.corners[3],
							overflow: "hidden",
							// Always a rotation, 0° when straight: a recycled row's stroke must not drop its transform.
							transform: [{ rotate: `${s.tilt ?? 0}deg` }],
							experimental_backgroundImage: `linear-gradient(to right, ${landing} 0%, ${ink} ${start.toFixed(1)}%, ${ink} ${end.toFixed(1)}%, ${lifting} 100%)`,
						}}
					/>
				)
			})}
			<Text
				style={style}
				numberOfLines={numberOfLines}
				onTextLayout={(event) => setLines(event.nativeEvent.lines)}
			>
				{text}
			</Text>
		</View>
	)
}

/** `a` with `amount` (0–1) of `b` in it: two `#rrggbb` colors mixed. */
export function mix(a: string, b: string, amount: number): string {
	const channel = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
	return `#${[0, 1, 2]
		.map((i) =>
			Math.round(channel(a, i) * (1 - amount) + channel(b, i) * amount)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`
}
