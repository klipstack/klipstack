import type { ReactNode } from "react"
import { StyleSheet, View } from "react-native"
import { useColors, useScheme } from "@/lib/theme"
import { PaperView } from "../../modules/klip-paper"

/**
 * A screen's paper: the page's color under its faint grain, as the web's (`--k-grain`), behind
 * `children` (`screenLayout`). The grain is a native layer (modules/klip-paper), not a view: the
 * screen's list stays its first view, where iOS finds it to shrink the large title.
 */
export function Paper({ children }: { children: ReactNode }) {
	const { bg } = useColors()
	const scheme = useScheme()
	const style = [styles.fill, { backgroundColor: bg }]
	return PaperView ? (
		<PaperView scheme={scheme} style={style}>
			{children}
		</PaperView>
	) : (
		<View style={style}>{children}</View>
	)
}

/**
 * The grain alone, over its parent's color and behind what follows it: for what is the page's own
 * paper but stands apart from it (a list's row, a card's frame), which lifts under the long-press
 * menu with its grain. Cards, sheets and the reader stay clean.
 */
export function Grain() {
	const scheme = useScheme()
	return PaperView ? (
		<PaperView
			scheme={scheme}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={styles.grain}
		/>
	) : null
}

const styles = StyleSheet.create({
	fill: { flex: 1 },
	grain: { ...StyleSheet.absoluteFill, pointerEvents: "none" },
})
