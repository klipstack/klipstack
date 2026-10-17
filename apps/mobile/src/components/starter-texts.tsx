import type { KlipstackClient, StarterText } from "@klipstack/sdk"
import { router, useFocusEffect } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useCallback, useRef, useState } from "react"
import {
	Alert,
	Pressable,
	ScrollView,
	type StyleProp,
	StyleSheet,
	Text,
	View,
	type ViewStyle,
} from "react-native"
import { canUseOffline, keepStarter, keptStarter } from "@/lib/offline"
import {
	STARTER_DESCRIPTION,
	type StarterOffer as Offer,
	starterBook,
	starterLabel,
	starterRefusal,
} from "@/lib/starter-texts"
import { type Colors, fonts, useScheme } from "@/lib/theme"

/**
 * Texts to start with as books on a shelf, as the web's (apps/web/app/components/starter-texts.tsx):
 * a book faces out, cover first, painted as the Topics shelves' books are. One the reader has
 * carries a ribbon and opens their copy; the others are added with a tap, and open. The guide is
 * not one of the books: it has a card of its own (`StarterGuide`).
 */

/**
 * Adding a text and opening it, or opening the reader's copy: the text being added (its slug), and
 * the tap. A refusal, or no connection, says why.
 */
export function useAddStarter(client: KlipstackClient | null) {
	const [adding, setAdding] = useState<string | null>(null)
	const busy = useRef(false)
	const open = useCallback(
		async (item: StarterText) => {
			if (item.articleId)
				return router.push({ pathname: "/read/[id]", params: { id: item.articleId } })
			if (!client || busy.current) return
			busy.current = true
			setAdding(item.slug)
			try {
				const { articleId } = await client.starterTexts.save(item.slug)
				router.push({ pathname: "/read/[id]", params: { id: articleId } })
			} catch (e) {
				Alert.alert("Not added", starterRefusal(e))
			} finally {
				busy.current = false
				setAdding(null)
			}
		},
		[client],
	)
	return { adding, open }
}

export function StarterShelf({
	items,
	readerLanguage,
	wide = false,
	inset = 16,
	style,
	adding,
	onOpen,
	colors,
}: {
	items: StarterText[]
	/** Room before the first book and after the last, as the page's margin: the shelf runs edge to edge. */
	inset?: number
	style?: StyleProp<ViewStyle>
	/** A book in another language is read out in its own. */
	readerLanguage: string
	/** A screen of its own: bigger books, each with a line about it. */
	wide?: boolean
	adding: string | null
	onOpen: (item: StarterText) => void
	colors: Colors
}) {
	return (
		// The books stand on the shelf's board; past the width, the shelf scrolls.
		<View style={[styles.board, { borderBottomColor: colors.shelf.board }, style]}>
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={[styles.books, { paddingHorizontal: inset }]}
			>
				{items.map((item) => (
					<StarterBook
						key={item.slug}
						item={item}
						foreign={item.language !== readerLanguage}
						wide={wide}
						adding={adding === item.slug}
						disabled={adding !== null}
						onPress={() => onOpen(item)}
						colors={colors}
					/>
				))}
			</ScrollView>
		</View>
	)
}

function StarterBook({
	item,
	foreign,
	wide,
	adding,
	disabled,
	onPress,
	colors,
}: {
	item: StarterText
	foreign: boolean
	wide: boolean
	adding: boolean
	disabled: boolean
	onPress: () => void
	colors: Colors
}) {
	const scheme = useScheme()
	const { color, taller } = starterBook(item.slug, scheme)
	const ink = { color: colors.shelf.bookFg }
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={starterLabel(item)}
			accessibilityLanguage={foreign ? item.language : undefined}
			accessibilityState={{ busy: adding, disabled }}
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => [
				styles.book,
				wide ? styles.wideBook : styles.smallBook,
				{
					height: (wide ? 208 : 150) + taller,
					backgroundColor: color,
					opacity: adding ? 0.6 : 1,
					transform: [{ translateY: pressed ? -4 : 0 }],
				},
			]}
		>
			{/* The spine's fold down the left edge. */}
			<View style={styles.fold} />
			<Text
				numberOfLines={5}
				allowFontScaling={false}
				style={[styles.bookTitle, wide ? styles.wideTitle : null, ink]}
			>
				{item.title}
			</Text>
			{wide && item.description ? (
				<Text numberOfLines={4} allowFontScaling={false} style={[styles.bookLine, ink]}>
					{item.description}
				</Text>
			) : null}
			<View style={styles.bookFoot}>
				<Text numberOfLines={2} allowFontScaling={false} style={[styles.author, ink]}>
					{item.author}
				</Text>
				<Text allowFontScaling={false} style={[styles.minutes, ink]}>
					{item.minutes} min
				</Text>
				{/* On the site that publishes it: adding it saves it from there. */}
				{item.site ? (
					<View style={styles.site}>
						<SymbolView name="globe" size={10} tintColor={colors.shelf.bookFg} />
						<Text numberOfLines={1} allowFontScaling={false} style={[styles.minutes, ink]}>
							{item.site}
						</Text>
					</View>
				) : null}
			</View>
			{item.articleId ? (
				// A ribbon: this one is in the library.
				<View style={styles.ribbon}>
					<SymbolView name="bookmark.fill" size={20} tintColor={colors.favorite} />
				</View>
			) : (
				<View style={[styles.plus, { backgroundColor: `${colors.bg}d9` }]}>
					<SymbolView name="plus" size={12} weight="semibold" tintColor={colors.fg} />
				</View>
			)}
		</Pressable>
	)
}

