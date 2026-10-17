import { TOPIC_NAME_MAX } from "@klipstack/api-contract/names"
import type { KlipstackClient } from "@klipstack/sdk"
import { SymbolView } from "expo-symbols"
import { useEffect, useState } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native"
import { turnOffTopics } from "@/components/topic-actions"
import { showToast } from "@/lib/article-changes"
import type { Colors } from "@/lib/theme"
import {
	confirmation,
	type ProposalEdits,
	topicRefusal,
	type TopicsAnswer,
} from "@/lib/topic-shelves"

/**
 * The Topics screen's stages that ask something of the reader, as the web's Topics page shows
 * them: the offer to turn topics on, the first topics to confirm, and the way to turn them off.
 */

/** Topics off: what they are, where the text goes, and the button. Seeing it ends Home's invitation. */
export function TurnOn({
	client,
	answer,
	colors,
	onDone,
}: {
	client: KlipstackClient
	answer: TopicsAnswer
	colors: Colors
	onDone: () => void
}) {
	const [busy, setBusy] = useState(false)
	const invited = answer.invitation === true
	useEffect(() => {
		if (invited) void client.topics.endInvitation().catch(() => {})
	}, [client, invited])
	const needed = answer.progress?.needed ?? 25
	const enable = () => {
		setBusy(true)
		client.topics
			.enable()
			.then(onDone)
			.catch((e: unknown) => showToast({ message: `Not turned on: ${topicRefusal(e)}` }))
			.finally(() => setBusy(false))
	}
	return (
		<View style={[styles.box, { borderColor: colors.border }]} testID="topics-off">
			<View style={styles.titleRow}>
				<SymbolView
					name="books.vertical"
					tintColor={colors.accent}
					size={18}
					accessibilityElementsHidden
				/>
				<Text style={[styles.title, { color: colors.fg }]}>Let your library sort itself</Text>
			</View>
			<Text style={[styles.body, { color: colors.fg }]}>
				Once you have saved {needed} articles, Klipstack proposes topics from what you read: the
				sections your library would have in a bookstore, like Software Engineering, Startups or
				Writing. You look them over once. After that, each article you save lands in its topics on
				its own, and new topics appear as your reading changes.
			</Text>
			<Text style={[styles.body, { color: colors.mutedFg }]}>
				To sort your articles, their text is sent to TypeSafe and to Anthropic. Turning topics off
				deletes them.
			</Text>
			<PrimaryButton label="Turn On Topics" busy={busy} onPress={enable} colors={colors} />
		</View>
	)
}

