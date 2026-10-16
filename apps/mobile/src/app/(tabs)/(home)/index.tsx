import type { ArticleSummary, DailyHighlight, NoteReminder, Topic } from "@klipstack/sdk"
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
import { HomeHighlights } from "@/components/home-highlights"
import { NoteReminders } from "@/components/note-reminders"
import { useTagSheet } from "@/components/tag-sheet"
import { onChange, settled } from "@/lib/article-changes"
import { articleMeta } from "@/lib/article-meta"
import { useAuth } from "@/lib/auth"
import { localDay } from "@/lib/daily-highlights"
import {
	everyHomeArticle,
	type HomeLists,
	homeSections,
	minutesLeft,
	offersTimeChoice,
	TIME_CHOICES,
	withChanges,
	withTags,
} from "@/lib/home"
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
 *
 * With more unfinished articles than Home shows at once, "How much time do you have?" above it, as
 * on the web: a time narrows every section to what can be finished in it, from the lists already
 * loaded, without asking the server again. Articles finished lately without a note are asked
 * about, as on the web, when the server suggests it. A few past highlights come back each day
 * ("From your highlights"), as on the web, unless a topic or a time is chosen.
 */
export default function Home() {
	const { state } = useAuth()
	const colors = useColors()
	const headers = useImageHeaders()
	const client = state.status === "signed-in" ? state.client : null
	const [lists, setLists] = useState<HomeLists | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [refreshing, setRefreshing] = useState(false)
	const generation = useRef(0)
	// The reader's topics (none while off or not loaded), and the one Home narrows to.
	const [topics, setTopics] = useState<Topic[]>([])
	// Finished without a note, when Home asks about them now.
	const [reminders, setReminders] = useState<NoteReminder[]>([])
	// Answered here while a load was on its way: that load's list mustn't bring them back.
	const skipped = useRef(new Set<string>())
	// The day's highlights, and those taken off Home here ("Not useful anymore", until undone).
	const [daily, setDaily] = useState<{
		items: DailyHighlight[]
		linkTargets: Record<string, "ok" | "trash">
	} | null>(null)
	const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
	const putOff = useRef(false)
	const [pick, setPick] = useState<TopicPick>(null)
	const choice = homeTopicChoice(topics, pick)
	const chosen = choice?.chosen ?? null
	const topic = chosen?.topic.id
	// Whether to offer a time, judged on Home without a topic (a topic's share is smaller), and the
	// minutes chosen: null for any length.
	const [timeChoice, setTimeChoice] = useState(false)
	const [chosenMinutes, setMinutes] = useState<number | null>(null)
	const minutes = timeChoice ? chosenMinutes : null
	const home = useMemo(() => lists && homeSections(lists, { minutes }), [lists, minutes])

	const load = useCallback(async () => {
		if (!client) return
		const mine = ++generation.current
		try {
			// After a closing reader's change lands (src/lib/article-changes.ts).
			await settled()
			// Alongside, and never in the way: Home without them is Home without the choice. A pick
			// with nothing left to read goes: a later save must not narrow Home again unasked.
			void client.topics
				.list()
				.then((answer) => {
					if (mine !== generation.current) return
					setTopics(answer.items)
					setPick((now) => homeTopicChoice(answer.items, now)?.pick ?? null)
				})
				.catch(() => {})
			void client.noteReminders
				.list()
				.then((answer) => {
					if (mine !== generation.current || putOff.current || !answer.suggested) return
					setReminders(answer.items.filter((r) => !skipped.current.has(r.article.id)))
				})
				.catch(() => {})
			// In a topic, Home is about its articles, as on the web. A server before them answers 404:
			// Home without the section.
			if (!topic)
				void client.dailyHighlights
					.list(localDay())
					.then((answer) => {
						if (mine === generation.current) setDaily(answer)
					})
					.catch(() => {})
			// More than a shelf shows: the sections drop what isn't ready or shows above.
			const [reading, unread, quick, long, again] = await Promise.all([
				client.articles.list({ view: "inbox", filter: "progress", limit: 12, topic }),
				client.articles.list({
					view: "inbox",
					filter: "unread",
					sort: "newest",
					limit: 20,
					topic,
				}),
				client.articles.list({ view: "inbox", filter: "quick", limit: 30, topic }),
				client.articles.list({ view: "inbox", filter: "long", limit: 20, topic }),
				// A server before Read again refuses the filter: Home without the section.
				client.articles
					.list({ view: "inbox", filter: "again", limit: 12, topic })
					.catch((e: unknown) => {
						if (canUseOffline(e)) throw e
						return { items: [] }
					}),
			])
			if (mine !== generation.current) return
			const loaded = {
				reading: reading.items,
				unread: unread.items,
				quick: quick.items,
				long: long.items,
				again: again.items,
			}
			setLists(loaded)
			setError(null)
			// A topic's share is part of the library: enough in it is enough in all of it.
			const offered = offersTimeChoice(loaded)
			// One topic's share is not Home to keep: offline, and on the widget, Home is all of it.
			if (topic) return setTimeChoice((before) => before || offered)
			setTimeChoice(offered)
			// A choice withdrawn is forgotten: it doesn't narrow Home again unasked when it comes back.
			if (!offered) setMinutes(null)
			// Kept for offline reading, with Inbox's and Starred's first pages (src/lib/offline.ts).
			saveList("home-reading", reading.items)
			saveList("home-unread", unread.items)
			saveList("home-quick", quick.items)
			saveList("home-long", long.items)
			saveList("home-again", again.items)
			// Home as it opens first, then what each time would show.
			void downloadAhead(client, "home", everyHomeArticle(loaded))
			keepLibraryLists(client)
		} catch (e) {
			if (mine !== generation.current) return
			// The topic ended, or topics were turned off: Home shows everything again.
			if (topicEnded(topic ?? null, e)) return setPick(null)
			// Offline, only Home without a topic is kept: none to show for one.
			if (topic && canUseOffline(e)) return setError(OFFLINE_NOTE)
			if (canUseOffline(e)) {
				const [reading, unread, quick] = [
					loadList("home-reading"),
					loadList("home-unread"),
					loadList("home-quick"),
				]
				// Kept since the time choice came; none before.
				const long = loadList("home-long") ?? []
				const again = loadList("home-again") ?? []
				if (reading && unread && quick) {
					const kept = { reading, unread, quick, long, again }
					setLists((shown) => shown ?? kept)
					setTimeChoice((offered) => offered || offersTimeChoice(kept))
				}
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
			setLists((shown) => shown && withChanges(shown, changed))
		},
		done: () => void load(),
		reload: () => void load(),
	})
	const tags = useTagSheet(client, (changed) =>
		setLists((shown) => shown && withTags(shown, changed)),
	)
	const openTags = tags.open
	const menu = useMemo<CardMenu>(
		() => ({ act: (item, action) => act(action, [item]), tag: (item) => openTags([item]) }),
		[act, openTags],
	)

	const hide = useCallback((id: string) => setHidden((now) => new Set(now).add(id)), [])
	const show = useCallback(
		(id: string) =>
			setHidden((now) => {
				const next = new Set(now)
				next.delete(id)
				return next
			}),
		[],
	)
	const noteSaved = useCallback(
		(id: string, note: string | null) =>
			setDaily(
				(shown) =>
					shown && { ...shown, items: shown.items.map((h) => (h.id === id ? { ...h, note } : h)) },
			),
		[],
	)
	const highlights = daily?.items.filter((h) => !hidden.has(h.id)) ?? []

	async function onRefresh() {
		setRefreshing(true)
		await load()
		setRefreshing(false)
	}

	const empty = home && !home.hero && !home.quick.length && !home.again.length
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			style={{ backgroundColor: colors.bg }}
			contentContainerStyle={styles.page}
			refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
		>
			<ClipboardOffer client={client} onSaved={() => void load()} colors={colors} />
			{/* In a topic, or with a time chosen, Home is about reading what's next. */}
			{client && !chosen && minutes === null ? (
				<NoteReminders
					items={reminders}
					client={client}
					onSkip={(id) => {
						skipped.current.add(id)
						setReminders((shown) => shown.filter((r) => r.article.id !== id))
					}}
					onUnskip={(item) => {
						skipped.current.delete(item.article.id)
						setReminders((shown) =>
							shown.some((r) => r.article.id === item.article.id) ? shown : [item, ...shown],
						)
					}}
					onReadAgain={() => void load()}
					onLater={() => {
						putOff.current = true
						setReminders([])
						void client.noteReminders.snooze().catch(() => {})
					}}
					colors={colors}
				/>
			) : null}
			{timeChoice || choice ? (
				<View style={styles.choices}>
					{timeChoice ? <TimeChoice minutes={minutes} onPick={setMinutes} colors={colors} /> : null}
					{choice ? (
						<AboutWhat
							choice={choice}
							onPick={(next) => {
								// Another topic's sections, not the last one's under its heading: loading, then them.
								setLists(null)
								setError(null)
								setPick(next)
							}}
							colors={colors}
						/>
					) : null}
				</View>
			) : null}
			{chosen ? <TopicHeading chosen={chosen} minutes={minutes} colors={colors} /> : null}
			{home && error ? (
				<Text style={[styles.inset, styles.banner, { color: colors.mutedFg }]}>{error}</Text>
			) : null}
			{!home ? (
				error ? (
					<Text style={[styles.message, { color: colors.mutedFg }]}>{error}</Text>
				) : (
					<ActivityIndicator style={styles.loading} color={colors.mutedFg} />
				)
			) : home.nothingFits && !home.hero ? (
				<NothingFits
					minutes={minutes!}
					topic={chosen?.topic.name}
					onAll={() => setMinutes(null)}
					colors={colors}
				/>
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
							{home.pickUp ? (
								<Text style={[styles.inset, styles.note, { color: colors.mutedFg }]}>
									Doesn't fit in {minutesText(minutes!)}, but it's where you left off.
								</Text>
							) : null}
							<Shelf items={home.reading} colors={colors} headers={headers} menu={menu} />
						</Section>
					) : null}
					{home.recent.length ? (
						<Section
							title="Recently saved"
							onMore={() => {
								// Inbox, in the same topic; otherwise as the reader left it.
								if (topic) chooseTopic("inbox", topic)
								router.navigate("/library/inbox", { withAnchor: true })
							}}
							colors={colors}
						>
							<Shelf items={home.recent} colors={colors} headers={headers} menu={menu} />
						</Section>
					) : null}
					{home.again.length ? (
						<Section
							title="Read again"
							note="Articles you finished and put back, to read once more."
							colors={colors}
						>
							<Shelf items={home.again} colors={colors} headers={headers} menu={menu} />
						</Section>
					) : null}
					{/* In a topic, or with a time chosen, the reader came to read. */}
					{client && daily && highlights.length > 0 && !chosen && minutes === null ? (
						<Section
							title="From your highlights"
							note="Passages you marked, back for another look. A few each day."
							colors={colors}
						>
							<HomeHighlights
								items={highlights}
								linkTargets={daily.linkTargets}
								client={client}
								onHide={hide}
								onShow={show}
								onNote={noteSaved}
								colors={colors}
								headers={headers}
							/>
						</Section>
					) : null}
					{home.quick.length ? (
						// QUICK_MAX_MINUTES in apps/web/app/lib/inbox-filters.ts.
						<Section title="A few minutes to read" note="Ten minutes or less." colors={colors}>
							<Shelf items={home.quick} colors={colors} headers={headers} menu={menu} />
						</Section>
					) : null}
					{home.nothingFits ? (
						<NothingFits
							minutes={minutes!}
							topic={chosen?.topic.name}
							onAll={() => setMinutes(null)}
							colors={colors}
						/>
					) : null}
				</>
			)}
			{/* A sheet of its own, over the screen: its place here doesn't matter. */}
			{tags.sheet}
		</ScrollView>
	)
}

