import { type ReactNode, useState } from "react"
import { Image, StyleSheet, View } from "react-native"
import { useColors, useScheme } from "@/lib/theme"

/**
 * The web's paper grain (`--k-grain`), drawn into a tile per scheme (scripts/grain.mjs): ink-brown
 * specks on light paper, lamp-lit ones in the dark, their strength in the tile itself.
 */
const GRAIN = {
	light: require("../../assets/grain-light.png"),
	dark: require("../../assets/grain-dark.png"),
}
/** The tile's size in points. */
const TILE = 256

/**
 * The page's paper grain, as the web's: a faint noise over the page's color. Fills its parent,
 * behind what follows it; never a target of touches. Cards, sheets and the reader stay clean; what
 * is the page's own paper (the screen, a list's rows, a card's frame) carries it.
 *
 * Laid out tile by tile: React Native draws a `repeat` image once, at its size, not across the
 * view. A row needs two tiles, a screen eight; they are still images, so scrolling only moves them.
 */
export function Grain() {
	const source = GRAIN[useScheme()]
	const [size, setSize] = useState({ width: 0, height: 0 })
	const columns = Math.ceil(size.width / TILE)
	const rows = Math.ceil(size.height / TILE)
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={styles.grain}
			onLayout={(e) => {
				const { width, height } = e.nativeEvent.layout
				setSize((shown) =>
					shown.width === width && shown.height === height ? shown : { width, height },
				)
			}}
		>
			{Array.from({ length: rows * columns }, (_, i) => (
				<Image
					key={i}
					source={source}
					style={[styles.tile, { left: (i % columns) * TILE, top: Math.floor(i / columns) * TILE }]}
				/>
			))}
		</View>
	)
}

/** A screen's paper: the page's color with its grain behind `children` (`screenLayout`). */
export function Paper({ children }: { children: ReactNode }) {
	const { bg } = useColors()
	return (
		<View style={[styles.fill, { backgroundColor: bg }]}>
			<Grain />
			{children}
		</View>
	)
}

const styles = StyleSheet.create({
	fill: { flex: 1 },
	grain: {
		position: "absolute",
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
		overflow: "hidden",
		pointerEvents: "none",
	},
	tile: { position: "absolute", width: TILE, height: TILE },
})
