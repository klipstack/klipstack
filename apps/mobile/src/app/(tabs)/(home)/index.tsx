import { DEFAULT_TIME, REDISCOVER_AFTER_DAYS, TIME_CHOICES } from "@klipstack/api-contract/enums"
import { type ArticleSummary, KlipstackApiError } from "@klipstack/sdk"
import { router, useFocusEffect } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useCallback, useMemo, useRef, useState } from "react"
import {
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
import { canUseOffline, loadList, OFFLINE_NOTE, saveList } from "@/lib/offline"
import { downloadAhead, keepLibraryLists } from "@/lib/offline-download"
import { type Colors, useColors } from "@/lib/theme"

/**
 * The home page, as the web's: a big card to continue reading (or, with nothing in progress, to
 * start the newest save), then shelves of more in progress, recent saves, what fits in the time
 * the reader has, and saves from a while ago. A long press on an article opens its menu, as in the
 * library.
 */
export default function Home() {
	const { state } = useAuth()
	const colors = useColors()
	const headers = useImageHeaders()
	const client = state.status === "signed-in" ? state.client : null
	const [home, setHome] = useState<HomeSections | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [refreshing, setRefreshing] = useState(false)
	const [minutes, setMinutes] = useState<number>(DEFAULT_TIME)
	const generation = useRef(0)

	const load = useCallback(async () => {
		if (!client) return
		const mine = ++generation.current
		const fitsList = `home-fits-${minutes}` as const
		const longest = Math.max(...TIME_CHOICES)
		try {
			// After a closing reader's change lands (src/lib/article-changes.ts).
			await settled()
			// More than a shelf shows: the sections drop what isn't ready or shows above.
			const [reading, unread, rediscover, fits] = await Promise.all([
				client.articles.list({ view: "inbox", filter: "progress", limit: 12 }),
				client.articles.list({ view: "inbox", filter: "unread", sort: "newest", limit: 20 }),
				client.articles.suggest({ kind: "rediscover", limit: 20 }).catch(noSuggestions),
				client.articles.suggest({ kind: "fits", minutes, limit: 30 }).catch(noSuggestions),
			])
			const lists = {
				reading: reading.items,
				unread: unread.items,
				rediscover: rediscover.items,
				fits: fits.items,
			}
			let sections = homeSections(lists, { minutes })
			// Nothing fits this time: the choices stay while a longer time has something.
			if (!sections.fits && minutes < longest) {
				const more = await client.articles
					.suggest({ kind: "fits", minutes: longest, limit: 30 })
					.catch(noSuggestions)
				sections = homeSections({ ...lists, longest: more.items }, { minutes })
			}
			if (mine !== generation.current) return
			setHome(sections)
			setError(null)
			// Kept for offline reading, with Inbox's and Starred's first pages (src/lib/offline.ts).
			saveList("home-reading", reading.items)
			saveList("home-unread", unread.items)
			saveList("home-rediscover", rediscover.items)
			saveList(fitsList, fits.items)
			void downloadAhead(client, "home", [
				...(sections.hero ? [sections.hero] : []),
				...sections.reading,
				...sections.recent,
				...(sections.fits?.items ?? []),
				...sections.rediscover,
			])
			keepLibraryLists(client)
		} catch (e) {
			if (mine !== generation.current) return
			if (canUseOffline(e)) {
				const [reading, unread] = [loadList("home-reading"), loadList("home-unread")]
				if (reading && unread) {
					const rediscover = loadList("home-rediscover") ?? []
					const kept = homeSections(
						{ reading, unread, rediscover, fits: loadList(fitsList) ?? [] },
						{ minutes },
					)
					// A time the phone didn't keep shows nothing, and the choices stay to go back.
					setHome((shown) =>
						shown?.fits?.minutes === minutes
							? shown
							: { ...kept, fits: kept.fits ?? (shown?.fits ? { minutes, items: [] } : null) },
					)
				}
				setError(OFFLINE_NOTE)
				return
			}
			setError(e instanceof Error ? e.message : String(e))
		}
	}, [client, minutes])

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

	const empty = home && !home.hero && !home.rediscover.length && !home.fits
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			style={{ backgroundColor: colors.bg }}
			contentContainerStyle={styles.page}
			refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
		>
			<ClipboardOffer client={client} onSaved={() => void load()} colors={colors} />
			{home && error ? (
				<Text style={[styles.inset, styles.banner, { color: colors.mutedFg }]}>{error}</Text>
			) : null}
			{!home ? (
				error ? (
					<Text style={[styles.message, { color: colors.mutedFg }]}>{error}</Text>
				) : (
					<ActivityIndicator style={styles.loading} color={colors.mutedFg} />
				)
			) : empty ? (
				<View style={styles.emptyState}>
					<SymbolView name="square.and.arrow.up" tintColor={colors.mutedFg} size={36} />
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
							onMore={() => router.navigate("/library/inbox", { withAnchor: true })}
							colors={colors}
						>
							<Shelf items={home.recent} colors={colors} headers={headers} menu={menu} />
						</Section>
					) : null}
					{home.fits ? (
						<Section title="How much time do you have?" colors={colors}>
							<TimeChoices minutes={minutes} onChoose={setMinutes} colors={colors} />
							{home.fits.items.length ? (
								<Shelf items={home.fits.items} colors={colors} headers={headers} menu={menu} />
							) : (
								<Text style={[styles.inset, styles.note, { color: colors.mutedFg }]}>
									Nothing in your library fits in {home.fits.minutes} minutes. Try a longer time.
								</Text>
							)}
						</Section>
					) : null}
					{home.rediscover.length ? (
						<Section
							title="From a while ago"
							note={`Saved more than ${REDISCOVER_AFTER_DAYS} days ago. A different few each day.`}
							colors={colors}
						>
							<Shelf items={home.rediscover} colors={colors} headers={headers} menu={menu} />
						</Section>
					) : null}
				</>
			)}
			{/* A sheet of its own, over the screen: its place here doesn't matter. */}
			{tags.sheet}
		</ScrollView>
	)
}

