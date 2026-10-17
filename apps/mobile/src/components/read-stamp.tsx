import { StyleSheet, Text, View } from "react-native"
import { tiltFor } from "@/lib/post-it"
import type { Colors } from "@/lib/theme"

/** Stamped by hand: never quite straight, and never twice the same way. Degrees. */
const TILTS = [-7, -4, 3, -9]

/**
 * An ink stamp that says an article was read, in a library's date-stamp ink, a little tilted by
 * the article (the same every time): the web's ReadStamp. VoiceOver hears "Finished". On a picture
 * (`onPicture`) it is stamped on a slip of paper, or a photo would swallow the ink.
 */
export function ReadStamp({
	id,
	onPicture = false,
	colors,
}: {
	id: string
	onPicture?: boolean
	colors: Colors
}) {
	return (
		<View
			accessible
			accessibilityLabel="Finished"
			style={[
				styles.stamp,
				{ transform: [{ rotate: `${TILTS[tiltFor(id) % TILTS.length]}deg` }] },
				onPicture && [styles.slip, { backgroundColor: `${colors.bg}e6` }],
			]}
		>
			<View style={[styles.ink, { borderColor: colors.stamp }]}>
				<Text
					// The stamp is a mark, not type: it keeps its size.
					allowFontScaling={false}
					style={[styles.word, { color: colors.stamp }]}
				>
					READ
				</Text>
			</View>
		</View>
	)
}

const styles = StyleSheet.create({
	stamp: { alignSelf: "flex-start" },
	slip: {
		padding: 3,
		borderRadius: 4,
		boxShadow: "0 1px 2px rgba(0, 0, 0, 0.12)",
	},
	ink: { borderWidth: 1.5, borderRadius: 3, paddingHorizontal: 4, opacity: 0.85 },
	word: { fontSize: 10, lineHeight: 13, fontWeight: "800", letterSpacing: 1.4 },
})
