import type { ArticleSummary, Topic } from "@klipstack/sdk"
import { router, useFocusEffect } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useCallback, useMemo, useRef, useState } from "react"
import {
	ActionSheetIOS,
	ActivityIndicator,
	AppState,
	FlatList,
	Pressable,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Text,
	useWindowDimensions,
	View,
} from "react-native"
import { useArticleActions } from "@/components/article-actions"
import {
	ArticleCard,
	CARD_FRAME,
	type CardMenu,
	CardPicture,
	ProgressBar,
	Starred,
	Tappable,
	useImageHeaders,
} from "@/components/article-card"
import { ClipboardOffer } from "@/components/clipboard-offer"
import { useTagSheet } from "@/components/tag-sheet"
import { onChange, settled } from "@/lib/article-changes"
import { articleMeta } from "@/lib/article-meta"
import { useAuth } from "@/lib/auth"
import { type HomeSections, homeSections, minutesLeft, withChanges, withTags } from "@/lib/home"
import {
	type HomeTopicChoice,
	homeTopicChoice,
	type TopicPick,
	topicHeading,
} from "@/lib/home-topics"
import { topicEnded } from "@/lib/library-topics"
import { canUseOffline, loadList, OFFLINE_NOTE, saveList } from "@/lib/offline"
import { downloadAhead, keepLibraryLists } from "@/lib/offline-download"
import { type Colors, useColors } from "@/lib/theme"
import { chooseTopic } from "@/lib/topic-choices"

/**
 * The home page, as the web's: a big card to continue reading (or, with nothing in progress, to
 * start the newest save), then shelves of more in progress, recent saves and short reads. A long
 * press on an article opens its menu, as in the library.
 *
 * For a reader with topics, "About what?" above them, as on the web: a topic narrows every section
 * to its articles (the lists' `topic`), and says what is left in it, with the way to all of it on
 * the Topics screen. Something different is the topic read from least lately. Only Home without a
 * topic is kept for offline reading.
 */
