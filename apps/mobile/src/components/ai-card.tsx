import type { AiAllowance, AiCitation } from "@klipstack/sdk"
import { SymbolView, type SymbolViewProps } from "expo-symbols"
import { useEffect, useRef, useState } from "react"
import {
	AccessibilityInfo,
	Animated,
	Easing,
	Keyboard,
	KeyboardAvoidingView,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	useWindowDimensions,
	View,
	type ScrollViewInstance,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { AiAnswer } from "@/components/ai-answer"
import { InkThinking } from "@/components/ink-thinking"
import { allowanceMessage, failureMessage, questionsLeft } from "@/lib/ai"
import { plainAnswer } from "@/lib/ai-answer"
import { useWritten } from "@/lib/ai-cards"
import {
	type AiCard as Card,
	type AnswerStore,
	cardState,
	DRAFT_CHOICES,
	unasked,
} from "@/lib/ai-threads"
import { t } from "@/lib/i18n"
import type { Colors } from "@/lib/theme"

export const AI_ACTIONS: Record<
	Card["action"],
	{ label: string; symbol: SymbolViewProps["name"] }
> = {
	explain: { label: t("ai.actions.explain"), symbol: "lightbulb" },
	define: { label: t("ai.actions.define"), symbol: "book" },
	ask: { label: t("ai.actions.ask"), symbol: "questionmark.bubble" },
	chat: { label: t("ai.actions.chat"), symbol: "bubble.left.and.text.bubble.right" },
}

/** Asking AI about a passage, before choosing how: the selection menu's Ask, and the draft's head. */
const ASK_AI = { label: t("ai.actions.askAi"), symbol: "sparkles" } as const

/** The card's height without its turns: the action, the passage, the tools and the field. */
const CARD_CHROME = 230

/** How tall the keyboard is, 0 when it is down. */
export function useKeyboardHeight() {
	const [height, setHeight] = useState(0)
	useEffect(() => {
		const show = Keyboard.addListener("keyboardWillShow", (e) => setHeight(e.endCoordinates.height))
		const hide = Keyboard.addListener("keyboardWillHide", () => setHeight(0))
		return () => {
			show.remove()
			hide.remove()
		}
	}, [])
	return height
}

/** Questions offered under an empty field about a passage, for a reader without one in mind. */
const SUGGESTIONS = [
	t("ai.card.suggestions.example"),
	t("ai.card.suggestions.matters"),
	t("ai.card.suggestions.evidence"),
]

/**
 * A question about a passage and its answers, as a card at the bottom that leaves the article in
 * view, as the highlight's card does: the action, the passage, the turns, the answer streaming in
 * (the pen stroke until its first words), its citations, and Answer Again, Copy and Delete, then
 * a field for a follow-up. Asking opens a draft: Explain and Define, one tap each, above its
 * question field and suggestions; nothing is sent before. Not a modal: the
 * article above takes touches; a citation flashes its passage there. The web's `AiCard`.
 */
export function AiCard({
	card,
	written,
	allowance,
	canCite,
	onClose,
	onSend,
	onChoose,
	onRetry,
	onDelete,
	onCopy,
	onCite,
	onCover,
	colors,
}: {
	card: Card | null
	written: AnswerStore
	allowance: AiAllowance | null
	/** Citations can be followed: the answer read the version on the page. */
	canCite: boolean
	onClose: () => void
	/** Missing while AI answers are turned off: the card is read, copied and deleted only. */
	onSend?: (question: string) => void
	/** A draft becomes an Explain or a Define. */
	onChoose?: (action: (typeof DRAFT_CHOICES)[number]) => void
	onRetry?: () => void
	onDelete: () => void
	onCopy: (text: string) => void
	onCite: (citation: AiCitation) => void
	/** How much of the screen's bottom the card covers, keyboard included, as it changes. */
	onCover: (points: number) => void
	colors: Colors
}) {
	const insets = useSafeAreaInsets()
	const { height } = useWindowDimensions()
	// The card shown: the last one while it slides out.
	const [shown, setShown] = useState<Card | null>(card)
	if (card && card !== shown) setShown(card)
	const [slide] = useState(() => new Animated.Value(card ? 0 : 1))
	const [cardHeight, setCardHeight] = useState(320)
	const keyboard = useKeyboardHeight()
	const open = card !== null
	useEffect(() => {
		let live = true
		if (!open) Keyboard.dismiss()
		void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
			if (!live) return
			Animated.timing(slide, {
				toValue: open ? 0 : 1,
				duration: reduce ? 0 : open ? 260 : 200,
				easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
				useNativeDriver: true,
			}).start(({ finished }) => {
				if (finished && !open && live) setShown(null)
			})
		})
		return () => {
			live = false
		}
	}, [open, slide])
	if (!shown) return null
	const { label, symbol } = unasked(shown) ? ASK_AI : AI_ACTIONS[shown.action]
	return (
		<View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
			<KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={styles.bottom}>
				<Animated.View
					accessibilityViewIsModal={false}
					onLayout={(event) => {
						setCardHeight(event.nativeEvent.layout.height)
						onCover(height - event.nativeEvent.layout.y)
					}}
					style={[
						styles.card,
						{
							backgroundColor: colors.bg,
							borderColor: colors.border,
							paddingBottom: Math.max(insets.bottom, 16),
							transform: [
								{
									translateY: slide.interpolate({
										inputRange: [0, 1],
										outputRange: [0, cardHeight + 24],
									}),
								},
							],
						},
					]}
				>
					<View style={styles.top}>
						<View style={styles.action}>
							<SymbolView
								name={symbol}
								tintColor={colors.accent}
								size={16}
								accessibilityElementsHidden
							/>
							<Text style={[styles.actionText, { color: colors.accent }]}>{label}</Text>
						</View>
						<Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
							<Text style={[styles.done, { color: colors.accent }]}>
								{t("common.actions.done")}
							</Text>
						</Pressable>
					</View>
					<Text
						numberOfLines={2}
						style={[styles.passage, { color: colors.mutedFg, borderColor: colors.accent }]}
					>
						{t("ai.card.passage", { exact: shown.exact })}
					</Text>
					<CardBody
						key={shown.id}
						card={shown}
						written={written}
						allowance={allowance}
						canCite={canCite}
						// The card's other parts take about CARD_CHROME; with the keyboard up, the turns
						// get what is left under the navigation bar.
						maxHeight={Math.max(
							80,
							Math.min(height * 0.42, height - keyboard - insets.top - 44 - CARD_CHROME),
						)}
						onSend={onSend}
						onChoose={onChoose}
						onRetry={onRetry}
						onDelete={onDelete}
						onCopy={onCopy}
						onCite={onCite}
						colors={colors}
					/>
				</Animated.View>
			</KeyboardAvoidingView>
		</View>
	)
}

