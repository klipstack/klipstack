import type { KlipstackClient, Topic } from "@klipstack/sdk"
import { router, useFocusEffect } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useCallback, useRef, useState } from "react"
import {
	ActionSheetIOS,
	ActivityIndicator,
	Pressable,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from "react-native"
import { EmptyDrawing } from "@/components/empty-drawing"
import { removeTopic, renameTopic } from "@/components/topic-actions"
import { Proposal, TurnOff, TurnOn } from "@/components/topic-stages"
import { useAuth } from "@/lib/auth"
import { type Colors, useColors, useScheme } from "@/lib/theme"
import {
	articles,
	PHONE_SHELF,
	phoneShelf,
	spine,
	type TopicsAnswer,
	topicsBusy,
	topicsNotice,
} from "@/lib/topic-shelves"

const BUSY_EVERY_MS = 5000

/**
 * The reader's topics, as the web's Topics page shows them on a phone, in whichever stage they
 * are: the offer to turn them on, how far the first ones are, the first ones to confirm, and then
 * each topic a shelf: its name, its size, and a book per article, newest first, a full shelf
 * ending in how many more. A book is too narrow to aim at, so a tap anywhere on a topic opens its
 * articles; its ⋯ (or a long press) renames or removes it. Turning topics off ends the screen.
 * Loaded on each return here: topics change as the library grows; and every few seconds while the
 * server proposes or sorts them.
 */
export default function Topics() {
	const colors = useColors()
	const { state } = useAuth()
	const client = state.status === "signed-in" ? state.client : null
	// The answer, and when it came: "saved this week" counts from then.
	const [loaded, setLoaded] = useState<{ answer: TopicsAnswer; at: Date } | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [refreshing, setRefreshing] = useState(false)
	const asked = useRef(0)
	const load = useCallback(async () => {
		if (!client) return
		const mine = ++asked.current
		try {
			const next = await client.topics.list({ latest: PHONE_SHELF })
			if (mine !== asked.current) return
			setLoaded({ answer: next, at: new Date() })
			setError(null)
		} catch (e) {
			if (mine === asked.current) setError(e instanceof Error ? e.message : String(e))
		}
	}, [client])
	const reload = useCallback(() => void load(), [load])
	const answer = loaded?.answer ?? null
	// While the server proposes or sorts, every 5 seconds, as the web's page; only while in view.
	const busy = answer ? topicsBusy(answer) : false
	useFocusEffect(
		useCallback(() => {
			void load()
			if (!busy) return
			const id = setInterval(() => void load(), BUSY_EVERY_MS)
			return () => clearInterval(id)
		}, [load, busy]),
	)

	const notice = answer ? topicsNotice(answer) : null
	const stage = answer?.stage
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			keyboardDismissMode="interactive"
			keyboardShouldPersistTaps="handled"
			automaticallyAdjustKeyboardInsets
			contentContainerStyle={styles.page}
			refreshControl={
				<RefreshControl
					refreshing={refreshing}
					onRefresh={() => {
						setRefreshing(true)
						void load().finally(() => setRefreshing(false))
					}}
				/>
			}
		>
			{error && !answer ? (
				<Text style={[styles.message, { color: colors.mutedFg }]}>{error}</Text>
			) : !answer || !client ? (
				<ActivityIndicator style={styles.loading} color={colors.mutedFg} />
			) : stage === "unavailable" ? (
				<Text style={[styles.message, { color: colors.mutedFg }]}>
					Topics are not turned on for your account.
				</Text>
			) : (
				<>
					{/* No shelves yet: one, empty, waiting for them. */}
					{answer.items.length === 0 && stage !== "proposed" ? <EmptyDrawing name="shelf" /> : null}
					<Text style={[styles.noticeBody, { color: colors.mutedFg }]}>
						Topics sort what you save into shelves on their own: proposed from your library, kept up
						to date as you read.
					</Text>
					{stage === "off" ? (
						<TurnOn client={client} answer={answer} colors={colors} onDone={reload} />
					) : null}
					{stage === "proposed" ? (
						<Proposal client={client} answer={answer} colors={colors} onDone={reload} />
					) : null}
					{notice ? (
						<View style={styles.notice} testID="topics-notice">
							{notice.title ? (
								<Text style={[styles.noticeTitle, { color: colors.fg }]}>{notice.title}</Text>
							) : null}
							<Text style={[styles.noticeBody, { color: colors.mutedFg }]}>{notice.body}</Text>
							{stage === "waiting" && answer.progress ? (
								<View
									style={[styles.track, { backgroundColor: colors.muted }]}
									accessibilityRole="progressbar"
									accessibilityValue={{
										min: 0,
										max: answer.progress.needed,
										now: answer.progress.count,
									}}
								>
									<View
										style={[
											styles.bar,
											{
												backgroundColor: colors.accent,
												width: `${Math.min(100, (100 * answer.progress.count) / Math.max(1, answer.progress.needed))}%`,
											},
										]}
									/>
								</View>
							) : null}
						</View>
					) : null}
					{answer.items.map((topic) => (
						<Shelf
							key={topic.id}
							topic={topic}
							now={loaded!.at}
							colors={colors}
							onMenu={() => topicMenu(client, topic, reload)}
							onOpen={() => void client.topics.countUse("topic_opened").catch(() => {})}
						/>
					))}
					{answer.items.length ? (
						<Text style={[styles.legend, { color: colors.mutedFg }]}>
							One book per article, thicker for a longer read. A blue top: saved this week.
						</Text>
					) : null}
					{stage === "off" ? null : <TurnOff client={client} colors={colors} onDone={reload} />}
				</>
			)}
		</ScrollView>
	)
}