export default function Home() {
	const { state } = useAuth()
	const colors = useColors()
	const headers = useImageHeaders()
	const client = state.status === "signed-in" ? state.client : null
	const [home, setHome] = useState<HomeSections | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [refreshing, setRefreshing] = useState(false)
	const generation = useRef(0)
	// The reader's topics (none while off or not loaded), and the one Home narrows to.
	const [topics, setTopics] = useState<Topic[]>([])
	const [pick, setPick] = useState<TopicPick>(null)
	const choice = homeTopicChoice(topics, pick)
	const chosen = choice?.chosen ?? null
	const topic = chosen?.topic.id

	const load = useCallback(async () => {
		if (!client) return
		const mine = ++generation.current
		// Alongside, and never in the way: Home without them is Home without the choice.
		void client.topics
			.list()
			.then((answer) => {
				if (mine === generation.current) setTopics(answer.items)
			})
			.catch(() => {})
		try {
			// After a closing reader's change lands (src/lib/article-changes.ts).
			await settled()
			// More than a shelf shows: the sections drop what isn't ready or shows above.
			const [reading, unread, quick] = await Promise.all([
				client.articles.list({ view: "inbox", filter: "progress", limit: 12, topic }),
				client.articles.list({
					view: "inbox",
					filter: "unread",
					sort: "newest",
					limit: 20,
					topic,
				}),
				client.articles.list({ view: "inbox", filter: "quick", limit: 30, topic }),
			])
			if (mine !== generation.current) return
			const sections = homeSections({
				reading: reading.items,
				unread: unread.items,
				quick: quick.items,
			})
			setHome(sections)
			setError(null)
			// One topic's share is not Home to keep: offline, and on the widget, Home is all of it.
			if (topic) return
			// Kept for offline reading, with Inbox's and Starred's first pages (src/lib/offline.ts).
			saveList("home-reading", reading.items)
			saveList("home-unread", unread.items)
			saveList("home-quick", quick.items)
			void downloadAhead(client, "home", [
				...(sections.hero ? [sections.hero] : []),
				...sections.reading,
				...sections.recent,
				...sections.quick,
			])
			keepLibraryLists(client)
		} catch (e) {
			if (mine !== generation.current) return
			// The topic ended, or topics were turned off: Home shows everything again.
			if (topicEnded(topic ?? null, e)) return setPick(null)
			if (canUseOffline(e)) {
				const [reading, unread, quick] = [
					loadList("home-reading"),
					loadList("home-unread"),
					loadList("home-quick"),
				]
				if (reading && unread && quick)
					setHome((shown) => shown ?? homeSections({ reading, unread, quick }))
				setError(OFFLINE_NOTE)
				return
			}
			setError(e instanceof Error ? e.message : String(e))
		}
	}, [client, topic])

	// Again on each return to the tab and to the app: reading moves articles between sections.
	useFocusEffect(
		useCallback(() => {
			void load()
			const sub = AppState.addEventListener("change", (appState) => {
				if (appState === "active") void load()
			})
			const off = onChange(() => void load())
			return () => {
				sub.remove()
				off()
			}
		}, [load]),
	)

	// Finishing or marking unread moves an article between sections: Home loads again after.
	const act = useArticleActions({
		client,
		apply: (changed) => {
			generation.current++
			setHome((shown) => shown && withChanges(shown, changed))
		},
		done: () => void load(),
		reload: () => void load(),
	})
	const tags = useTagSheet(client, (changed) =>
		setHome((shown) => shown && withTags(shown, changed)),
	)
	const openTags = tags.open
	const menu = useMemo<CardMenu>(
		() => ({ act: (item, action) => act(action, [item]), tag: (item) => openTags([item]) }),
		[act, openTags],
	)

	async function onRefresh() {
		setRefreshing(true)
		await load()
		setRefreshing(false)
	}

	const empty = home && !home.hero && !home.quick.length
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			style={{ backgroundColor: colors.bg }}
			contentContainerStyle={styles.page}
			refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
		>
			<ClipboardOffer client={client} onSaved={() => void load()} colors={colors} />
			{choice ? <AboutWhat choice={choice} pick={pick} onPick={setPick} colors={colors} /> : null}
			{chosen ? <TopicHeading chosen={chosen} colors={colors} /> : null}
			{home && error ? (
				<Text style={[styles.inset, styles.banner, { color: colors.mutedFg }]}>{error}</Text>
			) : null}
			{!home ? (
				error ? (
					<Text style={[styles.message, { color: colors.mutedFg }]}>{error}</Text>
				) : (
					<ActivityIndicator style={styles.loading} color={colors.mutedFg} />
				)
			) : empty && chosen ? (
				<Text style={[styles.inset, styles.message, { color: colors.mutedFg }]}>
					Nothing in {chosen.topic.name} to read right now.
				</Text>
			) : empty ? (
				<View style={styles.emptyState}>
					<SymbolView
						name="square.and.arrow.up"
						tintColor={colors.mutedFg}
						size={36}
						accessibilityElementsHidden
					/>
					<Text style={[styles.emptyTitle, { color: colors.fg }]}>Your next read starts here</Text>
					<Text style={[styles.message, { color: colors.mutedFg }]}>
						Share an article to Klipstack from Safari or any app, or tap + to paste a link. It will
						be here when you're ready to read.
					</Text>
				</View>
			) : (
				<>
					{home.hero ? (
						<Section
							title={home.hero.progress > 0 ? "Continue reading" : "Up next"}
							colors={colors}
						>
							<Hero item={home.hero} colors={colors} headers={headers} menu={menu} />
							<Shelf items={home.reading} colors={colors} headers={headers} menu={menu} />
						</Section>
					) : null}
					{home.recent.length ? (
						<Section
							title="Recently saved"
							onMore={() => {
								// Inbox, in the same topic.
								chooseTopic("inbox", topic ?? null)
								router.navigate("/library/inbox", { withAnchor: true })
							}}
							colors={colors}
						>
							<Shelf items={home.recent} colors={colors} headers={headers} menu={menu} />
						</Section>
					) : null}
					{home.quick.length ? (
						// QUICK_MAX_MINUTES in apps/web/app/lib/inbox-filters.ts.
						<Section title="A few minutes to read" note="Ten minutes or less." colors={colors}>
							<Shelf items={home.quick} colors={colors} headers={headers} menu={menu} />
						</Section>
					) : null}
				</>
			)}
			{/* A sheet of its own, over the screen: its place here doesn't matter. */}
			{tags.sheet}
		</ScrollView>
	)
}

/**
 * "About what?": Anything, the biggest topics, something different, and More for the rest, in one
 * line scrolled sideways, so Home's sections stay in view. The chosen one is filled.
 */
