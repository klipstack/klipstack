import type { Highlight, KlipstackClient, NotebookArticle, NotebookItem } from "@klipstack/sdk"
import { Image } from "expo-image"
import { Link } from "expo-router"
import { SymbolView } from "expo-symbols"
import { type ReactElement, useState } from "react"
import { Pressable, Share, StyleSheet, Text, View } from "react-native"
import { MarkerText } from "@/components/marker-text"
import type { NoteLinking } from "@/components/note-field"
import { ArticleNote, HighlightNote } from "@/components/notebook-note"
import { siteName } from "@/lib/article-meta"
import { useAuth } from "@/lib/auth"
import { copyText } from "@/lib/clipboard"
import { leadImageSource } from "@/lib/lead-image"
import { fromStored } from "@/lib/note-field"
import type { SavedNote } from "@/lib/note-guard"
import { countLine, type NotebookEntry, type NotebookGroup, plural } from "@/lib/notebook"
import type { Colors } from "@/lib/theme"

/** What every card needs from the screen: the client, the pictures' headers, note links, edits. */
export type CardContext = {
	client: KlipstackClient
	colors: Colors
	headers: Record<string, string> | null
	linking: (articleId: string) => NoteLinking
	/** The article's note saved here. */
	onArticleNote: (articleId: string, saved: SavedNote) => void
	/** The highlight's note saved here. */
	onHighlightNote: (id: string, note: string | null) => void
	onDelete: (highlight: Highlight) => void
}

/** Highlights an article's section shows before "Show all", as on the web. */
const COLLAPSED = 6

/** A dealt hand lies a little askew, as cards on a table do (Shuffle). Degrees. */
const DEALT = [-1, 0.7, -0.4, 1, 0.3]

/**
 * By article: the article (its cover, title and site), its note on a large post-it (a blank one
 * to write it on), then its highlights as cards, the first few with the way to all of them.
 */
export function ArticleSection({ entry, ctx }: { entry: NotebookEntry; ctx: CardContext }) {
	const [open, setOpen] = useState(false)
	const { article, highlights } = entry
	const { colors } = ctx
	const count = highlights.length
	const shown = open ? highlights : highlights.slice(0, COLLAPSED)
	const title = titleOf(article)
	return (
		<View style={styles.section}>
			<Link href={{ pathname: "/read/[id]", params: { id: article.id } }} push asChild>
				<Pressable accessibilityRole="link" accessibilityLabel={`Open ${title}`}>
					<Cover article={article} colors={colors} headers={ctx.headers} />
					<Text style={[styles.sectionTitle, { color: colors.fg }]}>{title}</Text>
					<Text style={[styles.meta, { color: colors.mutedFg }]} numberOfLines={1}>
						{[siteName(article), authorOf(article), count ? plural(count, "highlight") : null]
							.filter(Boolean)
							.join(" · ")}
					</Text>
				</Pressable>
			</Link>
			<ArticleNote
				articleId={article.id}
				note={entry.note ?? ""}
				noteUpdatedAt={entry.noteUpdatedAt}
				editable
				client={ctx.client}
				linking={ctx.linking(article.id)}
				colors={colors}
				onSaved={(saved) => ctx.onArticleNote(article.id, saved)}
			/>
			{shown.map((h) => (
				<QuoteCard key={h.id} highlight={h} article={article} withArticle={false} ctx={ctx} />
			))}
			{count > COLLAPSED ? (
				<Pressable
					accessibilityRole="button"
					onPress={() => setOpen((o) => !o)}
					hitSlop={8}
					style={styles.more}
				>
					<Text style={[styles.moreText, { color: colors.accent }]}>
						{open ? "Show Less" : `Show All ${count}`}
					</Text>
				</Pressable>
			) : null}
		</View>
	)
}

