import type { Highlight } from "@klipstack/sdk"
import { Link } from "expo-router"
import { useState } from "react"
import { Pressable, Share, StyleSheet, Text, View } from "react-native"
import { siteName } from "@/lib/article-meta"
import { copyText } from "@/lib/clipboard"
import { fromStored } from "@/lib/note-field"
import type { Colors } from "@/lib/theme"

/**
 * One highlight in the Highlights tab, as the web's highlights page lists it: a bar in its color,
 * the quote, its note, and the article it is from. A tap opens the article at the highlight, with
 * its card (color, note, Delete), as the notes sheet does; a long press, its menu (Copy, Share,
 * Delete).
 */
export function HighlightRow({
	highlight,
	colors,
	onDelete,
}: {
	highlight: Highlight
	colors: Colors
	onDelete: (highlight: Highlight) => void
}) {
	const [pressed, setPressed] = useState(false)
	const { article } = highlight
	return (
		<Link
			href={{ pathname: "/read/[id]", params: { id: article.id, highlight: highlight.id } }}
			push
			asChild
		>
			<Link.Trigger>
				<Pressable
					accessibilityRole="link"
					onPressIn={() => setPressed(true)}
					onPressOut={() => setPressed(false)}
					// The Link takes one style object, not a list.
					style={StyleSheet.flatten([
						styles.row,
						{ backgroundColor: colors.bg },
						pressed && styles.pressed,
					])}
				>
					<View style={[styles.bar, { backgroundColor: colors.highlight[highlight.color] }]} />
					<View style={styles.body}>
						<Text style={[styles.quote, { color: colors.fg }]} numberOfLines={12}>
							{oneLine(highlight.quote)}
						</Text>
						{highlight.note ? (
							<Text style={[styles.note, { color: colors.fg }]} numberOfLines={6}>
								{/* Links as their titles. */}
								{fromStored(highlight.note).text}
							</Text>
						) : null}
						<Text style={[styles.source, { color: colors.mutedFg }]} numberOfLines={1}>
							{[article.title, siteName(article)].filter(Boolean).join(" · ")}
						</Text>
					</View>
				</Pressable>
			</Link.Trigger>
			<Link.Menu>
				<Link.MenuAction icon="doc.on.doc" onPress={() => void copyText(highlight.quote)}>
					Copy
				</Link.MenuAction>
				<Link.MenuAction
					icon="square.and.arrow.up"
					onPress={() => void Share.share({ message: shareText(highlight), url: article.url })}
				>
					Share
				</Link.MenuAction>
				<Link.MenuAction icon="trash" destructive onPress={() => onDelete(highlight)}>
					Delete
				</Link.MenuAction>
			</Link.Menu>
		</Link>
	)
}

/** Runs of spaces and line breaks as one space, as the web page shows a quote. */
function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim()
}

/** The quote, in quotation marks, and where it is from. */
function shareText(highlight: Highlight): string {
	const from = highlight.article.title ?? siteName(highlight.article)
	return `“${oneLine(highlight.quote)}”\n\n${from}`
}

const INSET = 12

const styles = StyleSheet.create({
	// Room around the content, past the list's margin, so the row lifts as one piece under the menu.
	row: {
		flexDirection: "row",
		gap: 14,
		paddingVertical: 16,
		marginHorizontal: -INSET,
		paddingHorizontal: INSET,
		borderRadius: 12,
	},
	pressed: { opacity: 0.6 },
	bar: { width: 4, borderRadius: 2 },
	body: { flex: 1, gap: 8 },
	quote: { fontFamily: "Iowan Old Style", fontSize: 18, lineHeight: 26 },
	note: { fontSize: 15, lineHeight: 21 },
	source: { fontSize: 13 },
})
