import { useState } from "react"
import { StyleSheet, Text, View } from "react-native"
import { type Colors, fonts, useScheme } from "@/lib/theme"
import { bookColor, siteHue } from "@/lib/topic-shelves"

/** A cover this wide, in points, has room for the title; a smaller one, for the site's initial. */
const ROOMY = 192

/**
 * An article's cover when it has no picture: a book's, in the paint of its site's books on the
 * Topics shelves, the site on top and the title (or, small, the site's initial) in the logo's serif
 * below. The web's (article-image.tsx). The card beside it says both, so VoiceOver skips it.
 */
export function SiteCover({
	site,
	title,
	shelf,
	colors,
	width: known,
}: {
	site: string
	title: string
	/** What its color is told apart by: the site's host, as the shelves'. */
	shelf: string
	colors: Colors
	/**
	 * Its width in points, when the list knows it: drawn in one go. Without it the cover measures
	 * itself, and its words come a frame later.
	 */
	width?: number
}) {
	const scheme = useScheme()
	const [measured, setMeasured] = useState(0)
	const width = known ?? measured
	const ink = { color: colors.shelf.bookFg }
	const pad = width * 0.07
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			onLayout={known ? undefined : (e) => setMeasured(e.nativeEvent.layout.width)}
			style={[
				StyleSheet.absoluteFill,
				styles.cover,
				{ backgroundColor: bookColor(siteHue(shelf), scheme), padding: pad, gap: width * 0.03 },
			]}
		>
			{width ? (
				<>
					<Text
						numberOfLines={1}
						allowFontScaling={false}
						style={[styles.site, ink, { fontSize: Math.max(10, width * 0.04) }]}
					>
						{site.toUpperCase()}
					</Text>
					{width < ROOMY ? (
						<Text
							allowFontScaling={false}
							style={[styles.display, ink, { fontSize: width * 0.42, lineHeight: width * 0.42 }]}
						>
							{(Array.from(site)[0] ?? "").toUpperCase()}
						</Text>
					) : (
						<Text
							numberOfLines={4}
							allowFontScaling={false}
							style={[
								styles.display,
								styles.title,
								ink,
								{
									borderTopColor: `${colors.shelf.bookFg}40`,
									paddingTop: width * 0.03,
									fontSize: width * 0.075,
									lineHeight: width * 0.075 * 1.1,
								},
							]}
						>
							{title}
						</Text>
					)}
				</>
			) : null}
		</View>
	)
}

const styles = StyleSheet.create({
	cover: { justifyContent: "space-between" },
	site: { fontWeight: "500", letterSpacing: 1.2, opacity: 0.75 },
	display: { fontFamily: fonts.display },
	title: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
})
