import type { NotebookItem } from "@klipstack/sdk"
import { FlashList } from "@shopify/flash-list"
import { Link } from "expo-router"
import { type ReactElement, useState } from "react"
import { Pressable, type RefreshControlProps, StyleSheet, Text, View } from "react-native"
import { CLIP_TOP, ClippingPaper } from "@/components/clipping"
import { MarkerText } from "@/components/marker-text"
import { type CardContext, oneLine, Thumb, titleOf } from "@/components/notebook-cards"
import { PostIt, postItText } from "@/components/post-it"
import { siteName } from "@/lib/article-meta"
import { copyText } from "@/lib/clipboard"
import { fromStored } from "@/lib/note-field"
import {
	countLine,
	type NotebookEntry,
	type NotebookGroup,
	plural,
	type ZoomTile,
} from "@/lib/notebook"
import { tiltFor } from "@/lib/post-it"

/**
 * The Notebook zoomed out: everything as small cards in two columns, each card under the shorter
 * column, to take in more at a glance. Headings and "Show all" cross both columns. Nothing is
 * written on here: a tap opens the highlight or the article in the reader; a long press, a
 * highlight's menu. One flat, virtualized list (FlashList's masonry): only what is on screen is
 * drawn, however much the reader kept.
 */
export function NotebookWall({
	tiles,
	ctx,
	onToggle,
	onSeeAll,
	header,
	empty,
	footer,
	refreshControl,
	onEndReached,
}: {
	tiles: ZoomTile[]
	ctx: CardContext
	/** Shows all of an article's cards, or folds them again. */
	onToggle: (articleId: string) => void
	onSeeAll: (topic: string) => void
	header: ReactElement
	empty: ReactElement
	footer: ReactElement | null
	refreshControl: ReactElement<RefreshControlProps>
	onEndReached: () => void
}) {
	const { colors } = ctx
	return (
		<FlashList
			data={tiles}
			masonry
			numColumns={2}
			optimizeItemArrangement
			keyExtractor={(tile) => tile.id}
			getItemType={(tile) => tile.kind}
			overrideItemLayout={(layout, tile) => {
				layout.span = tile.kind === "tile" ? 1 : 2
			}}
			contentInsetAdjustmentBehavior="automatic"
			automaticallyAdjustKeyboardInsets
			keyboardShouldPersistTaps="handled"
			keyboardDismissMode="on-drag"
			contentContainerStyle={styles.list}
			renderItem={({ item: tile, index }) => {
				switch (tile.kind) {
					case "tile":
						return (
							<View style={styles.cell}>
								{/* Keyed: a reused cell starts fresh, without the last card's strokes or press. */}
								<Tile key={tile.id} item={tile.item} withArticle={tile.withArticle} ctx={ctx} />
							</View>
						)
					case "article":
						return <ArticleHead entry={tile.entry} first={index === 0} ctx={ctx} />
					case "topic":
						return <TopicHead group={tile.group} onSeeAll={onSeeAll} ctx={ctx} />
					case "more":
						return (
							<Pressable
								accessibilityRole="button"
								hitSlop={8}
								onPress={() => onToggle(tile.articleId)}
								style={styles.moreRow}
							>
								<Text style={[styles.more, { color: colors.accent }]}>
									{tile.open ? "Show Less" : `Show All ${tile.count}`}
								</Text>
							</Pressable>
						)
				}
			}}
			refreshControl={refreshControl}
			onEndReached={onEndReached}
			onEndReachedThreshold={0.5}
			// The page's margin, as the tiles have it: the list's own is less their half gap.
			ListHeaderComponent={<View style={styles.edge}>{header}</View>}
			ListFooterComponent={footer}
			ListEmptyComponent={<View style={styles.edge}>{empty}</View>}
		/>
	)
}

/** By article: the article's line, across both columns, with a rule above it. */
function ArticleHead({
	entry,
	first,
	ctx,
}: {
	entry: NotebookEntry
	/** The wall's first: no rule above it. */
	first: boolean
	ctx: CardContext
}) {
	const { article } = entry
	const { colors } = ctx
	return (
		<View style={[styles.head, first ? styles.firstHead : { borderTopColor: colors.divider }]}>
			<Link href={{ pathname: "/read/[id]", params: { id: article.id } }} push asChild>
				<Pressable accessibilityRole="link" style={styles.articleLine}>
					<Thumb
						key={article.id}
						article={article}
						size={32}
						colors={colors}
						headers={ctx.headers}
					/>
					<View style={styles.articleText}>
						<Text style={[styles.articleTitle, { color: colors.fg }]} numberOfLines={1}>
							{titleOf(article)}
						</Text>
						<Text style={[styles.meta, { color: colors.mutedFg }]} numberOfLines={1}>
							{[
								siteName(article),
								entry.highlights.length ? plural(entry.highlights.length, "highlight") : null,
							]
								.filter(Boolean)
								.join(" · ")}
						</Text>
					</View>
				</Pressable>
			</Link>
		</View>
	)
}

/** By topic: the topic's name and counts, and the way to all of it. */
function TopicHead({
	group,
	onSeeAll,
	ctx,
}: {
	group: NotebookGroup
	onSeeAll: (topic: string) => void
	ctx: CardContext
}) {
	const { colors } = ctx
	const total = group.highlights + group.notes
	return (
		<View style={[styles.head, styles.topicHead]}>
			<View style={styles.articleText}>
				<Text style={[styles.topicTitle, { color: colors.fg }]}>
					{group.topic?.name ?? "Other"}
				</Text>
				<Text style={[styles.meta, { color: colors.mutedFg }]}>
					{countLine(group.highlights, group.notes)}
				</Text>
			</View>
			{total > group.items.length ? (
				<Pressable
					accessibilityRole="button"
					hitSlop={8}
					onPress={() => onSeeAll(group.topic?.id ?? "none")}
				>
					<Text style={[styles.more, { color: colors.accent }]}>See All {total}</Text>
				</Pressable>
			) : null}
		</View>
	)
}

