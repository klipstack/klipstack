import type { KlipstackClient, LinkPreview } from "@klipstack/sdk"
import { Image } from "expo-image"
import { type SFSymbol, SymbolView } from "expo-symbols"
import { useEffect, useState } from "react"
import {
	ActivityIndicator,
	Linking,
	Modal,
	Pressable,
	ScrollView,
	Share,
	StyleSheet,
	Text,
	View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { copyText } from "@/lib/clipboard"
import type { Colors } from "@/lib/theme"

/** A link tapped in an article: its URL and its text. */
export type TappedLink = { href: string; text: string }

/**
 * What to do with a link in an article, as the web reader's link card: what the page is (its
 * site, picture, title, author and description, from `GET /links/preview`), then save it to
 * Klipstack (or read it there, when it is saved), open it in the phone's browser, copy or share
 * it. Whether it is saved is asked when the card opens (`POST /articles/lookup`).
 */
export function LinkCard({
	link,
	client,
	onClose,
	onRead,
	colors,
}: {
	link: TappedLink | null
	client: KlipstackClient | null
	onClose: () => void
	/** Opens a saved article in the reader. */
	onRead: (id: string) => void
	colors: Colors
}) {
	const insets = useSafeAreaInsets()
	return (
		<Modal visible={link !== null} transparent animationType="slide" onRequestClose={onClose}>
			<Pressable accessibilityLabel="Close" style={styles.fill} onPress={onClose} />
			{link ? (
				<View
					style={[
						styles.card,
						{
							backgroundColor: colors.bg,
							borderColor: colors.border,
							paddingBottom: Math.max(insets.bottom, 16),
						},
					]}
				>
					{/* A new link: the key resets what the card knows about it. */}
					<About key={`about:${link.href}`} link={link} client={client} colors={colors} />
					<SaveRow key={link.href} link={link} client={client} onRead={onRead} colors={colors} />
					<Row
						label="Open in Browser"
						symbol="safari"
						colors={colors}
						onPress={() => {
							onClose()
							void Linking.openURL(link.href)
						}}
					/>
					<Row
						label="Copy Link"
						symbol="doc.on.doc"
						colors={colors}
						onPress={() => {
							onClose()
							void copyText(link.href)
						}}
					/>
					<Row
						label="Share…"
						symbol="square.and.arrow.up"
						colors={colors}
						onPress={() => {
							onClose()
							void Share.share({ url: link.href })
						}}
					/>
				</View>
			) : null}
		</Modal>
	)
}

type Saved =
	| { state: "checking" }
	| { state: "unsaved" }
	| { state: "saving" }
	| { state: "saved"; id: string; justSaved: boolean }
	| { state: "failed"; message: string }

/**
 * The page behind the link. Its site (or host) and the link's text show at once; the preview
 * fills in the rest, and a page without one keeps them.
 */
function About({
	link,
	client,
	colors,
}: {
	link: TappedLink
	client: KlipstackClient | null
	colors: Colors
}) {
	// undefined while loading; null when there is none.
	const [preview, setPreview] = useState<LinkPreview | null | undefined>(undefined)
	const [imageFailed, setImageFailed] = useState(false)

	useEffect(() => {
		if (!client) return
		let live = true
		client.links
			.preview(link.href)
			.then(({ preview }) => live && setPreview(preview))
			// Older servers, the rate limit, no network: the card works without it.
			.catch(() => live && setPreview(null))
		return () => {
			live = false
		}
	}, [client, link.href])

	const title = preview?.title || link.text || hostOf(link.href)
	const image = preview?.imageUrl && !imageFailed ? preview.imageUrl : null
	return (
		<ScrollView style={styles.about} contentContainerStyle={styles.aboutContent} bounces={false}>
			{image ? (
				<Image
					source={{ uri: image }}
					onError={() => setImageFailed(true)}
					contentFit="cover"
					transition={150}
					accessibilityIgnoresInvertColors
					style={[styles.image, { backgroundColor: colors.muted }]}
				/>
			) : null}
			<Text style={[styles.site, { color: colors.mutedFg }]} numberOfLines={1}>
				{preview?.siteName || hostOf(link.href)}
			</Text>
			<Text style={[styles.title, { color: colors.fg }]} numberOfLines={3}>
				{title}
			</Text>
			{preview?.author ? (
				<Text style={[styles.author, { color: colors.mutedFg }]} numberOfLines={1}>
					{preview.author}
				</Text>
			) : null}
			{preview?.description ? (
				<Text style={[styles.description, { color: colors.mutedFg }]} numberOfLines={4}>
					{preview.description}
				</Text>
			) : null}
			{preview === undefined ? (
				<View accessibilityLabel="Loading the preview" style={styles.placeholder}>
					<View style={[styles.bar, { backgroundColor: colors.muted }]} />
					<View style={[styles.bar, styles.shortBar, { backgroundColor: colors.muted }]} />
				</View>
			) : null}
		</ScrollView>
	)
}

/** "Save to Klipstack", or "Read in Klipstack" when the link is in the library. */
function SaveRow({
	link,
	client,
	onRead,
	colors,
}: {
	link: TappedLink
	client: KlipstackClient | null
	onRead: (id: string) => void
	colors: Colors
}) {
	const [saved, setSaved] = useState<Saved>({ state: "checking" })

	useEffect(() => {
		if (!client) return
		let live = true
		client.articles
			.lookup([link.href])
			.then(({ items }) => {
				if (!live) return
				const id = items[0]?.id
				setSaved(id ? { state: "saved", id, justSaved: false } : { state: "unsaved" })
			})
			// Unknown: offer to save; saving a saved link returns it.
			.catch(() => live && setSaved({ state: "unsaved" }))
		return () => {
			live = false
		}
	}, [client, link.href])

	async function save() {
		if (!client) return
		setSaved({ state: "saving" })
		try {
			const { article } = await client.articles.save({ url: link.href })
			setSaved({ state: "saved", id: article.id, justSaved: true })
		} catch (e) {
			setSaved({ state: "failed", message: e instanceof Error ? e.message : String(e) })
		}
	}

	if (saved.state === "checking" || saved.state === "saving")
		return (
			<View style={styles.row}>
				<ActivityIndicator color={colors.mutedFg} style={styles.icon} />
				<Text style={[styles.label, { color: colors.mutedFg }]}>
					{saved.state === "saving" ? "Saving…" : "Save to Klipstack"}
				</Text>
			</View>
		)
	if (saved.state === "saved")
		return (
			<>
				{saved.justSaved ? (
					<View style={styles.row}>
						<SymbolView
							name="checkmark.circle.fill"
							tintColor={colors.accent}
							size={22}
							style={styles.icon}
						/>
						<Text style={[styles.label, { color: colors.fg }]}>Saved to Klipstack</Text>
					</View>
				) : null}
				<Row
					label="Read in Klipstack"
					symbol="book"
					colors={colors}
					onPress={() => onRead(saved.id)}
				/>
			</>
		)
	return (
		<>
			<Row label="Save to Klipstack" symbol="plus.circle" colors={colors} onPress={save} />
			{saved.state === "failed" ? (
				<Text style={[styles.error, { color: colors.danger }]}>{saved.message}</Text>
			) : null}
		</>
	)
}

function Row({
	label,
	symbol,
	colors,
	onPress,
}: {
	label: string
	symbol: SFSymbol
	colors: Colors
	onPress: () => void
}) {
	return (
		<Pressable
			accessibilityRole="button"
			onPress={onPress}
			style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.muted }]}
		>
			<SymbolView name={symbol} tintColor={colors.accent} size={22} style={styles.icon} />
			<Text style={[styles.label, { color: colors.fg }]}>{label}</Text>
		</Pressable>
	)
}