/** By topic: a topic's newest cards, and the way to all of them (the stream, narrowed to it). */
export function TopicSection({
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
		<View style={styles.section}>
			<View style={styles.topicHead}>
				<View style={styles.topicName}>
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
						<Text style={[styles.moreText, { color: colors.accent }]}>See All {total}</Text>
					</Pressable>
				) : null}
			</View>
			{group.items.map((item) => (
				<Card key={cardKey(item)} item={item} ctx={ctx} />
			))}
		</View>
	)
}

function cardKey(item: NotebookItem): string {
	return item.kind === "highlight" ? item.highlight.id : `note:${item.article.id}`
}

/** A card of Stream, Shuffle or By topic: a highlight, or an article's note. */
export function Card({
	item,
	dealt,
	ctx,
}: {
	item: NotebookItem
	dealt?: number
	ctx: CardContext
}) {
	return item.kind === "highlight" ? (
		<QuoteCard highlight={item.highlight} article={item.article} ctx={ctx} dealt={dealt} />
	) : (
		<NoteCard item={item} ctx={ctx} dealt={dealt} />
	)
}

/**
 * A highlight's card: the quote, marked in its color, large when short; its note on a small post-it
 * in its color, written on in place; and, outside its article's section, where it is from. A tap on
 * the quote opens the article at the highlight; a long press, its menu (Copy, Share, Add Note,
 * Delete).
 */
export function QuoteCard({
	highlight,
	article,
	withArticle = true,
	dealt,
	ctx,
}: {
	highlight: Highlight
	article: NotebookArticle
	withArticle?: boolean
	dealt?: number
	ctx: CardContext
}) {
	const { colors } = ctx
	const [pressed, setPressed] = useState(false)
	const [writing, setWriting] = useState(false)
	const quote = oneLine(highlight.quote)
	const actions: ReactElement[] = [
		<Link.MenuAction key="copy" icon="doc.on.doc" onPress={() => void copyText(highlight.quote)}>
			Copy
		</Link.MenuAction>,
		<Link.MenuAction
			key="share"
			icon="square.and.arrow.up"
			onPress={() =>
				void Share.share({ message: `“${quote}”\n\n${titleOf(article)}`, url: article.url })
			}
		>
			Share
		</Link.MenuAction>,
	]
	if (!highlight.note)
		actions.push(
			<Link.MenuAction key="note" icon="note.text.badge.plus" onPress={() => setWriting(true)}>
				Add Note
			</Link.MenuAction>,
		)
	actions.push(
		<Link.MenuAction key="delete" icon="trash" destructive onPress={() => ctx.onDelete(highlight)}>
			Delete
		</Link.MenuAction>,
	)
	return (
		<View style={[styles.card, cardSurface(colors), dealtTilt(dealt)]}>
			<Link
				href={{ pathname: "/read/[id]", params: { id: article.id, highlight: highlight.id } }}
				push
				asChild
			>
				<Link.Trigger>
					<Pressable
						accessibilityRole="link"
						onPressIn={() => setPressed(true)}
						onPressOut={() => setPressed(false)}
						// The Link takes one style object, not a list.
						style={StyleSheet.flatten([
							styles.press,
							{ backgroundColor: cardSurface(colors).backgroundColor },
							pressed && styles.pressed,
						])}
					>
						<MarkerText
							text={quote}
							color={highlight.color}
							seed={highlight.id}
							numberOfLines={14}
							colors={colors}
							style={[styles.quote, quoteSize(quote), { color: colors.fg }]}
						/>
						{withArticle ? (
							<View style={styles.from}>
								<Thumb article={article} size={28} colors={colors} headers={ctx.headers} />
								<Text style={[styles.fromText, { color: colors.mutedFg }]} numberOfLines={1}>
									{[article.title, siteName(article)].filter(Boolean).join(" · ")}
								</Text>
							</View>
						) : null}
					</Pressable>
				</Link.Trigger>
				<Link.Menu>{actions}</Link.Menu>
			</Link>
			<HighlightNote
				highlight={highlight}
				editing={writing}
				setEditing={setWriting}
				client={ctx.client}
				linking={ctx.linking(article.id)}
				colors={colors}
				onSaved={(note) => ctx.onHighlightNote(highlight.id, note)}
			/>
		</View>
	)
}