/**
 * A small card: a highlight's quote, marked, with its note on a little post-it in its color; or an
 * article's note on classic paper under its title. A tap opens it in the reader.
 */
function Tile({
	item,
	withArticle,
	ctx,
}: {
	item: NotebookItem
	withArticle: boolean
	ctx: CardContext
}) {
	const { colors } = ctx
	const [pressed, setPressed] = useState(false)
	const { article } = item
	const surface = StyleSheet.flatten([styles.tile, pressed && styles.pressed])
	const press = {
		onPressIn: () => setPressed(true),
		onPressOut: () => setPressed(false),
	}
	if (item.kind === "note")
		return (
			<Link href={{ pathname: "/read/[id]", params: { id: article.id } }} push asChild>
				<Pressable accessibilityRole="link" style={surface} {...press}>
					<ClippingPaper id={article.id} compact colors={colors} />
					{withArticle ? (
						<Text style={[styles.noteTitle, { color: colors.fg }]} numberOfLines={2}>
							{titleOf(article)}
						</Text>
					) : null}
					<PostIt variant="compact" tilt={tiltFor(article.id)} colors={colors} style={styles.paper}>
						<Text style={[postItText(colors, "compact"), styles.small]} numberOfLines={8}>
							{fromStored(item.note).text}
						</Text>
					</PostIt>
				</Pressable>
			</Link>
		)
	const { highlight } = item
	const quote = oneLine(highlight.quote)
	return (
		<Link
			href={{ pathname: "/read/[id]", params: { id: article.id, highlight: highlight.id } }}
			push
			asChild
		>
			<Link.Trigger>
				<Pressable accessibilityRole="link" style={surface} {...press}>
					<ClippingPaper id={highlight.id} compact colors={colors} />
					<MarkerText
						text={quote}
						color={highlight.color}
						seed={highlight.id}
						numberOfLines={7}
						colors={colors}
						style={[styles.quote, { color: colors.fg }]}
					/>
					{highlight.note ? (
						<PostIt
							variant="compact"
							tilt={tiltFor(highlight.id)}
							color={highlight.color}
							colors={colors}
							style={styles.paper}
						>
							<Text
								style={[postItText(colors, "compact", highlight.color), styles.small]}
								numberOfLines={4}
							>
								{fromStored(highlight.note).text}
							</Text>
						</PostIt>
					) : null}
					{withArticle ? (
						<Text style={[styles.from, { color: colors.mutedFg }]} numberOfLines={1}>
							{titleOf(article)}
						</Text>
					) : null}
				</Pressable>
			</Link.Trigger>
			<Link.Menu>
				<Link.MenuAction icon="doc.on.doc" onPress={() => void copyText(highlight.quote)}>
					Copy
				</Link.MenuAction>
				<Link.MenuAction icon="square.and.arrow.up" onPress={() => ctx.onShare(highlight, article)}>
					Share
				</Link.MenuAction>
				<Link.MenuAction icon="trash" destructive onPress={() => ctx.onDelete(highlight)}>
					Delete
				</Link.MenuAction>
			</Link.Menu>
		</Link>
	)
}

/** Half the gap between cards, around each: the columns stand a full gap apart. */
const HALF = 5

const styles = StyleSheet.create({
	// The page's margin, less the cards' own half gap.
	list: { paddingHorizontal: 16 - HALF, paddingBottom: 48 },
	cell: { padding: HALF },
	edge: { paddingHorizontal: HALF },
	head: {
		paddingHorizontal: HALF,
		paddingTop: 20,
		paddingBottom: 8,
		marginTop: 8,
		borderTopWidth: StyleSheet.hairlineWidth,
	},
	firstHead: { borderTopWidth: 0, marginTop: 0, paddingTop: 4 },
	articleLine: { flexDirection: "row", alignItems: "center", gap: 10 },
	articleText: { flex: 1 },
	articleTitle: { fontFamily: "Iowan Old Style", fontSize: 17, lineHeight: 22 },
	topicHead: { flexDirection: "row", alignItems: "flex-end", gap: 12, borderTopWidth: 0 },
	topicTitle: { fontFamily: "Iowan Old Style", fontSize: 20, lineHeight: 26 },
	meta: { fontSize: 12, marginTop: 1 },
	moreRow: { paddingHorizontal: HALF, paddingVertical: 8, alignSelf: "flex-start" },
	more: { fontSize: 14, fontWeight: "500" },
	// A small clipping (`ClippingPaper`): its paper starts `CLIP_TOP` down, under the tape.
	tile: { padding: 10, paddingTop: CLIP_TOP + 10, gap: 8 },
	pressed: { opacity: 0.6 },
	quote: { fontFamily: "Iowan Old Style", fontSize: 14, lineHeight: 19 },
	noteTitle: { fontFamily: "Iowan Old Style", fontStyle: "italic", fontSize: 14, lineHeight: 18 },
	// Room above for its tape.
	paper: { marginTop: 6, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 8 },
	small: { fontSize: 13, lineHeight: 17 },
	from: { fontSize: 11 },
})
