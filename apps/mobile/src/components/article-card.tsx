import type { ArticleSummary } from "@klipstack/sdk"
import { Image } from "expo-image"
import { Link, router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { type ReactNode, useEffect, useState } from "react"
import {
	AppState,
	FlatList,
	type FlatListProps,
	Linking,
	Pressable,
	Share,
	type StyleProp,
	StyleSheet,
	Text,
	useWindowDimensions,
	View,
	type ViewStyle,
} from "react-native"
import type { ArticleAction } from "@/components/article-actions"
import { useListLayout } from "@/components/list-layout"
import { articleByline, articleMeta, shortDate, siteName } from "@/lib/article-meta"
import { useAuth } from "@/lib/auth"
import { copyText } from "@/lib/clipboard"
import { leadImageSource } from "@/lib/lead-image"
import { type Colors, useColors } from "@/lib/theme"

/**
 * Multi-select: while a list is selecting, a tap checks an article instead of opening it, and a
 * circle shows whether it is checked.
 */
export type Selection = { checked: ReadonlySet<string>; toggle: (id: string) => void }

/**
 * The long-press menu's actions that change the screen: the screen that shows the article does
 * them (`act`, `useArticleActions`), opens its tag sheet (`tag`, `useTagSheet`), or starts
 * selecting with it checked (`select`, where the screen can select).
 */
export type CardMenu = {
	act: (item: ArticleSummary, action: ArticleAction) => void
	tag: (item: ArticleSummary) => void
	select?: (item: ArticleSummary) => void
}

/**
 * An article as a card of the web's grid layout: the picture (16:10) on top, then the title in
 * the serif, the site and reading time, and progress. Opens the reader, or, while selecting
 * (`onCheck`), checks the article; the circle sits on the picture. With a `menu`, a long press
 * opens the article's menu.
 *
 * `framed` (a list's grid): the card has its own padding and background, so it lifts as one
 * piece under the menu, and the selection tints it.
 */
export function ArticleCard({
	item,
	colors,
	headers,
	checked = false,
	onCheck,
	menu,
	framed = false,
}: {
	item: ArticleSummary
	colors: Colors
	headers: Record<string, string> | null
	checked?: boolean
	onCheck?: () => void
	menu?: CardMenu | null
	framed?: boolean
}) {
	return (
		<Tappable
			item={item}
			checked={checked}
			onCheck={onCheck}
			menu={menu}
			style={(pressed) => [
				styles.card,
				framed && [styles.framed, { backgroundColor: checked ? colors.selected : colors.bg }],
				pressed && styles.pressed,
			]}
		>
			<View>
				<CardPicture item={item} colors={colors} headers={headers} />
				{onCheck ? (
					<CheckCircle checked={checked} colors={colors} onPicture style={styles.pictureCheck} />
				) : null}
			</View>
			<Text style={[styles.title, { color: colors.fg }]} numberOfLines={3}>
				{item.title ?? item.url}
			</Text>
			<Starred item={item} colors={colors}>
				<Text style={[styles.meta, styles.shrink, { color: colors.mutedFg }]} numberOfLines={1}>
					{metaLine(item)}
				</Text>
			</Starred>
			{reading(item) ? <ProgressBar progress={item.progress} colors={colors} /> : null}
		</Tappable>
	)
}

/**
 * An article as a row: the site on top, the title in the serif across the row, then the date and
 * the description, and the author and reading time, beside a square of the picture when there is
 * one; progress below. Opens the reader, or, while selecting (`onCheck`), checks the article; the
 * circle goes before the row, as in iOS's own lists. With a `menu`, a long press opens the
 * article's menu.
 */
export function ArticleRow({
	item,
	colors,
	headers,
	checked = false,
	onCheck,
	menu,
}: {
	item: ArticleSummary
	colors: Colors
	headers: Record<string, string> | null
	checked?: boolean
	onCheck?: () => void
	menu?: CardMenu | null
}) {
	const date = shortDate(item.publishedAt)
	const description = item.status === "ready" ? item.description : null
	return (
		<Tappable
			item={item}
			checked={checked}
			onCheck={onCheck}
			menu={menu}
			// Its own background: it lifts as one piece under the menu.
			style={(pressed) => [
				styles.articleRow,
				{ backgroundColor: checked ? colors.selected : colors.bg },
				pressed && styles.pressed,
			]}
		>
			{onCheck ? <CheckCircle checked={checked} colors={colors} /> : null}
			<View style={styles.rowBody}>
				<Starred item={item} colors={colors}>
					<Text style={[styles.site, styles.shrink, { color: colors.mutedFg }]} numberOfLines={1}>
						{siteName(item)}
					</Text>
				</Starred>
				<Text style={[styles.rowTitle, { color: colors.fg }]} numberOfLines={3}>
					{item.title ?? item.url}
				</Text>
				<View style={styles.rowDetails}>
					<View style={styles.rowText}>
						{date || description ? (
							<Text style={[styles.description, { color: colors.mutedFg }]} numberOfLines={3}>
								{date ? <Text style={{ color: colors.fg }}>{date}</Text> : null}
								{date && description ? " · " : null}
								{description}
							</Text>
						) : null}
						<Text style={[styles.meta, { color: colors.fg }]} numberOfLines={1}>
							{withStatus(articleByline(item), item)}
						</Text>
					</View>
					<RowPicture item={item} colors={colors} headers={headers} />
				</View>
				{reading(item) ? <ProgressBar progress={item.progress} colors={colors} /> : null}
			</View>
		</Tappable>
	)
}

/** The row's square of the picture; nothing for an article without one, or one that won't load. */
function RowPicture({
	item,
	colors,
	headers,
}: {
	item: ArticleSummary
	colors: Colors
	headers: Record<string, string> | null
}) {
	const { apiUrl } = useAuth()
	const [failed, setFailed] = usePictureFailure(headers)
	// A stored picture waits for the token's headers: its square shows empty until then, so the row
	// doesn't change shape when it comes.
	if (failed || !leadImageSource(item.leadImage, apiUrl, {})) return null
	const source = leadImageSource(item.leadImage, apiUrl, headers)
	return (
		<View style={[styles.thumb, { backgroundColor: colors.muted }]}>
			{source ? (
				<Image
					source={source}
					recyclingKey={item.id}
					contentFit="cover"
					transition={150}
					style={StyleSheet.absoluteFill}
					onError={setFailed}
				/>
			) : null}
		</View>
	)
}

/**
 * A line of a card or a row, after a small star when the article is starred, and a newspaper when
 * it is marked for the next edition.
 */
export function Starred({
	item,
	colors,
	children,
}: {
	item: ArticleSummary
	colors: Colors
	children: ReactNode
}) {
	if (!item.starred && !item.shortlisted) return children
	return (
		<View style={styles.starred}>
			{item.starred ? (
				<SymbolView
					name="star.fill"
					tintColor={colors.favorite}
					size={12}
					accessibilityLabel="Starred"
				/>
			) : null}
			{item.shortlisted ? (
				<SymbolView
					name="newspaper.fill"
					tintColor={colors.accent}
					size={12}
					accessibilityLabel="Marked for your next edition"
				/>
			) : null}
			{children}
		</View>
	)
}

/** Whether an article is checked: a circle, filled with a checkmark when it is. */
function CheckCircle({
	checked,
	colors,
	onPicture = false,
	style,
}: {
	checked: boolean
	colors: Colors
	/** On a picture it needs its own contrast. */
	onPicture?: boolean
	style?: StyleProp<ViewStyle>
}) {
	return (
		<View
			style={[
				styles.check,
				checked
					? { backgroundColor: colors.accent, borderColor: colors.accent }
					: onPicture
						? styles.checkOnPicture
						: { borderColor: colors.mutedFg },
				style,
			]}
		>
			{/* The card's checkbox state says it; VoiceOver would add "selected". */}
			{checked ? (
				<SymbolView
					name="checkmark"
					tintColor={colors.accentFg}
					size={13}
					weight="bold"
					accessibilityElementsHidden
				/>
			) : null}
		</View>
	)
}

/**
 * What a card or a row is to a tap: a checkbox while selecting; otherwise the way to the reader,
 * and, with a `menu`, iOS's own menu on a long press (the card lifts, as in Books).
 */
export function Tappable({
	item,
	checked,
	onCheck,
	menu,
	style,
	children,
}: {
	item: ArticleSummary
	checked: boolean
	onCheck?: () => void
	menu?: CardMenu | null
	style: (pressed: boolean) => StyleProp<ViewStyle>
	children: ReactNode
}) {
	const [pressed, setPressed] = useState(false)
	if (onCheck)
		return (
			<Pressable
				accessibilityRole="checkbox"
				accessibilityState={{ checked }}
				onPress={onCheck}
				style={(state) => style(state.pressed)}
			>
				{children}
			</Pressable>
		)
	if (!menu)
		return (
			<Pressable
				accessibilityRole="link"
				onPress={() => openReader(item)}
				style={(state) => style(state.pressed)}
			>
				{children}
			</Pressable>
		)
	// The Link merges style objects into its child and drops a style function: the pressed state
	// is kept here instead.
	return (
		<Link href={{ pathname: "/read/[id]", params: { id: item.id } }} push asChild>
			<Link.Trigger>
				<Pressable
					accessibilityRole="link"
					onPressIn={() => setPressed(true)}
					onPressOut={() => setPressed(false)}
					style={StyleSheet.flatten(style(pressed))}
				>
					{children}
				</Pressable>
			</Link.Trigger>
			{articleMenu(item, menu)}
		</Link>
	)
}

/**
 * The article's long-press menu: the web card's buttons and its ⋯ menu. On top, as in Books, what
 * is done most: Star, Archive and Share; then finishing, Tags and Rename. A failed save has Try Again, and
 * what needs no text; an article in the trash can be restored, or deleted forever.
 */
function articleMenu(item: ArticleSummary, menu: CardMenu) {
	const saved = item.status !== "failed"
	const ready = item.status === "ready"
	const archived = item.location === "archive"
	const share = (
		<Link.MenuAction icon="square.and.arrow.up" onPress={() => shareArticle(item)}>
			Share
		</Link.MenuAction>
	)
	// The original, after `first` (Share, when it isn't on top).
	const original = (first: ReactNode) => (
		<Link.Menu inline>
			{first}
			<Link.MenuAction
				icon="safari"
				// Web pages open in the phone's browser, never inside the app.
				onPress={() => void Linking.openURL(item.url)}
			>
				Open the Original
			</Link.MenuAction>
			<Link.MenuAction icon="link" onPress={() => void copyText(item.url)}>
				Copy Link
			</Link.MenuAction>
		</Link.Menu>
	)
	const select = menu.select ? (
		<Link.MenuAction icon="checkmark.circle.badge.plus" onPress={() => menu.select?.(item)}>
			Select
		</Link.MenuAction>
	) : null
	if (item.trashedAt)
		return (
			<Link.Menu>
				<Link.MenuAction icon="arrow.uturn.backward" onPress={() => menu.act(item, "restore")}>
					Restore
				</Link.MenuAction>
				{original(null)}
				<Link.Menu inline>
					{select}
					<Link.MenuAction icon="trash" destructive onPress={() => menu.act(item, "purge")}>
						Delete Forever
					</Link.MenuAction>
				</Link.Menu>
			</Link.Menu>
		)
	return (
		<Link.Menu>
			{saved ? null : (
				<Link.MenuAction icon="arrow.clockwise" onPress={() => menu.act(item, "retry")}>
					Try Again
				</Link.MenuAction>
			)}
			{saved ? (
				<Link.Menu inline elementSize="medium">
					<Link.MenuAction
						icon={item.starred ? "star.slash" : "star"}
						onPress={() => menu.act(item, item.starred ? "unstar" : "star")}
					>
						{item.starred ? "Unstar" : "Star"}
					</Link.MenuAction>
					<Link.MenuAction
						icon={archived ? "tray.and.arrow.up" : "archivebox"}
						onPress={() => menu.act(item, archived ? "unarchive" : "archive")}
					>
						{archived ? "Move to Inbox" : "Archive"}
					</Link.MenuAction>
					{share}
				</Link.Menu>
			) : null}
			{saved ? (
				<Link.Menu inline>
					{!ready || item.finished ? null : (
						<Link.MenuAction icon="checkmark.circle" onPress={() => menu.act(item, "finish")}>
							Mark as Finished
						</Link.MenuAction>
					)}
					{ready && item.opened ? (
						<Link.MenuAction icon="eye.slash" onPress={() => menu.act(item, "unread")}>
							Mark as Unread
						</Link.MenuAction>
					) : null}
					<Link.MenuAction
						icon="newspaper"
						onPress={() => menu.act(item, item.shortlisted ? "unshortlist" : "shortlist")}
					>
						{item.shortlisted ? "Remove from Next Edition" : "Add to Next Edition"}
					</Link.MenuAction>
					<Link.MenuAction icon="tag" onPress={() => menu.tag(item)}>
						Tags…
					</Link.MenuAction>
					<Link.MenuAction icon="pencil" onPress={() => menu.act(item, "rename")}>
						Rename…
					</Link.MenuAction>
				</Link.Menu>
			) : null}
			{original(saved ? null : share)}
			<Link.Menu inline>
				{select}
				<Link.MenuAction icon="trash" destructive onPress={() => menu.act(item, "delete")}>
					Delete
				</Link.MenuAction>
			</Link.Menu>
		</Link.Menu>
	)
}

/** The system share sheet with the original's address, and its title for apps that show one. */
function shareArticle(item: ArticleSummary) {
	void Share.share({ url: item.url, title: item.title ?? undefined })
}

function openReader(item: ArticleSummary) {
	router.push({ pathname: "/read/[id]", params: { id: item.id } })
}

/** A card's line: the site and reading time, and how the save went. */
function metaLine(item: ArticleSummary): string {
	return withStatus(articleMeta(item), item)
}

/** The line with how the save went, when it isn't simply ready, or that it is in the trash. */
function withStatus(line: string, item: ArticleSummary): string {
	const status = item.trashedAt
		? "In the trash"
		: item.status === "failed"
			? "Couldn't save"
			: item.status === "ready"
				? item.finished
					? "Finished"
					: null
				: "Saving…"
	return status ? [line, status].filter(Boolean).join(" · ") : line
}

function reading(item: ArticleSummary): boolean {
	return item.status === "ready" && item.progress > 0 && item.progress < 1
}

/** The article's lead image, 16:10 with rounded corners, or a placeholder without one. */
export function CardPicture({
	item,
	colors,
	headers,
	radius = 12,
}: {
	item: ArticleSummary
	colors: Colors
	headers: Record<string, string> | null
	radius?: number
}) {
	const { apiUrl } = useAuth()
	const [failed, setFailed] = usePictureFailure(headers)
	const source = failed ? null : leadImageSource(item.leadImage, apiUrl, headers)
	return (
		<View style={[styles.picture, { backgroundColor: colors.muted, borderRadius: radius }]}>
			{source ? (
				<Image
					source={source}
					recyclingKey={item.id}
					contentFit="cover"
					transition={150}
					style={StyleSheet.absoluteFill}
					onError={setFailed}
				/>
			) : (
				<SymbolView
					name="newspaper"
					tintColor={colors.border}
					size={28}
					accessibilityElementsHidden
				/>
			)}
		</View>
	)
}

export function ProgressBar({ progress, colors }: { progress: number; colors: Colors }) {
	return (
		<View style={[styles.track, { backgroundColor: colors.border }]}>
			<View
				style={[
					styles.progress,
					{ backgroundColor: colors.accent, width: `${Math.round(progress * 100)}%` },
				]}
			/>
		</View>
	)
}

/** How often the lists check the token behind the pictures' headers. */
const HEADERS_CHECK_MS = 60_000

/**
 * The headers stored pictures need, once the token is at hand (null until then). Checked again
 * every minute and when the app comes back: the token expires while the app stays open, and
 * pictures would then fail until it relaunched. The same headers keep the same object.
 */
export function useImageHeaders(): Record<string, string> | null {
	const { imageHeaders, state } = useAuth()
	const [headers, setHeaders] = useState<Record<string, string> | null>(null)
	const signedIn = state.status === "signed-in"
	useEffect(() => {
		if (!signedIn) return
		let live = true
		const update = () =>
			imageHeaders()
				.then((next) => {
					if (live)
						setHeaders((shown) => (shown?.authorization === next.authorization ? shown : next))
				})
				.catch(() => undefined)
		void update()
		const timer = setInterval(update, HEADERS_CHECK_MS)
		const sub = AppState.addEventListener("change", (appState) => {
			if (appState === "active") void update()
		})
		return () => {
			live = false
			clearInterval(timer)
			sub.remove()
		}
	}, [imageHeaders, signedIn])
	return headers
}

/** A picture that failed with these headers; new headers (a fresh token) try it again. */
function usePictureFailure(headers: Record<string, string> | null): [boolean, () => void] {
	const [failedWith, setFailedWith] = useState<{ headers: typeof headers } | null>(null)
	return [failedWith?.headers === headers, () => setFailedWith({ headers })]
}

const GAP = 16
const TINT = 8
/** How far a framed card's background reaches past its content (`ArticleCard`'s `framed`). */
export const CARD_FRAME = TINT
// A row's frame reaches this far past its content, into the list's side margins.
const ROW_INSET = 12

/**
 * Articles in the layout chosen with the header's switch (`LayoutButton`): two columns of cards,
 * as the web's grid on a narrow screen, or rows. With a `selection`, taps check articles; a
 * checked one is tinted, as on the web.
 */
export function ArticleList(
	props: Omit<FlatListProps<ArticleSummary>, "renderItem" | "numColumns"> & {
		headers: Record<string, string> | null
		selection?: Selection | null
		/** The long-press menu, when the list can act on its articles; none while selecting. */
		menu?: CardMenu | null
	},
) {
	const colors = useColors()
	const layout = useListLayout()
	const { width } = useWindowDimensions()
	const { headers, selection, menu, contentContainerStyle, ...rest } = props
	// Two columns with the gap between them and at both sides. A card's frame (its background, and
	// the tint of a checked one) reaches past its content by `TINT`, on every side.
	const cell = { width: (width - GAP * 3) / 2 + TINT * 2, margin: -TINT }
	const check = (item: ArticleSummary) =>
		selection
			? { checked: selection.checked.has(item.id), onCheck: () => selection.toggle(item.id) }
			: { menu }
	const shared = {
		...rest,
		extraData: selection,
		keyExtractor: (item: ArticleSummary) => item.id,
		contentInsetAdjustmentBehavior: "automatic" as const,
		style: { backgroundColor: colors.bg },
	}
	// A FlatList can't change its number of columns: each layout is a list of its own.
	return layout === "list" ? (
		<FlatList
			key="list"
			{...shared}
			contentContainerStyle={[styles.rows, contentContainerStyle]}
			ItemSeparatorComponent={() => (
				<View style={[styles.separator, { backgroundColor: colors.divider }]} />
			)}
			renderItem={({ item }) => (
				<ArticleRow item={item} colors={colors} headers={headers} {...check(item)} />
			)}
		/>
	) : (
		<FlatList
			key="grid"
			{...shared}
			numColumns={2}
			columnWrapperStyle={styles.row}
			contentContainerStyle={[styles.grid, contentContainerStyle]}
			renderItem={({ item }) => {
				const { checked, onCheck, menu: cardMenu } = check(item)
				return (
					<View style={cell}>
						<ArticleCard
							item={item}
							colors={colors}
							headers={headers}
							checked={checked}
							onCheck={onCheck}
							menu={cardMenu}
							framed
						/>
					</View>
				)
			}}
		/>
	)
}

const styles = StyleSheet.create({
	grid: { paddingHorizontal: GAP, paddingTop: 8, paddingBottom: 32, gap: 24 },
	row: { gap: GAP },
	rows: { paddingHorizontal: GAP, paddingBottom: 32 },
	framed: { padding: TINT, borderRadius: 12 + TINT },
	articleRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		marginHorizontal: -ROW_INSET,
		paddingHorizontal: ROW_INSET,
		borderRadius: 12,
	},
	rowBody: { flex: 1, gap: 6, paddingVertical: 16 },
	rowDetails: { flexDirection: "row", gap: 14 },
	rowText: { flex: 1, gap: 8 },
	site: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase" },
	thumb: { width: 76, height: 76, borderRadius: 10, overflow: "hidden" },
	// A full point, from edge to edge.
	separator: { height: 1, marginHorizontal: -GAP },
	card: { gap: 6 },
	pressed: { opacity: 0.6 },
	picture: {
		aspectRatio: 16 / 10,
		overflow: "hidden",
		alignItems: "center",
		justifyContent: "center",
	},
	title: { fontFamily: "Iowan Old Style", fontSize: 17, lineHeight: 21, fontWeight: "600" },
	rowTitle: { fontFamily: "Iowan Old Style", fontSize: 19, lineHeight: 24, fontWeight: "600" },
	meta: { fontSize: 13 },
	description: { fontSize: 14, lineHeight: 19 },
	check: {
		width: 24,
		height: 24,
		borderRadius: 12,
		borderWidth: 2,
		alignItems: "center",
		justifyContent: "center",
	},
	checkOnPicture: { borderColor: "#fff", backgroundColor: "#0000004d" },
	pictureCheck: { position: "absolute", top: 8, left: 8 },
	starred: { flexDirection: "row", alignItems: "center", gap: 4 },
	shrink: { flexShrink: 1 },
	track: { height: 3, borderRadius: 2, overflow: "hidden" },
	progress: { height: 3 },
})
