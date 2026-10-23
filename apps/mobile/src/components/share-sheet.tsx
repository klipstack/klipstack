import type { HighlightShare } from "@klipstack/api-contract"
import { highlightShareText } from "@klipstack/api-contract/highlight-share"
import { extractLinkIds } from "@klipstack/api-contract/note-links"
import { KlipstackApiError, type Highlight, type KlipstackClient } from "@klipstack/sdk"
import { Image } from "expo-image"
import { SymbolView, type SymbolViewProps } from "expo-symbols"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import {
	ActivityIndicator,
	Alert,
	Modal,
	Pressable,
	ScrollView,
	Share,
	StyleSheet,
	Switch,
	Text,
	View,
} from "react-native"
import { ClippingPaper, CLIP_TOP } from "@/components/clipping"
import { hostOf } from "@/components/link-card"
import { PostIt, postItText } from "@/components/post-it"
import { copyRich, copyText } from "@/lib/clipboard"
import { language, t } from "@/lib/i18n"
import { fromStored } from "@/lib/note-field"
import { tiltFor } from "@/lib/post-it"
import { loadShareTab, saveShareTab, writeShareImage } from "@/lib/reader-files"
import {
	linkErrorMessage,
	linkStale,
	REMOVED,
	SHARE_TABS,
	type ShareTab,
	shownTab,
	TAB_LABELS,
} from "@/lib/share-highlight"
import { type Colors, useColors } from "@/lib/theme"

/** What the sheet shares: a highlight, and the article it is from. */
type Shareable = Pick<Highlight, "id" | "quote" | "note"> & { article: ShareArticle }
type ShareArticle = Pick<Highlight["article"], "title" | "site" | "author" | "url">

/**
 * The Share sheet for a screen's highlights: `open` shows it for one, `sheet` goes in the screen.
 * `onShared` hears when the highlight starts or stops having a live link, for its "Shared" mark.
 */
export function useShareSheet(
	client: KlipstackClient | null,
	onShared?: (id: string, shared: boolean) => void,
): {
	open: (highlight: Pick<Highlight, "id" | "quote" | "note">, article: ShareArticle) => void
	sheet: ReactNode
} {
	const colors = useColors()
	// The highlight shown, kept while the sheet slides away; `opened` counts the times it opened,
	// so each opening starts afresh.
	const [shown, setShown] = useState<{ highlight: Shareable; opened: number } | null>(null)
	const [visible, setVisible] = useState(false)
	const open = useCallback((h: Pick<Highlight, "id" | "quote" | "note">, article: ShareArticle) => {
		setShown((was) => ({
			highlight: { id: h.id, quote: h.quote, note: h.note, article },
			opened: (was?.opened ?? 0) + 1,
		}))
		setVisible(true)
	}, [])
	const close = () => setVisible(false)
	const sheet = (
		<Modal
			visible={visible}
			presentationStyle="pageSheet"
			animationType="slide"
			onRequestClose={close}
		>
			{shown ? (
				<ShareSheet
					key={shown.opened}
					client={client}
					highlight={shown.highlight}
					onShared={(shared) => onShared?.(shown.highlight.id, shared)}
					onClose={close}
					colors={colors}
				/>
			) : null}
		</Modal>
	)
	return { open, sheet }
}

/**
 * Sharing a highlight, as the web's Share dialog: a preview of what goes out, whether the note goes
 * too, and three ways out. Text: the share sheet with plain text, or Copy (rich text, and plain).
 * Link: a public page (`/h/<id>`) showing a snapshot until updated or stopped. Image: a picture,
 * wide or tall, drawn by the server, to the share sheet. It opens on Link for a highlight with a
 * live link, else on the tab chosen last.
 */