/** The first topics: keep, rename or drop each, then confirm once. Opening them is seeing them. */
export function Proposal({
	client,
	answer,
	colors,
	onDone,
}: {
	client: KlipstackClient
	answer: TopicsAnswer
	colors: Colors
	onDone: () => void
}) {
	const proposed = answer.proposed ?? []
	const [edits, setEdits] = useState<ProposalEdits>({})
	const [busy, setBusy] = useState(false)
	useEffect(() => {
		void client.topics.seen().catch(() => {})
	}, [client])
	if (!proposed.length)
		return (
			<Text style={[styles.body, { color: colors.mutedFg }]} testID="topics-none">
				No topics came out of your library this time. More will be proposed as you save more
				articles.
			</Text>
		)
	const edit = (id: string, change: Partial<ProposalEdits[string]>, name: string) =>
		setEdits((now) => ({ ...now, [id]: { ...(now[id] ?? { kept: true, name }), ...change } }))
	const confirm = () => {
		setBusy(true)
		client.topics
			.confirm(confirmation(proposed, edits))
			.then(onDone)
			.catch((e: unknown) => showToast({ message: `Not confirmed: ${topicRefusal(e)}` }))
			.finally(() => setBusy(false))
	}
	return (
		<View style={styles.proposal} testID="topics-proposal">
			<Text style={[styles.title, { color: colors.fg }]}>Your first topics</Text>
			<Text style={[styles.body, { color: colors.mutedFg }]}>
				Proposed from your library. Rename any of them, uncheck the ones you don't want, and
				confirm. From then on, topics keep themselves up to date.
			</Text>
			{proposed.map((topic) => {
				const kept = edits[topic.id]?.kept ?? true
				return (
					<View
						key={topic.id}
						style={[
							styles.proposed,
							{ borderColor: colors.border, backgroundColor: colors.card },
							!kept && styles.dropped,
						]}
					>
						<Pressable
							accessibilityRole="checkbox"
							accessibilityState={{ checked: kept }}
							accessibilityLabel={`Keep ${topic.name}`}
							hitSlop={10}
							onPress={() => edit(topic.id, { kept: !kept }, topic.name)}
						>
							<SymbolView
								name={kept ? "checkmark.circle.fill" : "circle"}
								tintColor={kept ? colors.accent : colors.mutedFg}
								size={24}
							/>
						</Pressable>
						<View style={styles.proposedText}>
							<TextInput
								accessibilityLabel={`Name of the topic ${topic.name}`}
								defaultValue={topic.name}
								editable={kept}
								maxLength={TOPIC_NAME_MAX}
								autoCorrect={false}
								returnKeyType="done"
								onChangeText={(name) => edit(topic.id, { name }, topic.name)}
								style={[styles.nameField, { color: colors.fg, borderColor: colors.border }]}
							/>
							<Text style={[styles.description, { color: colors.mutedFg }]}>
								{topic.description}
							</Text>
						</View>
					</View>
				)
			})}
			<PrimaryButton label="Confirm Topics" busy={busy} onPress={confirm} colors={colors} />
		</View>
	)
}

/** At the end of the screen while topics are on: it asks first, as turning off deletes them. */
export function TurnOff({
	client,
	colors,
	onDone,
}: {
	client: KlipstackClient
	colors: Colors
	onDone: () => void
}) {
	return (
		<View style={[styles.turnOff, { borderTopColor: colors.border }]}>
			<Pressable
				accessibilityRole="button"
				hitSlop={8}
				onPress={() => void turnOffTopics(client, onDone)}
			>
				{({ pressed }) => (
					<Text style={[styles.turnOffText, { color: colors.danger }, pressed && styles.pressed]}>
						Turn Off Topics
					</Text>
				)}
			</Pressable>
		</View>
	)
}

function PrimaryButton({
	label,
	busy,
	onPress,
	colors,
}: {
	label: string
	busy: boolean
	onPress: () => void
	colors: Colors
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ busy, disabled: busy }}
			disabled={busy}
			onPress={onPress}
			style={({ pressed }) => [
				styles.button,
				{ backgroundColor: colors.accent },
				(pressed || busy) && styles.pressed,
			]}
		>
			{busy ? (
				<ActivityIndicator color={colors.accentFg} />
			) : (
				<Text style={[styles.buttonText, { color: colors.accentFg }]}>{label}</Text>
			)}
		</Pressable>
	)
}

const styles = StyleSheet.create({
	box: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 10 },
	titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
	title: { fontSize: 17, fontWeight: "600" },
	body: { fontSize: 15, lineHeight: 21 },
	proposal: { gap: 12 },
	proposed: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 12,
		borderWidth: 1,
		borderRadius: 14,
		padding: 14,
	},
	dropped: { opacity: 0.5 },
	proposedText: { flex: 1, gap: 8 },
	nameField: {
		fontSize: 17,
		fontWeight: "600",
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 8,
		paddingHorizontal: 10,
		paddingVertical: 7,
	},
	description: { fontSize: 14, lineHeight: 19 },
	button: {
		alignSelf: "flex-start",
		minWidth: 160,
		alignItems: "center",
		borderRadius: 999,
		paddingHorizontal: 18,
		paddingVertical: 10,
		marginTop: 4,
	},
	buttonText: { fontSize: 16, fontWeight: "600" },
	turnOff: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, marginTop: 8 },
	turnOffText: { fontSize: 16 },
	pressed: { opacity: 0.6 },
})