/**
 * The guide to Klipstack, as a card rather than a book among the essays: a short line on what it
 * is, and the button that adds it, or opens the reader's copy.
 */
export function StarterGuide({
	item,
	adding,
	onOpen,
	colors,
}: {
	item: StarterText
	adding: string | null
	onOpen: (item: StarterText) => void
	colors: Colors
}) {
	const saved = Boolean(item.articleId)
	return (
		<View
			style={[
				styles.guide,
				{
					backgroundColor: colors.muted,
					borderColor: colors.border,
					opacity: adding === item.slug ? 0.6 : 1,
				},
			]}
		>
			{/* The house's own book, in its colors. */}
			<View
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={[styles.guideBook, { backgroundColor: colors.accent }]}
			>
				<Text
					numberOfLines={1}
					adjustsFontSizeToFit
					allowFontScaling={false}
					style={[styles.guideBookText, { color: colors.accentFg }]}
				>
					Klipstack
				</Text>
			</View>
			<View style={styles.guideText}>
				<Text style={[styles.eyebrow, { color: colors.mutedFg }]}>
					{saved ? "In your library" : "New to Klipstack?"}
				</Text>
				<Text style={[styles.guideTitle, { color: colors.fg }]}>{item.title}</Text>
				<Text style={[styles.guideLine, { color: colors.mutedFg }]}>
					Saving, highlighting and notes, in {item.minutes} min.
				</Text>
			</View>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={saved ? `Open ${item.title}` : `Add ${item.title} to your library`}
				disabled={adding !== null}
				onPress={() => onOpen(item)}
				style={({ pressed }) => [
					styles.guideButton,
					saved
						? { backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1 }
						: { backgroundColor: colors.accent },
					{ opacity: pressed ? 0.7 : 1 },
				]}
			>
				<SymbolView
					name={saved ? "bookmark.fill" : "plus"}
					size={13}
					weight="semibold"
					tintColor={saved ? colors.favorite : colors.accentFg}
				/>
				<Text style={[styles.guideButtonText, { color: saved ? colors.fg : colors.accentFg }]}>
					{saved ? "Open" : "Read it"}
				</Text>
			</Pressable>
		</View>
	)
}

/**
 * What Home offers when it has nothing to read, as the web's: the guide while the reader is new,
 * a few texts from different topics, and the way to the rest (Discover). Loaded on each return to
 * Home, kept for offline; nothing while there is nothing to offer.
 */
