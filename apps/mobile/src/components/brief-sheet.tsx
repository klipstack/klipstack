import type { AiAllowance, AiCitation } from "@klipstack/sdk"
import { SymbolView } from "expo-symbols"
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { AiAnswer } from "@/components/ai-answer"
import { InkThinking } from "@/components/ink-thinking"
import { allowanceMessage, failureMessage, questionsLeft } from "@/lib/ai"
import { briefHeading, plainAnswer } from "@/lib/ai-answer"
import type { ReaderAi } from "@/lib/reader-ai"
import type { Colors } from "@/lib/theme"

/**
 * The article's brief, as a sheet over the reader: its gist, key claims, things to keep in mind
 * and its parts, each cited, written as it streams in. A citation closes the sheet and shows its
 * passage in the article (`onCite`). No follow-ups. The web's `BriefCard`.
 */
export function BriefSheet({
	visible,
	title,
	brief: { brief, writing, streamed, failure, make },
	allowance,
	onCite,
	onCopy,
	onClose,
	onDismiss,
	colors,
}: {
	visible: boolean
	/** The article's title. */
	title: string
	brief: ReaderAi["brief"]
	allowance: AiAllowance | null
	onCite: (citation: AiCitation) => void
	onCopy: (text: string) => void
	onClose: () => void
	/** After the sheet is gone, however it was closed. */
	onDismiss: () => void
	colors: Colors
}) {
	const { none } = questionsLeft(allowance)
	const left = allowanceMessage(allowance)
	return (
		<Modal
			visible={visible}
			presentationStyle="pageSheet"
			animationType="slide"
			onRequestClose={onClose}
			onDismiss={onDismiss}
		>
			<View style={[styles.sheet, { backgroundColor: colors.bg }]}>
				<View style={[styles.bar, { borderColor: colors.border }]}>
					<Text style={[styles.barTitle, { color: colors.fg }]}>Brief</Text>
					<Pressable accessibilityRole="button" onPress={onClose} hitSlop={12} style={styles.done}>
						<Text style={[styles.doneText, { color: colors.accent }]}>Done</Text>
					</Pressable>
				</View>
				<ScrollView contentContainerStyle={styles.content}>
					<Text style={[styles.label, { color: colors.mutedFg }]}>SUM UP</Text>
					<Text style={[styles.title, { color: colors.fg }]} numberOfLines={3}>
						{title}
					</Text>
					<View style={[styles.rule, { backgroundColor: colors.highlight.yellow }]} />
					<View accessibilityLiveRegion="polite">
						{writing ? (
							streamed.text ? (
								<AiAnswer
									text={streamed.text}
									citations={streamed.citations}
									onCite={onCite}
									heading={briefHeading}
									colors={colors}
								/>
							) : (
								<InkThinking label="Writing the brief…" colors={colors} style={styles.thinking} />
							)
						) : brief ? (
							<AiAnswer
								text={brief.text}
								citations={brief.citations}
								onCite={onCite}
								heading={briefHeading}
								colors={colors}
							/>
						) : null}
						{failure && !writing ? (
							<Text accessibilityRole="alert" style={[styles.failure, { color: colors.danger }]}>
								{failure.code === "failed"
									? "Couldn't write the brief. Try again."
									: failureMessage(failure, allowance)}
							</Text>
						) : null}
					</View>
					{writing ? null : (
						<View style={styles.actions}>
							{brief ? (
								<Tool
									label="Copy"
									symbol="doc.on.doc"
									color={colors.accent}
									onPress={() => onCopy(plainAnswer(brief.text))}
								/>
							) : failure && !none ? (
								<Tool
									label="Try Again"
									symbol="arrow.clockwise"
									color={colors.accent}
									onPress={() => void make()}
								/>
							) : null}
						</View>
					)}
					{left && !writing && !brief && failure?.code !== "limit_reached" ? (
						<Text style={[styles.left, { color: colors.mutedFg }]}>{left}</Text>
					) : null}
				</ScrollView>
			</View>
		</Modal>
	)
}

function Tool({
	label,
	symbol,
	color,
	onPress,
}: {
	label: string
	symbol: "doc.on.doc" | "arrow.clockwise"
	color: string
	onPress: () => void
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			hitSlop={8}
			style={({ pressed }) => [styles.tool, pressed && styles.pressed]}
		>
			<SymbolView name={symbol} tintColor={color} size={17} />
			<Text style={[styles.toolText, { color }]}>{label}</Text>
		</Pressable>
	)
}

const styles = StyleSheet.create({
	sheet: { flex: 1 },
	bar: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		height: 56,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	barTitle: { fontSize: 17, fontWeight: "600" },
	done: { position: "absolute", right: 20 },
	doneText: { fontSize: 17, fontWeight: "600" },
	content: { padding: 24, paddingBottom: 48 },
	label: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6 },
	title: {
		marginTop: 6,
		fontFamily: "Iowan Old Style",
		fontSize: 22,
		lineHeight: 28,
		fontWeight: "600",
	},
	// A stroke of the citations' ink under the title.
	rule: {
		width: 56,
		height: 6,
		marginTop: 12,
		marginBottom: 20,
		borderRadius: 3,
		transform: [{ rotate: "-1deg" }],
	},
	thinking: { fontFamily: "Iowan Old Style", fontSize: 17, fontStyle: "italic" },
	failure: { marginTop: 12, fontSize: 15, lineHeight: 21 },
	actions: { flexDirection: "row", gap: 24, marginTop: 20 },
	tool: { flexDirection: "row", alignItems: "center", gap: 6 },
	toolText: { fontSize: 15, fontWeight: "600" },
	pressed: { opacity: 0.6 },
	left: { marginTop: 16, fontSize: 13 },
})