/** The site's address without "www.": dropbox.com, en.wikipedia.org. */
function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "")
	} catch {
		return url
	}
}

const styles = StyleSheet.create({
	fill: { flex: 1 },
	card: {
		paddingTop: 18,
		paddingHorizontal: 8,
		borderTopLeftRadius: 20,
		borderTopRightRadius: 20,
		borderWidth: StyleSheet.hairlineWidth,
		shadowColor: "#000",
		shadowOpacity: 0.18,
		shadowRadius: 16,
		shadowOffset: { width: 0, height: -2 },
	},
	about: { maxHeight: 420, flexGrow: 0 },
	aboutContent: { paddingHorizontal: 12, paddingBottom: 12, gap: 6 },
	image: { height: 160, borderRadius: 12, marginBottom: 6 },
	site: { fontSize: 13, fontWeight: "500" },
	title: { fontSize: 18, fontWeight: "600", lineHeight: 23 },
	author: { fontSize: 14 },
	description: { fontSize: 15, lineHeight: 21 },
	placeholder: { gap: 8, paddingTop: 4 },
	bar: { height: 8, borderRadius: 4 },
	shortBar: { width: "66%" },
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		minHeight: 50,
		paddingHorizontal: 12,
		borderRadius: 10,
	},
	icon: { width: 26, height: 26 },
	label: { fontSize: 17 },
	error: { fontSize: 14, paddingHorizontal: 12, paddingBottom: 8 },
})