export function StarterOffer({
	client,
	margin,
	colors,
}: {
	client: KlipstackClient | null
	/** The page's side margin, which the shelf runs past to the screen's edges. */
	margin: number
	colors: Colors
}) {
	const [offer, setOffer] = useState<Offer | null>(() => keptStarter<Offer>("starter-offer"))
	const { adding, open } = useAddStarter(client)
	useFocusEffect(
		useCallback(() => {
			client?.starterTexts
				.offer()
				.then((answer) => {
					setOffer(answer)
					keepStarter("starter-offer", answer)
				})
				.catch((e: unknown) => {
					// A server before them answers 404: Home without the offer. Offline, the one kept.
					if (!canUseOffline(e)) setOffer(null)
				})
		}, [client]),
	)
	if (!offer || (!offer.guide && !offer.texts.length)) return null
	const language = offer.guide?.language ?? offer.texts[0]!.language
	return (
		<View style={styles.offer}>
			<Text accessibilityRole="header" style={[styles.offerTitle, { color: colors.fg }]}>
				Or start with one of these
			</Text>
			{offer.guide ? (
				<StarterGuide item={offer.guide} adding={adding} onOpen={open} colors={colors} />
			) : null}
			{offer.texts.length ? (
				<>
					<Text style={[styles.description, { color: colors.mutedFg }]}>{STARTER_DESCRIPTION}</Text>
					<StarterShelf
						items={offer.texts}
						inset={margin}
						style={{ marginHorizontal: -margin }}
						readerLanguage={language}
						adding={adding}
						onOpen={open}
						colors={colors}
					/>
				</>
			) : null}
			<Pressable
				accessibilityRole="link"
				accessibilityLabel="More to read"
				hitSlop={8}
				onPress={() => router.push("/discover")}
				style={({ pressed }) => [styles.more, { opacity: pressed ? 0.6 : 1 }]}
			>
				<Text style={[styles.moreText, { color: colors.accent }]}>More to read</Text>
				<SymbolView name="chevron.right" size={12} weight="semibold" tintColor={colors.accent} />
			</Pressable>
		</View>
	)
}

const styles = StyleSheet.create({
	board: { borderBottomWidth: 7 },
	books: { alignItems: "flex-end", gap: 12, paddingTop: 12 },
	book: {
		borderTopLeftRadius: 3,
		borderBottomLeftRadius: 3,
		borderTopRightRadius: 6,
		borderBottomRightRadius: 6,
		padding: 12,
		paddingLeft: 16,
		shadowColor: "#000",
		shadowOpacity: 0.12,
		shadowRadius: 2,
		shadowOffset: { width: 0, height: 1 },
	},
	smallBook: { width: 120 },
	wideBook: { width: 160 },
	fold: {
		position: "absolute",
		left: 0,
		top: 0,
		bottom: 0,
		width: 5,
		backgroundColor: "rgba(0,0,0,0.08)",
		borderRightWidth: 1,
		borderRightColor: "rgba(255,255,255,0.2)",
		borderTopLeftRadius: 3,
		borderBottomLeftRadius: 3,
	},
	bookTitle: { fontFamily: fonts.display, fontSize: 15, lineHeight: 19 },
	wideTitle: { fontSize: 17, lineHeight: 21 },
	bookLine: { marginTop: 8, fontSize: 11, lineHeight: 14, opacity: 0.75 },
	bookFoot: { marginTop: "auto", paddingTop: 8, paddingRight: 26 },
	author: { fontSize: 11, lineHeight: 13, opacity: 0.8 },
	minutes: { fontSize: 11, lineHeight: 13, opacity: 0.65 },
	site: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
	ribbon: { position: "absolute", top: -2, right: 8 },
	plus: {
		position: "absolute",
		right: 8,
		bottom: 8,
		width: 24,
		height: 24,
		borderRadius: 12,
		alignItems: "center",
		justifyContent: "center",
	},
	guide: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		borderRadius: 14,
		borderWidth: StyleSheet.hairlineWidth,
		padding: 12,
		paddingRight: 14,
	},
	guideBook: {
		width: 46,
		height: 62,
		borderTopLeftRadius: 2,
		borderBottomLeftRadius: 2,
		borderTopRightRadius: 4,
		borderBottomRightRadius: 4,
		justifyContent: "flex-end",
		padding: 5,
	},
	guideBookText: { fontFamily: fonts.display, fontSize: 8, lineHeight: 10 },
	guideText: { flex: 1, gap: 1 },
	eyebrow: { fontSize: 12, fontWeight: "500" },
	guideTitle: { fontFamily: fonts.display, fontSize: 18, lineHeight: 23 },
	guideLine: { fontSize: 13, lineHeight: 17 },
	guideButton: {
		flexDirection: "row",
		alignItems: "center",
		gap: 5,
		borderRadius: 999,
		paddingHorizontal: 12,
		paddingVertical: 7,
	},
	guideButtonText: { fontSize: 14, fontWeight: "600" },
	offer: { alignSelf: "stretch", gap: 12, marginTop: 32 },
	offerTitle: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28 },
	description: { fontSize: 14, lineHeight: 20 },
	more: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
	moreText: { fontSize: 15 },
})