/** A topic's ⋯: Rename and Remove, as the web's topic menu. */
function topicMenu(client: KlipstackClient, topic: Topic, done: () => void) {
	ActionSheetIOS.showActionSheetWithOptions(
		{
			title: topic.name,
			options: ["Rename…", "Remove Topic…", "Cancel"],
			destructiveButtonIndex: 1,
			cancelButtonIndex: 2,
		},
		(index) => {
			if (index === 0) renameTopic(client, topic, done)
			else if (index === 1) removeTopic(client, topic, done)
		},
	)
}

/** A topic as a shelf: one target, the topic's articles. */
function Shelf({
	topic,
	now,
	colors,
	onMenu,
	onOpen,
}: {
	topic: Topic
	now: Date
	colors: Colors
	onMenu: () => void
	onOpen: () => void
}) {
	const scheme = useScheme()
	const { books, more } = phoneShelf(topic)
	const open = () => {
		onOpen()
		router.push({
			pathname: "/library/topics/[id]",
			params: { id: topic.id, name: topic.name, description: topic.description },
		})
	}
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${topic.name}, ${articles(topic.articles)}${
				topic.savedThisWeek ? `, ${topic.savedThisWeek} new` : ""
			}`}
			accessibilityHint="Opens the topic's articles"
			accessibilityActions={[{ name: "menu", label: "Rename or remove" }]}
			onAccessibilityAction={(e) => {
				if (e.nativeEvent.actionName === "menu") onMenu()
			}}
			onPress={open}
			onLongPress={onMenu}
		>
			{({ pressed }) => (
				<View style={pressed && styles.pressed}>
					<View style={styles.head}>
						<Text style={[styles.name, { color: colors.fg }]} numberOfLines={2}>
							{topic.name}
						</Text>
						<Text style={[styles.count, { color: colors.mutedFg }]}>
							{articles(topic.articles)}
						</Text>
						{topic.savedThisWeek ? (
							<View style={styles.recentBadge}>
								<View style={[styles.dot, { backgroundColor: colors.shelf.recent }]} />
								<Text style={[styles.recentText, { color: colors.shelf.recent }]}>
									{topic.savedThisWeek} new
								</Text>
							</View>
						) : null}
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={`More for ${topic.name}`}
							hitSlop={12}
							onPress={onMenu}
							style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
						>
							<SymbolView name="ellipsis.circle" tintColor={colors.mutedFg} size={22} />
						</Pressable>
					</View>
					<View style={[styles.shelf, { borderBottomColor: colors.shelf.board }]}>
						{books.map((book) => {
							const s = spine(book, scheme, now)
							return (
								<View
									key={book.id}
									style={[
										styles.book,
										{ width: s.width, height: s.height, backgroundColor: s.color },
										s.recent && { borderTopWidth: 4, borderTopColor: colors.shelf.recent },
									]}
								>
									{/* The title down the spine: a row as long as the book is tall, turned. */}
									<Text
										numberOfLines={1}
										style={[
											styles.spineText,
											{
												color: colors.shelf.bookFg,
												width: s.height - 16,
												left: (s.width - (s.height - 16)) / 2,
												top: (s.height - 16) / 2 - 6,
											},
										]}
									>
										{s.label}
									</Text>
								</View>
							)
						})}
						{more > 0 ? (
							<View
								style={[
									styles.more,
									{ borderColor: colors.mutedFg, backgroundColor: colors.muted },
								]}
							>
								<Text style={[styles.moreText, { color: colors.fg }]}>+{more}</Text>
							</View>
						) : null}
					</View>
				</View>
			)}
		</Pressable>
	)
}

const styles = StyleSheet.create({
	page: { padding: 16, gap: 28 },
	message: { padding: 16, textAlign: "center", fontSize: 16, lineHeight: 22 },
	loading: { paddingVertical: 32 },
	notice: { gap: 6 },
	noticeTitle: { fontSize: 17, fontWeight: "600" },
	noticeBody: { fontSize: 15, lineHeight: 21 },
	head: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: 10 },
	menuButton: { marginLeft: "auto", alignSelf: "center" },
	track: { height: 8, borderRadius: 4, overflow: "hidden", marginTop: 4 },
	bar: { height: 8, borderRadius: 4 },
	name: { fontFamily: "Georgia", fontSize: 21, fontWeight: "600", flexShrink: 1 },
	count: { fontSize: 14 },
	recentBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
	dot: { width: 6, height: 6, borderRadius: 3 },
	recentText: { fontSize: 12, fontWeight: "500" },
	shelf: {
		marginTop: 8,
		minHeight: 128,
		flexDirection: "row",
		alignItems: "flex-end",
		gap: 2,
		paddingHorizontal: 6,
		borderBottomWidth: 7,
		overflow: "hidden",
	},
	book: {
		borderTopLeftRadius: 3,
		borderTopRightRadius: 3,
		borderBottomLeftRadius: 1,
		borderBottomRightRadius: 1,
		overflow: "hidden",
	},
	spineText: {
		position: "absolute",
		fontSize: 11,
		lineHeight: 12,
		fontWeight: "500",
		transform: [{ rotate: "90deg" }],
	},
	more: {
		width: 34,
		height: 96,
		borderWidth: 1,
		borderStyle: "dashed",
		borderTopLeftRadius: 3,
		borderTopRightRadius: 3,
		alignItems: "center",
		justifyContent: "center",
	},
	moreText: { fontSize: 13, fontWeight: "600" },
	legend: { fontSize: 13, lineHeight: 18 },
	pressed: { opacity: 0.6 },
})