function ShareSheet({
	client,
	highlight: h,
	onShared,
	onClose,
	colors,
}: {
	client: KlipstackClient | null
	highlight: Shareable
	onShared: (shared: boolean) => void
	onClose: () => void
	colors: Colors
}) {
	const note = h.note?.trim() ? h.note : null
	const [withNote, setWithNote] = useState(true)
	const link = usePublicLink(client, h.id, onShared)
	// A link shared already: the switch says what its page shows, until the reader changes it.
	const [linkedNote, setLinkedNote] = useState<string | null>(null)
	if (link.share && !link.share.removed && linkedNote !== link.share.publicId) {
		setLinkedNote(link.share.publicId)
		setWithNote(link.share.includeNote)
	}
	const [last, setLast] = useState<ShareTab>(loadShareTab)
	const [chosen, setChosen] = useState(false)
	const tab = shownTab(link.share, last, chosen)
	const choose = (next: ShareTab) => {
		setChosen(true)
		setLast(next)
		saveShareTab(next)
	}
	const linkUrls = useLinkUrls(client, note)
	const text = () =>
		highlightShareText(
			{
				exact: h.quote,
				note,
				article: {
					title: h.article.title,
					url: h.article.url,
					siteName: h.article.site,
					author: h.article.author,
				},
				linkUrls: linkUrls ?? {},
			},
			withNote,
		)

	return (
		<View style={[styles.sheet, { backgroundColor: colors.bg }]}>
			<View style={[styles.bar, { borderColor: colors.border }]}>
				<Text style={[styles.title, { color: colors.fg }]}>{t("reader.share.title")}</Text>
				<Pressable accessibilityRole="button" onPress={onClose} hitSlop={12} style={styles.done}>
					<Text style={[styles.doneText, { color: colors.accent }]}>
						{t("common.actions.done")}
					</Text>
				</Pressable>
			</View>
			<ScrollView contentContainerStyle={styles.body}>
				<Segments
					label={t("reader.share.shareAs")}
					options={SHARE_TABS.map((t) => ({ value: t, label: TAB_LABELS[t] }))}
					value={tab}
					onChange={choose}
					colors={colors}
				/>
				{note ? (
					<View style={styles.switchRow}>
						<Text style={[styles.switchLabel, { color: colors.fg }]}>
							{t("reader.share.includeNote")}
						</Text>
						<Switch
							accessibilityLabel={t("reader.share.includeNote")}
							value={withNote}
							onValueChange={setWithNote}
						/>
					</View>
				) : null}
				{tab === "image" ? (
					<ImagePanel
						client={client}
						id={h.id}
						withNote={note !== null && withNote}
						colors={colors}
					/>
				) : (
					<Preview highlight={h} note={withNote ? note : null} colors={colors} />
				)}
				{tab === "text" ? (
					<TextPanel text={text} ready={linkUrls !== null} colors={colors} />
				) : tab === "link" ? (
					<LinkPanel
						link={link}
						withNote={withNote}
						hasNote={note !== null}
						locale={language}
						colors={colors}
					/>
				) : null}
			</ScrollView>
		</View>
	)
}

/** A segmented control: one choice among a few, as iOS draws it. */
function Segments<T extends string>({
	label,
	options,
	value,
	onChange,
	colors,
}: {
	label: string
	options: Array<{ value: T; label: string }>
	value: T
	onChange: (value: T) => void
	colors: Colors
}) {
	return (
		<View
			accessibilityRole="tablist"
			accessibilityLabel={label}
			style={[styles.segments, { backgroundColor: colors.muted }]}
		>
			{options.map((o) => {
				const on = o.value === value
				return (
					<Pressable
						key={o.value}
						accessibilityRole="tab"
						accessibilityState={{ selected: on }}
						onPress={() => onChange(o.value)}
						style={[
							styles.segment,
							on ? [styles.segmentOn, { backgroundColor: colors.card }] : null,
						]}
					>
						<Text
							style={[
								styles.segmentText,
								{ color: on ? colors.fg : colors.mutedFg, fontWeight: on ? "600" : "400" },
							]}
						>
							{o.label}
						</Text>
					</Pressable>
				)
			})}
		</View>
	)
}

/** What goes out, as its page shows it: the quote on a clipping, the note on a post-it. */
function Preview({
	highlight: h,
	note,
	colors,
}: {
	highlight: Shareable
	note: string | null
	colors: Colors
}) {
	const shown = note ? fromStored(note).text : null
	return (
		<View testID="share-preview" style={styles.clipping}>
			<ClippingPaper id={h.id} colors={colors} />
			<Text style={[styles.quote, { color: colors.fg }]} numberOfLines={8}>
				{t("reader.share.quote", { quote: h.quote.trim() })}
			</Text>
			{shown ? (
				<PostIt
					variant="compact"
					fit={shown}
					tilt={tiltFor(h.id)}
					colors={colors}
					style={styles.note}
				>
					<Text style={postItText(colors, "compact")} numberOfLines={6}>
						{shown}
					</Text>
				</PostIt>
			) : null}
			<View style={[styles.credit, { borderColor: colors.border }]}>
				<Text style={[styles.creditTitle, { color: colors.fg }]} numberOfLines={2}>
					{h.article.title ?? h.article.url}
				</Text>
				<Text style={[styles.creditSite, { color: colors.mutedFg }]} numberOfLines={1}>
					{h.article.site ?? hostOf(h.article.url)}
				</Text>
			</View>
		</View>
	)
}

