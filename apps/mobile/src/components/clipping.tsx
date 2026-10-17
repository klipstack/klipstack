import { useState } from "react"
import { StyleSheet, View } from "react-native"
import Svg, { Polygon } from "react-native-svg"
import { tiltFor } from "@/lib/post-it"
import type { Colors } from "@/lib/theme"

/** Room above the paper for its tape, in points: the web's --clip-top. */
export const CLIP_TOP = 18

/**
 * A cut's corners, `[x%, dx, y%, dy]` each: a share of the side plus points, so a tall clipping is
 * cut as finely as a short one. The web's three cuts (app.css, `.clipping-paper[data-cut]`).
 */
type Corner = [number, number, number, number]
const CUTS: Corner[][] = [
	[
		[0, 0, 0, 4],
		[38, 0, 0, 0],
		[100, 0, 0, 3],
		[100, -2, 47, 0],
		[100, 0, 100, 0],
		[61, 0, 100, -4],
		[0, 3, 100, 0],
		[0, 0, 52, 0],
	],
	[
		[0, 3, 0, 0],
		[100, 0, 0, 4],
		[100, 0, 58, 0],
		[100, -3, 100, 0],
		[33, 0, 100, 0],
		[0, 0, 100, -3],
		[0, 2, 41, 0],
	],
	[
		[0, 0, 0, 2],
		[64, 0, 0, 4],
		[100, -3, 0, 0],
		[100, 0, 100, 0],
		[0, 0, 100, -4],
	],
]

/** Where the tape goes on each cut, and its lean: set by hand each time. */
const TAPES = [
	{ left: 16, rotate: "-7deg" },
	{ left: 28, rotate: "4deg" },
	{ left: 8, rotate: "-11deg" },
]

/** A cut's points in a box of this size, `inset` points inside its edge. */
export function cutPoints(cut: number, width: number, height: number, inset = 0): string {
	const w = width - inset * 2
	const h = height - inset * 2
	return CUTS[cut % CUTS.length]!.map(
		([x, dx, y, dy]) => `${inset + (w * x) / 100 + dx},${inset + (h * y) / 100 + dy}`,
	).join(" ")
}

/**
 * A Notebook card's paper, as the web's ClippingPaper: a clipping cut from the page with scissors,
 * never quite square, a thin edge where the cut shows, taped at a corner with a post-it's clear
 * tape. Goes first in the card, which leaves `CLIP_TOP` above its words for the tape. `id` chooses
 * the cut and the tape, the same every time. Decoration: VoiceOver skips it.
 */
export function ClippingPaper({
	id,
	compact = false,
	colors,
}: {
	id: string
	/** A small tile's: shorter tape, nearer its corner. */
	compact?: boolean
	colors: Colors
}) {
	const cut = tiltFor(id) % CUTS.length
	// Measured for this id: a list recycles the view, and another clipping's size must not show.
	const [measured, setMeasured] = useState<{ id: string; width: number; height: number } | null>(
		null,
	)
	const size = measured?.id === id ? measured : null
	const tape = TAPES[cut]!
	return (
		<>
			<View
				pointerEvents="none"
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				onLayout={(e) => {
					const { width, height } = e.nativeEvent.layout
					setMeasured((was) =>
						was?.id === id && was.width === width && was.height === height
							? was
							: { id, width, height },
					)
				}}
				// Until it is measured, a plain sheet: the cut differs from it by a few points only.
				style={[styles.paper, size ? null : { backgroundColor: colors.card }]}
			>
				{size ? (
					<Svg width={size.width} height={size.height + 2}>
						{/* The shadow a clipped shape can't cast: the same cut, a little lower. */}
						<Polygon
							points={cutPoints(cut, size.width, size.height).replace(
								/,([\d.-]+)/g,
								(_, y) => `,${Number(y) + 1.5}`,
							)}
							fill="#00000014"
						/>
						<Polygon points={cutPoints(cut, size.width, size.height)} fill={colors.border} />
						<Polygon points={cutPoints(cut, size.width, size.height, 1)} fill={colors.card} />
					</Svg>
				) : null}
			</View>
			<View
				pointerEvents="none"
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={[
					styles.tape,
					{ left: compact ? tape.left / 2 : tape.left, transform: [{ rotate: tape.rotate }] },
					compact && styles.compactTape,
					{ backgroundColor: colors.note.tape },
				]}
			/>
		</>
	)
}

const styles = StyleSheet.create({
	paper: { position: "absolute", top: CLIP_TOP, left: 0, right: 0, bottom: 0 },
	tape: {
		position: "absolute",
		top: 7,
		width: 76,
		height: 22,
		boxShadow: "0 1px 2px rgba(0, 0, 0, 0.12)",
	},
	compactTape: { top: 9, width: 52, height: 18 },
})