/** "5 minutes", "1 minute". */
function minutesText(minutes: number) {
	return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
}

/**
 * "How much time do you have?": Any, then the web's choices (TIME_CHOICES), in one line. A choice
 * narrows every section at once, from what Home already loaded. The chosen one is filled.
 */
function TimeChoice({
	minutes,
	onPick,
	colors,
}: {
	minutes: number | null
	onPick: (minutes: number | null) => void
	colors: Colors
}) {
	const chip = (value: number | null) => {
		const on = value === minutes
		return (
			<Pressable
				key={value ?? "any"}
				accessibilityRole="button"
				accessibilityLabel={value === null ? "Any length" : minutesText(value)}
				accessibilityState={{ selected: on }}
				onPress={() => {
					if (!on) onPick(value)
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
				<Text style={[styles.chipText, { color: on ? colors.bg : colors.fg }]}>
					{value === null ? "Any" : `${value} min`}
				</Text>
			</Pressable>
		)
	}
	return (
		<View style={styles.about}>
			<Text style={[styles.inset, styles.aboutTitle, { color: colors.mutedFg }]}>
				How much time do you have?
			</Text>
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.chips}
			>
				{chip(null)}
				{TIME_CHOICES.map(chip)}
			</ScrollView>
		</View>
	)
}

/** Nothing fits in the time chosen: says so, with the way back to any length. */
function NothingFits({
	minutes,
	topic,
	onAll,
	colors,
}: {
	minutes: number
	topic: string | undefined
	onAll: () => void
	colors: Colors
}) {
	return (
		<View style={[styles.inset, styles.nothingFits]}>
			<Text style={[styles.message, { color: colors.mutedFg }]}>
				Nothing in {topic ?? "your library"} fits in {minutesText(minutes)}.
			</Text>
			<Pressable
				accessibilityRole="button"
				onPress={onAll}
				style={({ pressed }) => [
					styles.chip,
					{ borderColor: colors.border },
					pressed && styles.pressed,
				]}
			>
				<Text style={[styles.chipText, { color: colors.fg }]}>
					{topic ? "Any length" : "Show everything"}
				</Text>
			</Pressable>
		</View>
	)
}

/**
 * "About what?": Anything, the biggest topics, something different, and More for the rest, in one
 * line scrolled sideways, so Home's sections stay in view. The chosen one is filled.
 */
function AboutWhat({
	choice,
	onPick,
	colors,
}: {
	choice: HomeTopicChoice
	onPick: (next: TopicPick) => void
	colors: Colors
}) {
	const { pick } = choice
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

/**
 * The chosen topic, with the time if chosen: its name, why it is here, and the way to all of it on
 * the Topics screen.
 */
function TopicHeading({
	chosen,
	minutes,
	colors,
}: {
	chosen: NonNullable<HomeTopicChoice["chosen"]>
	minutes: number | null
	colors: Colors
}) {
	const heading = topicHeading(chosen)
	const { line, all } = heading
	const title = minutes === null ? heading.title : `${minutesText(minutes)} of ${heading.title}`
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
	choices: { gap: 16 },
	about: { gap: 8 },
	nothingFits: { alignItems: "center", gap: 16, paddingVertical: 24 },
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
