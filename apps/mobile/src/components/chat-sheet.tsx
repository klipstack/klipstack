import type { AiAllowance, AiCitation } from "@klipstack/sdk"
import { SymbolView, type SymbolViewProps } from "expo-symbols"
import { useEffect, useRef, useState } from "react"
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { AiAnswer } from "@/components/ai-answer"
import { QuestionField, Turns, useKeyboardHeight } from "@/components/ai-card"
import { InkThinking } from "@/components/ink-thinking"
import { ToastHost } from "@/components/toast-host"
import { allowanceMessage, failureMessage, questionsLeft } from "@/lib/ai"
import { plainAnswer } from "@/lib/ai-answer"
import { useWritten } from "@/lib/ai-cards"
import { type AiCard, type AnswerStore, cardState } from "@/lib/ai-threads"
import type { Colors } from "@/lib/theme"

/**
 * The article's chat, as a sheet over the reader: questions about the whole article and their
 * cited answers, newest at the bottom, the field under them. A citation closes the sheet and shows
 * its passage in the article (`onCite`). The web's `ChatPanel`.
 */
export function ChatSheet({
	visible,
	title,
	chat,
	written,
	allowance,
	canCite,
	onAsk,
	onRetry,
	onClear,
	onCopy,
	onCite,
	onClose,
	onDismiss,
	colors,
}: {
	visible: boolean
	/** The article's title. */
	title: string
	/** The article's chat, when it has one. */
	chat: AiCard | undefined
	written: AnswerStore
	allowance: AiAllowance | null
	/** Citations can be followed: the chat read the version on the page. */
	canCite: boolean
	onAsk: (question: string) => void
	onRetry: () => void
	onClear: () => void
	onCopy: (text: string) => void
	onCite: (citation: AiCitation) => void
	onClose: () => void
	/** After the sheet is gone, however it was closed. */
	onDismiss: () => void
	colors: Colors
}) {
	const streamed = useWritten(written, chat?.id ?? "")
	const { none } = questionsLeft(allowance)
	const state = chat ? cardState(chat, none) : null
	const busy = !!state?.busy
	const left = allowanceMessage(allowance)
	const cite = canCite ? onCite : undefined
	const keyboard = useKeyboardHeight()
	// The tools and the field under the turns: the toast shows above them.
	const [bottomHeight, setBottomHeight] = useState(110)
	const turns = useRef<ScrollView>(null)
	// The newest turn in view; the reader scrolling up keeps their place, until they ask again.
	const pinned = useRef(true)
	const count = chat?.messages.length ?? 0
	const shownCount = useRef(count)
	useEffect(() => {
		if (count > shownCount.current) {
			pinned.current = true
			turns.current?.scrollToEnd({ animated: true })
		}
		shownCount.current = count
	}, [count])
	// A question still waiting for its answer takes no new one; a refused one does.
	const asking = state ? state.canFollowUp : !none
	return (
		<Modal
			visible={visible}
			presentationStyle="pageSheet"
			animationType="slide"
			onRequestClose={onClose}
			onDismiss={onDismiss}
		>
			{/* A page sheet's bottom is the screen's: it makes room for the whole keyboard. (A
			    KeyboardAvoidingView measures from the sheet's top, and leaves the field under it.) */}
			<View style={[styles.sheet, { backgroundColor: colors.bg, paddingBottom: keyboard }]}>
				<View style={[styles.bar, { borderColor: colors.border }]}>
					<Text style={[styles.barTitle, { color: colors.fg }]}>Chat</Text>
					<Pressable accessibilityRole="button" onPress={onClose} hitSlop={12} style={styles.done}>
						<Text style={[styles.doneText, { color: colors.accent }]}>Done</Text>
					</Pressable>
				</View>
				<ScrollView
					ref={turns}
					style={styles.grow}
					contentContainerStyle={styles.content}
					keyboardShouldPersistTaps="handled"
					keyboardDismissMode="interactive"
					onContentSizeChange={() => {
						if (pinned.current) turns.current?.scrollToEnd({ animated: false })
					}}
					onScroll={(e) => {
						const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
						pinned.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 24
					}}
					scrollEventThrottle={64}
				>
					<Text style={[styles.title, { color: colors.mutedFg }]} numberOfLines={2}>
						{title}
					</Text>
					<View accessibilityLiveRegion="polite" style={styles.turns}>
						{!chat || chat.messages.length === 0 ? (
							<Text style={[styles.empty, { color: colors.mutedFg }]}>
								Ask anything about this article. Answers cite the parts they use.
							</Text>
						) : (
							<Turns card={chat} onCite={cite} colors={colors} />
						)}
						{busy ? (
							streamed.text ? (
								<AiAnswer
									text={streamed.text}
									citations={streamed.citations}
									onCite={cite}
									colors={colors}
								/>
							) : (
								<InkThinking label="Thinking…" colors={colors} style={styles.thinking} />
							)
						) : null}
						{chat?.failure && !busy ? (
							<Text accessibilityRole="alert" style={[styles.failure, { color: colors.danger }]}>
								{failureMessage(chat.failure, allowance)}
							</Text>
						) : null}
					</View>
				</ScrollView>
				<View
					onLayout={(e) => setBottomHeight(e.nativeEvent.layout.height)}
					style={[styles.bottom, { borderColor: colors.border, paddingBottom: keyboard ? 10 : 24 }]}
				>
					{chat && state && !busy ? (
						<View style={styles.tools}>
							{state.canRetry ? (
								<Tool
									label="Answer Again"
									symbol="arrow.clockwise"
									color={colors.accent}
									onPress={onRetry}
								/>
							) : null}
							{state.lastAnswer ? (
								<Tool
									label="Copy"
									symbol="doc.on.doc"
									color={colors.accent}
									onPress={() => state.lastAnswer && onCopy(plainAnswer(state.lastAnswer.text))}
								/>
							) : null}
							<Tool label="Clear Chat" symbol="trash" color={colors.danger} onPress={onClear} />
						</View>
					) : null}
					{asking ? (
						<QuestionField
							key={chat?.id ?? "new"}
							placeholder="Ask about this article…"
							onSend={onAsk}
							colors={colors}
						/>
					) : null}
					{left && !busy && chat?.failure?.code !== "limit_reached" ? (
						<Text style={[styles.left, { color: colors.mutedFg }]}>{left}</Text>
					) : null}
				</View>
			</View>
			{/* Over the sheet too: Clear Chat's Undo shows here. */}
			<ToastHost above={keyboard + bottomHeight + 8} />
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
	symbol: SymbolViewProps["name"]
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
	grow: { flex: 1 },
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
	content: { padding: 20, paddingBottom: 24, gap: 16 },
	title: { fontSize: 13, fontWeight: "600" },
	turns: { gap: 16 },
	empty: { fontFamily: "Iowan Old Style", fontSize: 17, fontStyle: "italic", lineHeight: 24 },
	thinking: { fontFamily: "Iowan Old Style", fontSize: 17, fontStyle: "italic" },
	failure: { fontSize: 15, lineHeight: 21 },
	bottom: {
		gap: 10,
		paddingHorizontal: 16,
		paddingTop: 10,
		borderTopWidth: StyleSheet.hairlineWidth,
	},
	tools: { flexDirection: "row", alignItems: "center", gap: 22, paddingHorizontal: 2 },
	tool: { flexDirection: "row", alignItems: "center", gap: 6 },
	toolText: { fontSize: 15 },
	pressed: { opacity: 0.6 },
	left: { fontSize: 13 },
})