function CardBody({
	card,
	written,
	allowance,
	canCite,
	maxHeight,
	onSend,
	onChoose,
	onRetry,
	onDelete,
	onCopy,
	onCite,
	colors,
}: {
	card: Card
	written: AnswerStore
	allowance: AiAllowance | null
	canCite: boolean
	maxHeight: number
	/** Missing while AI answers are turned off: the card is read, copied and deleted only. */
	onSend?: (question: string) => void
	onChoose?: (action: (typeof DRAFT_CHOICES)[number]) => void
	onRetry?: () => void
	onDelete: () => void
	onCopy: (text: string) => void
	onCite: (citation: AiCitation) => void
	colors: Colors
}) {
	const streamed = useWritten(written, card.id)
	const { none } = questionsLeft(allowance)
	const { busy, lastAnswer, canRetry, canFollowUp } = cardState(card, none)
	const left = allowanceMessage(allowance)
	const turns = useRef<ScrollViewInstance>(null)
	// The newest turn in view; the reader scrolling up keeps their place.
	const pinned = useRef(true)
	const cite = canCite ? onCite : undefined
	return (
		<>
			{card.messages.length || busy || card.failure ? (
				<ScrollView
					ref={turns}
					style={{ maxHeight }}
					contentContainerStyle={styles.turns}
					onContentSizeChange={() => {
						if (pinned.current) turns.current?.scrollToEnd({ animated: false })
					}}
					onScroll={(e) => {
						const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
						pinned.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 24
					}}
					scrollEventThrottle={64}
					keyboardShouldPersistTaps="handled"
					keyboardDismissMode="interactive"
				>
					<View accessibilityLiveRegion="polite" style={styles.turns}>
						<Turns card={card} onCite={cite} colors={colors} />
						{busy ? (
							streamed.text ? (
								<AiAnswer
									text={streamed.text}
									citations={streamed.citations}
									onCite={cite}
									colors={colors}
								/>
							) : (
								<InkThinking
									label={t("ai.card.thinking")}
									colors={colors}
									style={styles.thinking}
								/>
							)
						) : null}
						{card.failure && !busy ? (
							<Text accessibilityRole="alert" style={[styles.failure, { color: colors.danger }]}>
								{failureMessage(card.failure, allowance)}
							</Text>
						) : null}
					</View>
				</ScrollView>
			) : null}
			{card.draft && onSend ? (
				<>
					{onChoose ? (
						<View style={styles.choices}>
							{DRAFT_CHOICES.map((action) => (
								<Pressable
									key={action}
									accessibilityRole="button"
									accessibilityLabel={AI_ACTIONS[action].label}
									onPress={() => onChoose(action)}
									style={({ pressed }) => [
										styles.choice,
										{ borderColor: colors.border },
										pressed && { backgroundColor: colors.muted },
									]}
								>
									<SymbolView
										name={AI_ACTIONS[action].symbol}
										tintColor={colors.accent}
										size={16}
									/>
									<Text style={[styles.choiceText, { color: colors.fg }]}>
										{AI_ACTIONS[action].label}
									</Text>
								</Pressable>
							))}
						</View>
					) : null}
					<QuestionField
						placeholder={t("ai.card.askPlaceholder")}
						autoFocus
						onSend={onSend}
						colors={colors}
					/>
					<View style={styles.suggestions}>
						{SUGGESTIONS.map((suggestion) => (
							<Pressable
								key={suggestion}
								accessibilityRole="button"
								onPress={() => onSend(suggestion)}
								style={({ pressed }) => [
									styles.suggestion,
									{ borderColor: colors.border },
									pressed && { backgroundColor: colors.muted },
								]}
							>
								<Text style={[styles.suggestionText, { color: colors.mutedFg }]}>{suggestion}</Text>
							</Pressable>
						))}
					</View>
				</>
			) : busy ? null : (
				<>
					<View style={styles.tools}>
						{canRetry && onRetry ? (
							<Tool
								label={t("ai.card.answerAgain")}
								symbol="arrow.clockwise"
								color={colors.accent}
								onPress={onRetry}
							/>
						) : null}
						{lastAnswer ? (
							<Tool
								label={t("ai.card.copy")}
								symbol="doc.on.doc"
								color={colors.accent}
								onPress={() => onCopy(plainAnswer(lastAnswer.text))}
							/>
						) : null}
						<Tool
							label={t("common.actions.delete")}
							symbol="trash"
							color={colors.danger}
							onPress={onDelete}
						/>
					</View>
					{canFollowUp && onSend ? (
						<QuestionField
							placeholder={t("ai.card.followUpPlaceholder")}
							onSend={onSend}
							colors={colors}
						/>
					) : null}
				</>
			)}
			{left && !busy && card.failure?.code !== "limit_reached" ? (
				<Text style={[styles.left, { color: colors.mutedFg }]}>{left}</Text>
			) : null}
		</>
	)
}

