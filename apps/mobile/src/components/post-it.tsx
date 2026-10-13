import { type ReactNode, useState } from "react"
import { type StyleProp, StyleSheet, type TextStyle, View, type ViewStyle } from "react-native"
import {
	growingFit,
	LEAST_HEIGHT,
	type PostItVariant,
	postItChars,
	tiltDegrees,
} from "@/lib/post-it"
import type { Colors } from "@/lib/theme"

/** The paper's room around the text, in points: the web's padding. */
const PADDING = {
	full: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20 },
	compact: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 10 },
} as const

/** The hand notes are written in: serif italic, as the web's. Its size, by variant. */
const TEXT = {
	full: { fontSize: 18, lineHeight: 25 },
	compact: { fontSize: 16, lineHeight: 22 },
} as const

/** A character of the notes' hand is about half as wide as it is tall: the web's `ch`. */
const CH = 0.5

const SHADOW = {
	full: "0 1px 1px rgba(0, 0, 0, 0.08), 0 12px 24px -12px rgba(0, 0, 0, 0.4)",
	compact: "0 1px 1px rgba(0, 0, 0, 0.08), 0 6px 12px -8px rgba(0, 0, 0, 0.35)",
} as const

const TAPE = {
	full: { top: -12, width: 80, height: 24 },
	compact: { top: -8, width: 48, height: 16 },
} as const

/**
 * The text style a note is written in on a post-it: the paper's ink, serif italic. For the text or
 * text field inside a `PostIt`.
 */
export function postItText(colors: Colors, variant: PostItVariant = "full"): TextStyle {
	return {
		...TEXT[variant],
		fontFamily: "Iowan Old Style",
		fontStyle: "italic",
		color: colors.note.fg,
	}
}

/**
 * For an editor's `fit`: the longest text it has held since `key` changed. Its paper grows as it is
 * written and never shrinks under the caret.
 */
export function useGrowingFit(text: string, key?: string): string {
	const [longest, setLongest] = useState({ key, text })
	if (longest.key !== key) {
		setLongest({ key, text })
		return text
	}
	const fit = growingFit(longest.text, text)
	if (fit !== longest.text) setLongest({ key, text: fit })
	return fit
}

/**
 * A note someone wrote, on paper taped to the page: a highlight's note, an article's note. One look
 * for every note, in light and dark (`colors.note`), unlike the article's own words: the web's
 * PostIt (apps/web/app/components/post-it.tsx), and the reader page's post-it at the end of the
 * article (`src/page/takeaway.ts`). Its editor sits on the same paper, so writing looks like what
 * is written; write in `postItText`.
 *
 * Sized for its text (`fit`): about square for a short note, a balanced rectangle for a long one,
 * never wider than its container. Without `fit`, the caller sizes it.
 */
export function PostIt({
	variant = "full",
	tilt = 0,
	fit,
	blank = false,
	colors,
	style,
	children,
}: {
	/** `full` (the default): larger tape and a clear lean. `compact`: smaller, leaning barely. */
	variant?: PostItVariant
	/** Which way the note leans, by its place in a list or `tiltFor(id)`: neighbors lean apart. */
	tilt?: number
	/** The note's text: the paper takes the size that suits it. */
	fit?: string
	/** Nothing written on it yet: faint paper with a dashed edge and no tape, to write on. */
	blank?: boolean
	colors: Colors
	style?: StyleProp<ViewStyle>
	children: ReactNode
}) {
	const width =
		fit === undefined
			? undefined
			: postItChars(fit) * TEXT[variant].fontSize * CH + PADDING[variant].paddingHorizontal * 2
	return (
		<View
			style={[
				PADDING[variant],
				width === undefined
					? null
					: { width, maxWidth: "100%", minHeight: width * LEAST_HEIGHT[variant] },
				{ transform: [{ rotate: `${tiltDegrees(tilt, variant)}deg` }] },
				blank
					? {
							backgroundColor: `${colors.note.paper}40`,
							borderWidth: 2,
							borderStyle: "dashed",
							borderColor: colors.note.placeholder,
						}
					: { backgroundColor: colors.note.paper, boxShadow: SHADOW[variant] },
				style,
			]}
		>
			{blank ? null : (
				<View
					pointerEvents="none"
					style={[
						styles.tape,
						TAPE[variant],
						{ marginLeft: -TAPE[variant].width / 2, backgroundColor: colors.note.tape },
					]}
				/>
			)}
			{children}
		</View>
	)
}

const styles = StyleSheet.create({
	tape: {
		position: "absolute",
		left: "50%",
		zIndex: 1,
		transform: [{ rotate: "-3deg" }],
		boxShadow: "0 1px 2px rgba(0, 0, 0, 0.12)",
	},
})
