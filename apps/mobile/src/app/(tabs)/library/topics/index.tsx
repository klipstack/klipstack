import type { Topic } from "@klipstack/sdk"
import { router, useFocusEffect } from "expo-router"
import { useCallback, useRef, useState } from "react"
import {
	ActivityIndicator,
	Linking,
	Pressable,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from "react-native"
import { useAuth } from "@/lib/auth"
import { DEFAULT_API_URL } from "@/lib/config"
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
 * The reader's topics as shelves, as the web's Topics page shows them on a phone: each topic its
 * name, its size, and a book per article, newest first, a full shelf ending in how many more. A
 * book is too narrow to aim at, so a tap anywhere on a topic opens its articles. Read-only: turning
 * topics on, confirming, renaming and removing them are the web's, and the screen says so where it
 * matters. Loaded on each return here: topics change as the library grows; and every few seconds
 * while the server proposes or sorts them.
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
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			style={{ backgroundColor: colors.bg }}
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
			) : !answer ? (
				<ActivityIndicator style={styles.loading} color={colors.mutedFg} />
			) : (
				<>
					{notice ? (
						<View style={styles.notice}>
							{notice.title ? (
								<Text style={[styles.noticeTitle, { color: colors.fg }]}>{notice.title}</Text>
							) : null}
							<Text style={[styles.noticeBody, { color: colors.mutedFg }]}>{notice.body}</Text>
							{notice.web ? (
								<Pressable
									accessibilityRole="link"
									hitSlop={8}
									onPress={() => void Linking.openURL(`${DEFAULT_API_URL}/topics`)}
								>
									{({ pressed }) => (
										<Text
											style={[
												styles.noticeBody,
												{ color: colors.accent },
												pressed && styles.pressed,
											]}
										>
											Open Topics on the web
										</Text>
									)}
								</Pressable>
							) : null}
						</View>
					) : null}
					{answer.items.map((topic) => (
						<Shelf key={topic.id} topic={topic} now={loaded!.at} colors={colors} />
					))}
					{answer.items.length ? (
						<Text style={[styles.legend, { color: colors.mutedFg }]}>
							One book per article, thicker for a longer read. A blue top: saved this week. Rename
							or remove topics on the web.
						</Text>
					) : null}
				</>
			)}
		</ScrollView>
	)
}

/** A topic as a shelf: one target, the topic's articles. */
function Shelf({ topic, now, colors }: { topic: Topic; now: Date; colors: Colors }) {
	const scheme = useScheme()
	const { books, more } = phoneShelf(topic)
	const open = () =>
		router.push({
			pathname: "/library/topics/[id]",
			params: { id: topic.id, name: topic.name, description: topic.description },
		})
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${topic.name}, ${articles(topic.articles)}${
				topic.savedThisWeek ? `, ${topic.savedThisWeek} new` : ""
			}`}
			accessibilityHint="Opens the topic's articles"
			onPress={open}
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