function TextPanel({
	text,
	ready,
	colors,
}: {
	text: () => { plain: string; html: string }
	ready: boolean
	colors: Colors
}) {
	const [copied, setCopied] = useState(false)
	return (
		<View style={styles.actions}>
			<Action
				icon="square.and.arrow.up"
				label={t("reader.share.shareText")}
				primary
				disabled={!ready}
				onPress={() => void Share.share({ message: text().plain }).catch(() => {})}
				colors={colors}
			/>
			<Action
				icon={copied ? "checkmark" : "doc.on.doc"}
				label={copied ? t("reader.share.copied") : t("reader.share.copy")}
				disabled={!ready}
				onPress={() => {
					const { html, plain } = text()
					void copyRich(html, plain).then(() => setCopied(true))
				}}
				colors={colors}
			/>
		</View>
	)
}

function LinkPanel({
	link,
	withNote,
	hasNote,
	locale,
	colors,
}: {
	link: ReturnType<typeof usePublicLink>
	withNote: boolean
	hasNote: boolean
	locale: "en" | "es"
	colors: Colors
}) {
	const { share, busy, error, change } = link
	const [copied, setCopied] = useState(false)
	const muted = [styles.message, { color: colors.mutedFg }]
	if (share === undefined)
		return <ActivityIndicator style={styles.loading} color={colors.mutedFg} />
	if (share?.removed) return <Text style={muted}>{REMOVED}</Text>
	const failed = error ? (
		<Text accessibilityRole="alert" style={[styles.message, { color: colors.danger }]}>
			{linkErrorMessage(error)}
		</Text>
	) : null
	if (!share)
		return (
			<View style={styles.panel}>
				<Text style={muted}>
					{withNote && hasNote ? t("reader.share.aboutWithNote") : t("reader.share.about")}
				</Text>
				<View style={styles.actions}>
					<Action
						icon="link"
						label={t("reader.share.createLink")}
						primary
						disabled={busy}
						onPress={() => change({ share: { includeNote: withNote, locale } })}
						colors={colors}
					/>
				</View>
				{failed}
			</View>
		)
	const stale = linkStale(share, withNote)
	return (
		<View style={styles.panel}>
			<Text
				selectable
				style={[styles.address, { color: colors.fg, borderColor: colors.border }]}
				numberOfLines={1}
			>
				{share.url}
			</Text>
			{stale ? <Text style={muted}>{t("reader.share.stale")}</Text> : null}
			<View style={styles.actions}>
				<Action
					icon="square.and.arrow.up"
					label={t("reader.share.shareLink")}
					primary
					onPress={() => void Share.share({ url: share.url }).catch(() => {})}
					colors={colors}
				/>
				<Action
					icon={copied ? "checkmark" : "doc.on.doc"}
					label={copied ? t("reader.share.copied") : t("reader.share.copyLink")}
					onPress={() => void copyText(share.url).then(() => setCopied(true))}
					colors={colors}
				/>
			</View>
			<View style={styles.actions}>
				{stale ? (
					<Action
						icon="arrow.clockwise"
						label={t("reader.share.updateLink")}
						disabled={busy}
						onPress={() => change({ share: { includeNote: withNote, locale } })}
						colors={colors}
					/>
				) : null}
				<Action
					icon="xmark.circle"
					label={t("reader.share.stop")}
					destructive
					disabled={busy}
					onPress={() =>
						Alert.alert(t("reader.share.stopTitle"), t("reader.share.stopMessage"), [
							{ text: t("common.actions.cancel"), style: "cancel" },
							{
								text: t("reader.share.stop"),
								style: "destructive",
								onPress: () => change("stop"),
							},
						])
					}
					colors={colors}
				/>
			</View>
			<Text style={muted}>{t("reader.share.all")}</Text>
			{failed}
		</View>
	)
}

type ImageShape = "wide" | "tall"
type Drawn =
	| { status: "drawing" }
	| { status: "drawn"; uri: string; version: number }
	| { status: "failed"; message: string; retry: boolean }