/** The thread's turns: the reader's questions in the notes' ink, the answers in the reader's type. */
export function Turns({
	card,
	onCite,
	colors,
}: {
	card: Card
	onCite?: (citation: AiCitation) => void
	colors: Colors
}) {
	return card.messages.map((message) =>
		message.role === "user" ? (
			message.text ? (
				<Text
					key={message.id}
					style={[styles.question, { color: colors.note.fg, borderColor: colors.nib.yellow }]}
				>
					{message.text}
				</Text>
			) : null
		) : message.status === "failed" ? (
			<Text key={message.id} style={[styles.failure, { color: colors.danger }]}>
				{t("ai.card.failed")}
			</Text>
		) : message.status === "refused" ? (
			<Text key={message.id} style={[styles.failure, { color: colors.mutedFg }]}>
				{t("ai.card.refused")}
			</Text>
		) : (
			<AiAnswer
				key={message.id}
				text={message.text}
				citations={message.citations}
				onCite={onCite}
				colors={colors}
			/>
		),
	)
}

/** A question, sent with the keyboard's Send or the arrow. */
export function QuestionField({
	placeholder,
	autoFocus = false,
	onSend,
	colors,
}: {
	placeholder: string
	autoFocus?: boolean
	onSend: (question: string) => void
	colors: Colors
}) {
	const [value, setValue] = useState("")
	const send = () => {
		if (!value.trim()) return
		onSend(value.trim())
		setValue("")
	}
	return (
		<View style={[styles.field, { borderColor: colors.border, backgroundColor: colors.card }]}>
			<TextInput
				accessibilityLabel={placeholder}
				value={value}
				onChangeText={setValue}
				placeholder={placeholder}
				placeholderTextColor={colors.mutedFg}
				autoFocus={autoFocus}
				multiline
				maxLength={2000}
				returnKeyType="send"
				submitBehavior="submit"
				onSubmitEditing={send}
				style={[styles.input, { color: colors.fg }]}
			/>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={t("ai.card.send")}
				disabled={!value.trim()}
				onPress={send}
				hitSlop={8}
				style={!value.trim() && styles.disabled}
			>
				<SymbolView name="arrow.up.circle.fill" tintColor={colors.accent} size={28} />
			</Pressable>
		</View>
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
			style={({ pressed }) => [styles.tool, pressed && styles.disabled]}
		>
			<SymbolView name={symbol} tintColor={color} size={17} />
			<Text style={[styles.toolText, { color }]}>{label}</Text>
		</Pressable>
	)
}

