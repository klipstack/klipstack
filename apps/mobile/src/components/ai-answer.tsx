import type { AiCitation } from "@klipstack/sdk"
import { Fragment, useMemo } from "react"
import { StyleSheet, Text, View } from "react-native"
import { answerBlocks, type Run } from "@/lib/ai-answer"
import { t } from "@/lib/i18n"
import type { Colors } from "@/lib/theme"

/**
 * An answer, in the reader's typeface: its light Markdown, and each citation as its number on a
 * dab of yellow highlighter ink, after the words it supports. Tapping one shows the passage in the
 * article (`onCite`). The web's `AiAnswer`.
 */
export function AiAnswer({
	text,
	citations,
	onCite,
	heading = (title) => title,
	colors,
}: {
	text: string
	citations: readonly AiCitation[]
	onCite?: (citation: AiCitation) => void
	/** A heading as shown: the brief's are in English whatever the language. */
	heading?: (title: string) => string
	colors: Colors
}) {
	const blocks = useMemo(() => answerBlocks(text, citations), [text, citations])
	const runs = (list: Run[]) =>
		list.map((run, i) => {
			// oxlint-disable-next-line react/no-array-index-key -- a run's place is its identity while it streams
			if (run.kind === "text") return <Fragment key={i}>{styled(run)}</Fragment>
			const citation = citations[run.n]
			if (!citation) return null
			// Two numbers side by side stay apart.
			const after = list[i - 1]?.kind === "cite" ? " " : ""
			return (
				// oxlint-disable-next-line react/no-array-index-key -- as above
				<Fragment key={i}>
					{after}
					<Text
						accessibilityRole="button"
						accessibilityLabel={t("ai.answer.citation", { n: run.n + 1 })}
						onPress={onCite ? () => onCite(citation) : undefined}
						suppressHighlighting={false}
						style={[styles.cite, { backgroundColor: colors.highlight.yellow, color: colors.fg }]}
					>
						{`\u2009${run.n + 1}\u2009`}
					</Text>
				</Fragment>
			)
		})
	const styled = (run: Extract<Run, { kind: "text" }>) =>
		run.bold || run.italic ? (
			<Text style={[run.bold && styles.bold, run.italic && styles.italic]}>{run.text}</Text>
		) : (
			run.text
		)
	const body = [styles.body, { color: colors.fg }]
	return (
		<View style={styles.blocks}>
			{blocks.map((block) => {
				if (block.kind === "heading")
					return (
						<Text key={block.key} style={[styles.heading, { color: colors.mutedFg }]}>
							{heading(block.text)}
						</Text>
					)
				if (block.kind === "p")
					return (
						<Text key={block.key} style={body}>
							{runs(block.runs)}
						</Text>
					)
				return (
					<View key={block.key} style={styles.list}>
						{block.items.map((item, i) => (
							// oxlint-disable-next-line react/no-array-index-key -- an item's place is its identity while it streams
							<View key={i} style={styles.item}>
								<Text style={[body, styles.marker, { color: colors.mutedFg }]}>
									{block.kind === "ol" ? `${block.start + i}.` : "•"}
								</Text>
								<Text style={[body, styles.grow]}>{runs(item)}</Text>
							</View>
						))}
					</View>
				)
			})}
		</View>
	)
}

const styles = StyleSheet.create({
	blocks: { gap: 10 },
	body: { fontFamily: "Iowan Old Style", fontSize: 17, lineHeight: 25 },
	bold: { fontWeight: "700" },
	italic: { fontStyle: "italic" },
	heading: {
		marginTop: 6,
		fontSize: 13,
		fontWeight: "600",
		letterSpacing: 0.4,
		textTransform: "uppercase",
	},
	list: { gap: 6 },
	item: { flexDirection: "row", gap: 8 },
	marker: { minWidth: 18, textAlign: "right", fontVariant: ["tabular-nums"] },
	grow: { flex: 1 },
	cite: { fontFamily: "System", fontSize: 13, fontWeight: "600", borderRadius: 4 },
})