/** The highlight as a picture, wide or tall, drawn by the server as it is now. */
function ImagePanel({
	client,
	id,
	withNote,
	colors,
}: {
	client: KlipstackClient | null
	id: string
	withNote: boolean
	colors: Colors
}) {
	const [shape, setShape] = useState<ImageShape>("wide")
	// What was drawn, for which shape and note choice: another choice is drawing until it comes.
	// A new attempt draws again, after a failure.
	const [attempt, setAttempt] = useState(0)
	const key = `${shape}:${withNote}:${attempt}`
	const [result, setResult] = useState<{ key: string; drawn: Drawn } | null>(null)
	const drawn: Drawn = result?.key === key ? result.drawn : { status: "drawing" }
	useEffect(() => {
		if (!client) return
		let live = true
		const done = (next: Drawn) => setResult({ key: `${shape}:${withNote}:${attempt}`, drawn: next })
		client.highlights
			.image(id, { shape, note: withNote })
			.then((r) => r.arrayBuffer())
			.then((buffer) => {
				if (!live) return
				const file = writeShareImage(id, shape, new Uint8Array(buffer))
				// Each drawing is a new version of the file: the view shows it, not a cached older one.
				done({ status: "drawn", uri: file.uri, version: Date.now() })
			})
			.catch((e: unknown) => {
				if (!live) return
				const code = e instanceof KlipstackApiError ? e.code : null
				done({
					status: "failed",
					retry: code !== "cannot_draw",
					message:
						code === "cannot_draw"
							? t("reader.share.cannotDraw")
							: code === "rate_limited"
								? t("reader.share.tooManyImages")
								: t("reader.share.drawFailed"),
				})
			})
		return () => {
			live = false
		}
	}, [client, id, shape, withNote, attempt])

	return (
		<View style={styles.panel}>
			<Segments
				label={t("reader.share.shape")}
				options={[
					{ value: "wide", label: t("reader.share.wide") },
					{ value: "tall", label: t("reader.share.tall") },
				]}
				value={shape}
				onChange={setShape}
				colors={colors}
			/>
			<Text style={[styles.message, { color: colors.mutedFg }]}>
				{shape === "wide" ? t("reader.share.wideHint") : t("reader.share.tallHint")}
			</Text>
			<View
				style={[
					styles.picture,
					shape === "wide" ? styles.pictureWide : styles.pictureTall,
					{ backgroundColor: colors.muted },
				]}
			>
				{drawn.status === "drawn" ? (
					<Image
						key={drawn.version}
						source={{ uri: drawn.uri }}
						cachePolicy="none"
						contentFit="contain"
						accessibilityLabel={t("reader.share.image")}
						style={StyleSheet.absoluteFill}
					/>
				) : drawn.status === "drawing" ? (
					<ActivityIndicator
						color={colors.mutedFg}
						accessibilityLabel={t("reader.share.drawing")}
					/>
				) : (
					<Text style={[styles.message, { color: colors.mutedFg }]}>{drawn.message}</Text>
				)}
			</View>
			<View style={styles.actions}>
				{drawn.status === "failed" && drawn.retry ? (
					<Action
						icon="arrow.clockwise"
						label={t("common.actions.retry")}
						onPress={() => setAttempt((n) => n + 1)}
						colors={colors}
					/>
				) : null}
				<Action
					icon="square.and.arrow.up"
					label={t("reader.share.shareImage")}
					primary
					disabled={drawn.status !== "drawn"}
					onPress={() => {
						if (drawn.status === "drawn") void Share.share({ url: drawn.uri }).catch(() => {})
					}}
					colors={colors}
				/>
			</View>
		</View>
	)
}

function Action({
	icon,
	label,
	primary = false,
	destructive = false,
	disabled = false,
	onPress,
	colors,
}: {
	icon: SymbolViewProps["name"]
	label: string
	primary?: boolean
	destructive?: boolean
	disabled?: boolean
	onPress: () => void
	colors: Colors
}) {
	const fg = primary ? colors.accentFg : destructive ? colors.danger : colors.accent
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => [
				styles.action,
				{ backgroundColor: primary ? colors.accent : colors.muted },
				{ opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
			]}
		>
			<SymbolView name={icon} size={17} tintColor={fg} />
			<Text style={[styles.actionText, { color: fg }]}>{label}</Text>
		</Pressable>
	)
}

type LinkChange = { share: { includeNote: boolean; locale: "en" | "es" } } | "stop"

/**
 * The highlight's public link: undefined while it is looked up, then live, removed or null, with
 * what changes it. A failed change leaves the link as it was, and says why.
 */