/**
 * An article's note among the cards: the article at the top (a small cover, the title set as a
 * book's, author and site in small caps), and the note as a large post-it on it, written on in
 * place (read-only where the same note shows above it, By topic). A tap on the article opens it.
 */
export function NoteCard({
	item,
	dealt,
	ctx,
}: {
	item: Extract<NotebookItem, { kind: "note" }>
	dealt?: number
	ctx: CardContext
}) {
	const { colors } = ctx
	const { article } = item
	const title = titleOf(article)
	const byline = [authorOf(article), siteName(article)].filter(Boolean).join(" · ")
	return (
		<View style={[styles.card, cardSurface(colors), dealtTilt(dealt)]}>
			<Link href={{ pathname: "/read/[id]", params: { id: article.id } }} push asChild>
				<Link.Trigger>
					<Pressable
						accessibilityRole="link"
						accessibilityLabel={`Open ${title}`}
						style={StyleSheet.flatten([
							styles.noteHead,
							{ backgroundColor: cardSurface(colors).backgroundColor },
						])}
					>
						<Thumb article={article} size={56} colors={colors} headers={ctx.headers} />
						<View style={styles.noteTitle}>
							<Text style={[styles.bookTitle, { color: colors.fg }]} numberOfLines={3}>
								{title}
							</Text>
							{byline ? (
								<Text style={[styles.smallCaps, { color: colors.mutedFg }]} numberOfLines={1}>
									{byline}
								</Text>
							) : null}
						</View>
					</Pressable>
				</Link.Trigger>
				<Link.Menu>
					<Link.MenuAction
						icon="doc.on.doc"
						onPress={() => void copyText(fromStored(item.note).text)}
					>
						Copy Note
					</Link.MenuAction>
					<Link.MenuAction
						icon="square.and.arrow.up"
						onPress={() =>
							void Share.share({
								message: `${fromStored(item.note).text}\n\n${title}`,
								url: article.url,
							})
						}
					>
						Share
					</Link.MenuAction>
				</Link.Menu>
			</Link>
			<ArticleNote
				articleId={article.id}
				note={item.note}
				noteUpdatedAt={item.noteUpdatedAt}
				editable={item.editable}
				client={ctx.client}
				linking={ctx.linking(article.id)}
				colors={colors}
				onSaved={(saved) => ctx.onArticleNote(article.id, saved)}
			/>
		</View>
	)
}

/** The article's cover, wide, above its title; nothing without one. */
function Cover({
	article,
	colors,
	headers,
}: {
	article: NotebookArticle
	colors: Colors
	headers: Record<string, string> | null
}) {
	const { apiUrl } = useAuth()
	const [failed, setFailed] = useState(false)
	const source = failed ? null : leadImageSource(article.leadImage, apiUrl, headers)
	if (!source) return null
	return (
		<Image
			source={source}
			recyclingKey={article.id}
			contentFit="cover"
			transition={150}
			onError={() => setFailed(true)}
			style={[styles.cover, { backgroundColor: colors.muted }]}
		/>
	)
}

/** A small square of the article's cover, or of its site's mark without one. */
export function Thumb({
	article,
	size,
	colors,
	headers,
}: {
	article: NotebookArticle
	size: number
	colors: Colors
	headers: Record<string, string> | null
}) {
	const { apiUrl } = useAuth()
	const [failed, setFailed] = useState(false)
	const source = failed ? null : leadImageSource(article.leadImage, apiUrl, headers)
	const box = { width: size, height: size, borderRadius: size / 6, backgroundColor: colors.muted }
	return (
		<View style={[styles.thumb, box]}>
			{source ? (
				<Image
					source={source}
					recyclingKey={article.id}
					contentFit="cover"
					onError={() => setFailed(true)}
					style={StyleSheet.absoluteFill}
				/>
			) : (
				<SymbolView
					name="newspaper"
					tintColor={colors.mutedFg}
					size={size / 2.2}
					accessibilityElementsHidden
				/>
			)}
		</View>
	)
}