/** A server older than suggestions has none to give: Home shows the rest. */
function noSuggestions(e: unknown): { items: ArticleSummary[] } {
	if (e instanceof KlipstackApiError && e.status === 404) return { items: [] }
	throw e
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
			{onMore ? <SymbolView name="chevron.right" tintColor={colors.mutedFg} size={15} /> : null}
		</View>
	)
	return (
		<View style={styles.section}>
			<View style={styles.inset}>
				{onMore ? (
					<Pressable accessibilityRole="link" onPress={onMore} hitSlop={8}>
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

/** The times to choose from, as the web's chips: the one chosen is filled. */
function TimeChoices({
	minutes,
	onChoose,
	colors,
}: {
	minutes: number
	onChoose: (minutes: number) => void
	colors: Colors
}) {
	return (
		<View style={[styles.inset, styles.choices]} accessibilityRole="radiogroup">
			{TIME_CHOICES.map((choice) => {
				const chosen = choice === minutes
				return (
					<Pressable
						key={choice}
						accessibilityRole="radio"
						accessibilityState={{ checked: chosen }}
						accessibilityLabel={`${choice} minutes`}
						onPress={() => onChoose(choice)}
						style={({ pressed }) => [
							styles.choice,
							chosen
								? { backgroundColor: colors.accent, borderColor: colors.accent }
								: { borderColor: colors.border },
							pressed && styles.pressed,
						]}
					>
						<Text style={[styles.choiceText, { color: chosen ? colors.accentFg : colors.fg }]}>
							{choice} min
						</Text>
					</Pressable>
				)
			})}
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
	choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	choice: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
	choiceText: { fontSize: 15 },
	// Room for the lifted card's edge above and below its content; the layout doesn't move.
	hero: { gap: 8, paddingVertical: 8, marginTop: -8, borderRadius: 24 },
	heroTitle: { fontFamily: "Iowan Old Style", fontSize: 24, lineHeight: 29, fontWeight: "600" },
	meta: { fontSize: 14 },
	progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
	grow: { flex: 1 },
	shrink: { flexShrink: 1 },
	pressed: { opacity: 0.6 },
	shelf: { paddingHorizontal: PAD, paddingVertical: CARD_FRAME, gap: 14 },
	shelfFrame: { marginVertical: -CARD_FRAME },
	shelfCard: { marginHorizontal: -CARD_FRAME },
})