function usePublicLink(
	client: KlipstackClient | null,
	id: string,
	onShared: (shared: boolean) => void,
) {
	const [share, setShare] = useState<HighlightShare | undefined>(undefined)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const heard = useRef(onShared)
	useEffect(() => {
		heard.current = onShared
	})
	useEffect(() => {
		if (!client) return
		let live = true
		client.highlights
			.getShare(id)
			.then((answer) => live && setShare(answer.share))
			// Unknown: the Link tab offers to create one, and the server says if it can't.
			.catch(() => live && setShare(null))
		return () => {
			live = false
		}
	}, [client, id])
	const change = (what: LinkChange) => {
		if (!client) return
		setBusy(true)
		setError(null)
		const run =
			what === "stop"
				? client.highlights.stopSharing(id).then(() => null)
				: client.highlights.share(id, what.share).then((answer) => answer.share)
		// Heard only when it starts or stops being shared: an update changes neither.
		const wasLive = !!share && !share.removed
		run
			.then((next: HighlightShare) => {
				setShare(next)
				const live = next !== null && !next.removed
				if (live !== wasLive) heard.current(live)
			})
			.catch((e: unknown) => {
				const code = e instanceof KlipstackApiError ? e.code : null
				// Stopped elsewhere already (the web, another phone): it is not shared, as asked.
				if (what === "stop" && code === "not_found") {
					setShare(null)
					if (wasLive) heard.current(false)
					return
				}
				if (code === "share_removed") setShare({ removed: true })
				setError(code ?? "failed")
			})
			.finally(() => setBusy(false))
	}
	return { share, busy, error, change }
}

/**
 * The original address of each article the note links to, by id: shared, its links go there
 * instead of into the reader's library. Null while they are looked up; a failed lookup leaves them
 * as titles.
 */
function useLinkUrls(client: KlipstackClient | null, note: string | null) {
	const ids = note ? extractLinkIds(note) : []
	const key = ids.join(",")
	const [found, setFound] = useState<{ key: string; urls: Record<string, string> } | null>(null)
	useEffect(() => {
		if (!key || !client) return
		let live = true
		client.noteLinks
			.lookup(key.split(","))
			.then((answer) => answer.urls)
			.catch(() => ({}))
			.then((urls) => live && setFound({ key, urls }))
		return () => {
			live = false
		}
	}, [client, key])
	if (!key) return {}
	return found?.key === key ? found.urls : null
}

const styles = StyleSheet.create({
	sheet: { flex: 1 },
	bar: {
		height: 56,
		alignItems: "center",
		justifyContent: "center",
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	title: { fontSize: 17, fontWeight: "600" },
	done: { position: "absolute", right: 16 },
	doneText: { fontSize: 17, fontWeight: "600" },
	body: { padding: 16, gap: 16, paddingBottom: 48 },
	segments: { flexDirection: "row", borderRadius: 9, padding: 2 },
	segment: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 7 },
	segmentOn: {
		shadowColor: "#000",
		shadowOpacity: 0.12,
		shadowRadius: 2,
		shadowOffset: { width: 0, height: 1 },
	},
	segmentText: { fontSize: 14 },
	switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
	switchLabel: { fontSize: 17 },
	clipping: { paddingHorizontal: 20, paddingTop: CLIP_TOP + 14, paddingBottom: 16 },
	quote: { fontFamily: "Iowan Old Style", fontSize: 18, lineHeight: 27 },
	note: { marginTop: 14, alignSelf: "flex-end" },
	credit: { marginTop: 14, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
	creditTitle: { fontSize: 15, fontWeight: "600" },
	creditSite: { fontSize: 13, marginTop: 2 },
	panel: { gap: 12 },
	actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
	action: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		paddingHorizontal: 14,
		paddingVertical: 10,
		borderRadius: 10,
	},
	actionText: { fontSize: 16, fontWeight: "600" },
	message: { fontSize: 14, lineHeight: 20 },
	loading: { paddingVertical: 24 },
	address: {
		fontSize: 15,
		paddingHorizontal: 12,
		paddingVertical: 10,
		borderRadius: 10,
		borderWidth: StyleSheet.hairlineWidth,
	},
	picture: {
		alignSelf: "center",
		alignItems: "center",
		justifyContent: "center",
		borderRadius: 8,
		overflow: "hidden",
	},
	pictureWide: { width: "100%", aspectRatio: 1200 / 630 },
	pictureTall: { height: 360, aspectRatio: 1080 / 1920 },
})