function AboutWhat({
	choice,
	pick,
	onPick,
	colors,
}: {
	choice: HomeTopicChoice
	pick: TopicPick
	onPick: (next: TopicPick) => void
	colors: Colors
}) {
	const chip = (key: string, label: string, on: boolean, next: TopicPick) => (
		<Pressable
			key={key}
			accessibilityRole="button"
			accessibilityState={{ selected: on }}
			onPress={() => {
				if (!on) onPick(next)
			}}
			style={({ pressed }) => [
				styles.chip,
				{
					borderColor: on ? colors.fg : colors.border,
					backgroundColor: on ? colors.fg : colors.bg,
				},
				pressed && styles.pressed,
			]}
		>
			<Text style={[styles.chipText, { color: on ? colors.bg : colors.fg }]}>{label}</Text>
		</Pressable>
	)
	const more = () =>
		ActionSheetIOS.showActionSheetWithOptions(
			{
				title: "More topics",
				options: [...choice.more.map((t) => t.name), "Cancel"],
				cancelButtonIndex: choice.more.length,
			},
			(index) => {
				const topic = choice.more[index]
				if (topic) onPick({ id: topic.id, different: false })
			},
		)
	return (
		<View style={styles.about}>
			<Text style={[styles.inset, styles.aboutTitle, { color: colors.mutedFg }]}>About what?</Text>
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.chips}
			>
				{chip("any", "Anything", !pick, null)}
				{choice.chips.map((t) =>
					chip(t.id, t.name, pick?.id === t.id && !pick.different, { id: t.id, different: false }),
				)}
				{choice.different
					? chip("different", "Something different", !!pick?.different, {
							id: choice.different,
							different: true,
						})
					: null}
				{choice.more.length ? (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="More topics"
						onPress={more}
						style={({ pressed }) => [
							styles.chip,
							styles.moreChip,
							{ borderColor: colors.border },
							pressed && styles.pressed,
						]}
					>
						<Text style={[styles.chipText, { color: colors.fg }]}>More</Text>
						<SymbolView
							name="chevron.down"
							tintColor={colors.mutedFg}
							size={12}
							accessibilityElementsHidden
						/>
					</Pressable>
				) : null}
			</ScrollView>
		</View>
	)
}

/** The chosen topic: its name, why it is here, and the way to all of it on the Topics screen. */
function TopicHeading({
	chosen,
	colors,
}: {
	chosen: NonNullable<HomeTopicChoice["chosen"]>
	colors: Colors
}) {
	const { title, line, all } = topicHeading(chosen)
	const { topic } = chosen
	return (
		<View style={[styles.topicHeading, { borderBottomColor: colors.border }]}>
			<Text style={[styles.topicTitle, { color: colors.fg }]}>{title}</Text>
			<Text style={[styles.note, { color: colors.mutedFg }]}>{line}</Text>
			<Pressable
				accessibilityRole="link"
				hitSlop={8}
				onPress={() =>
					router.navigate(
						{
							pathname: "/library/topics/[id]",
							params: { id: topic.id, name: topic.name, description: topic.description },
						},
						{ withAnchor: true },
					)
				}
			>
				{({ pressed }) => (
					<Text style={[styles.note, { color: colors.accent }, pressed && styles.pressed]}>
						{all} →
					</Text>
				)}
			</Pressable>
		</View>
	)
}

function Section({
	title,
	note,
	onMore,
	colors,
	children,
}: {
	title: string
	note?: string
	onMore?: () => void
	colors: Colors
	children: React.ReactNode
}) {
	const heading = (
		<View style={styles.heading}>
			<Text style={[styles.sectionTitle, { color: colors.fg }]}>{title}</Text>
			{onMore ? (
				<SymbolView
					name="chevron.right"
					tintColor={colors.mutedFg}
					size={15}
					accessibilityElementsHidden
				/>
			) : null}
		</View>
	)
	return (
		<View style={styles.section}>
			<View style={styles.inset}>
				{onMore ? (
					<Pressable
						accessibilityRole="link"
						accessibilityLabel={title}
						onPress={onMore}
						hitSlop={8}
					>
						{heading}
					</Pressable>
				) : (
					heading
				)}
				{note ? <Text style={[styles.note, { color: colors.mutedFg }]}>{note}</Text> : null}
			</View>
			{children}
		</View>
	)
}

/**
 * The big card: the whole width, a larger title, and how much is left. It has the page's
 * background, so it lifts as one piece under the long-press menu.
 */