const styles = StyleSheet.create({
	bottom: { flex: 1, justifyContent: "flex-end" },
	card: {
		gap: 12,
		paddingTop: 14,
		paddingHorizontal: 16,
		borderTopLeftRadius: 20,
		borderTopRightRadius: 20,
		borderWidth: StyleSheet.hairlineWidth,
		shadowColor: "#000",
		shadowOpacity: 0.18,
		shadowRadius: 16,
		shadowOffset: { width: 0, height: -2 },
	},
	top: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingRight: 4,
	},
	action: { flexDirection: "row", alignItems: "center", gap: 6 },
	actionText: { fontSize: 15, fontWeight: "600" },
	done: { fontSize: 17, fontWeight: "600" },
	passage: {
		borderLeftWidth: 2,
		paddingLeft: 10,
		fontFamily: "Iowan Old Style",
		fontSize: 15,
		fontStyle: "italic",
		lineHeight: 21,
	},
	turns: { gap: 14 },
	question: {
		borderLeftWidth: 3,
		paddingLeft: 10,
		fontFamily: "Iowan Old Style",
		fontSize: 17,
		fontStyle: "italic",
		lineHeight: 23,
	},
	thinking: { fontFamily: "Iowan Old Style", fontSize: 17, fontStyle: "italic" },
	failure: { fontSize: 15, lineHeight: 21 },
	tools: { flexDirection: "row", alignItems: "center", gap: 22, paddingHorizontal: 2 },
	tool: { flexDirection: "row", alignItems: "center", gap: 6 },
	toolText: { fontSize: 15 },
	field: {
		flexDirection: "row",
		alignItems: "flex-end",
		gap: 8,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 18,
		paddingLeft: 14,
		paddingRight: 6,
		paddingVertical: 6,
	},
	input: { flex: 1, maxHeight: 120, fontSize: 16, paddingTop: 5, paddingBottom: 5 },
	disabled: { opacity: 0.4 },
	choices: { flexDirection: "row", gap: 8 },
	choice: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 6,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 12,
		paddingVertical: 10,
	},
	choiceText: { fontSize: 15, fontWeight: "500" },
	suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	suggestion: {
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 999,
		paddingHorizontal: 12,
		paddingVertical: 6,
	},
	suggestionText: { fontSize: 14 },
	left: { fontSize: 13 },
})