/**
 * Nothing kept yet: a small drawing of a post-it with nothing on it, taped on and leaning, in the
 * notes' paper, as the web's.
 */
export function BlankPostIt({ colors }: { colors: Colors }) {
	return (
		<View style={[styles.blank, { backgroundColor: colors.note.paper }]}>
			<View style={[styles.blankTape, { backgroundColor: colors.note.tape }]} />
			{[0, 1, 2].map((i) => (
				<View key={i} style={[styles.blankLine, { backgroundColor: `${colors.note.fg}26` }]} />
			))}
		</View>
	)
}

/** The author, unless the site says the same (a personal site). */
export function authorOf(article: NotebookArticle): string | null {
	return article.author && article.author !== siteName(article) ? article.author : null
}

export function titleOf(article: NotebookArticle): string {
	return article.title || article.url
}

/** Runs of spaces and line breaks as one space, as the web shows a quote. */
export function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim()
}

/** Short quotes read large; long ones step down so a card stays a card. */
function quoteSize(text: string) {
	if (text.length <= 90) return { fontSize: 22, lineHeight: 30 }
	if (text.length <= 220) return { fontSize: 19, lineHeight: 27 }
	return { fontSize: 17, lineHeight: 25 }
}

export function cardSurface(colors: Colors) {
	return { backgroundColor: colors.card, borderColor: colors.border }
}

function dealtTilt(dealt: number | undefined) {
	return dealt === undefined
		? null
		: { transform: [{ rotate: `${DEALT[dealt % DEALT.length]}deg` }] }
}

const styles = StyleSheet.create({
	section: { gap: 14 },
	cover: { width: "100%", aspectRatio: 2, borderRadius: 12, marginBottom: 12 },
	sectionTitle: { fontFamily: "Iowan Old Style", fontSize: 22, lineHeight: 28 },
	meta: { fontSize: 14, marginTop: 2 },
	more: { alignSelf: "flex-start", paddingVertical: 4 },
	moreText: { fontSize: 15, fontWeight: "500" },
	topicHead: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
	topicName: { flex: 1 },
	topicTitle: { fontFamily: "Iowan Old Style", fontSize: 26, lineHeight: 32 },
	card: {
		borderRadius: 16,
		borderWidth: StyleSheet.hairlineWidth,
		paddingHorizontal: 16,
		paddingTop: 14,
		paddingBottom: 16,
		boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
	},
	// Room around the quote, past the card's padding, so it lifts as one piece under the menu.
	press: { gap: 12, borderRadius: 10, margin: -8, padding: 8 },
	pressed: { opacity: 0.6 },
	quote: { fontFamily: "Iowan Old Style" },
	from: { flexDirection: "row", alignItems: "center", gap: 8 },
	fromText: { flex: 1, fontSize: 13 },
	noteHead: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
	noteTitle: { flex: 1 },
	bookTitle: {
		fontFamily: "Iowan Old Style",
		fontStyle: "italic",
		fontSize: 20,
		lineHeight: 26,
	},
	// Small caps, as the web's: the system has none for Iowan, so small capitals by hand.
	smallCaps: { fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", marginTop: 4 },
	thumb: { overflow: "hidden", alignItems: "center", justifyContent: "center" },
	blank: {
		width: 92,
		height: 82,
		paddingTop: 30,
		paddingHorizontal: 14,
		gap: 14,
		transform: [{ rotate: "-3deg" }],
		boxShadow: "0 8px 10px rgba(0, 0, 0, 0.18)",
		borderBottomRightRadius: 14,
	},
	blankTape: {
		position: "absolute",
		top: -8,
		left: 26,
		width: 40,
		height: 16,
		transform: [{ rotate: "-4deg" }],
		boxShadow: "0 1px 2px rgba(0, 0, 0, 0.12)",
	},
	blankLine: { height: 1.5, borderRadius: 1 },
})