function Hero({
	item,
	colors,
	headers,
	menu,
}: {
	item: ArticleSummary
	colors: Colors
	headers: Record<string, string> | null
	menu: CardMenu
}) {
	const left = minutesLeft(item)
	const started = item.progress > 0
	return (
		<Tappable
			item={item}
			checked={false}
			menu={menu}
			style={(pressed) => [
				styles.inset,
				styles.hero,
				{ backgroundColor: colors.bg },
				pressed && styles.pressed,
			]}
		>
			<CardPicture item={item} colors={colors} headers={headers} radius={16} />
			<Text style={[styles.heroTitle, { color: colors.fg }]} numberOfLines={3}>
				{item.title ?? item.url}
			</Text>
			<Starred item={item} colors={colors}>
				<Text style={[styles.meta, styles.shrink, { color: colors.mutedFg }]} numberOfLines={1}>
					{articleMeta(item)}
				</Text>
			</Starred>
			{started ? (
				<View style={styles.progressRow}>
					<View style={styles.grow}>
						<ProgressBar progress={item.progress} colors={colors} />
					</View>
					{left ? (
						<Text style={[styles.meta, { color: colors.mutedFg }]}>{left} min left</Text>
					) : null}
				</View>
			) : null}
		</Tappable>
	)
}

/**
 * A row of cards that scrolls sideways, as iOS apps' shelves do. The cards are framed, as the
 * library's grid, so each lifts as one piece under the long-press menu; the frames reach into the
 * space around the cards, and the shelf makes room for them without moving anything.
 */
function Shelf({
	items,
	colors,
	headers,
	menu,
}: {
	items: ArticleSummary[]
	colors: Colors
	headers: Record<string, string> | null
	menu: CardMenu
}) {
	const { width } = useWindowDimensions()
	if (!items.length) return null
	return (
		<FlatList
			horizontal
			data={items}
			keyExtractor={(item) => item.id}
			showsHorizontalScrollIndicator={false}
			style={styles.shelfFrame}
			contentContainerStyle={styles.shelf}
			renderItem={({ item }) => (
				<View style={[styles.shelfCard, { width: Math.min(260, width * 0.62) + CARD_FRAME * 2 }]}>
					<ArticleCard item={item} colors={colors} headers={headers} menu={menu} framed />
				</View>
			)}
		/>
	)
}

const PAD = 16

const styles = StyleSheet.create({
	page: { paddingTop: 4, paddingBottom: 40, gap: 32 },
	inset: { paddingHorizontal: PAD },
	loading: { marginTop: 48 },
	message: { fontSize: 16, lineHeight: 22, textAlign: "center" },
	banner: { fontSize: 14 },
	emptyState: { alignItems: "center", gap: 12, paddingHorizontal: 32, marginTop: 64 },
	emptyTitle: { fontSize: 20, fontWeight: "600", textAlign: "center" },
	section: { gap: 12 },
	heading: { flexDirection: "row", alignItems: "center", gap: 6 },
	sectionTitle: { fontSize: 22, fontWeight: "700" },
	note: { fontSize: 14, marginTop: 2 },
	// Room for the lifted card's edge above and below its content; the layout doesn't move.
	hero: { gap: 8, paddingVertical: 8, marginTop: -8, borderRadius: 24 },
	heroTitle: { fontFamily: "Iowan Old Style", fontSize: 24, lineHeight: 29, fontWeight: "600" },
	meta: { fontSize: 14 },
	progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
	grow: { flex: 1 },
	shrink: { flexShrink: 1 },
	pressed: { opacity: 0.6 },
	about: { gap: 8 },
	aboutTitle: { fontSize: 14 },
	chips: { paddingHorizontal: PAD, gap: 8 },
	chip: {
		borderWidth: 1,
		borderRadius: 999,
		paddingHorizontal: 14,
		paddingVertical: 7,
	},
	moreChip: { flexDirection: "row", alignItems: "center", gap: 4 },
	chipText: { fontSize: 15, fontWeight: "500" },
	topicHeading: {
		marginHorizontal: PAD,
		gap: 4,
		paddingBottom: 16,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	topicTitle: { fontFamily: "Iowan Old Style", fontSize: 28, lineHeight: 33, fontWeight: "600" },
	shelf: { paddingHorizontal: PAD, paddingVertical: CARD_FRAME, gap: 14 },
	shelfFrame: { marginVertical: -CARD_FRAME },
	shelfCard: { marginHorizontal: -CARD_FRAME },
})
