import type { HighlightColor } from "@klipstack/api-contract/enums"
import { endState, secondsToFinish } from "@klipstack/api-contract/reading"
import type { ArticleDetails, Highlight } from "@klipstack/sdk"
import { createNoteAutosave, type NoteSaveStatus } from "@klipstack/sdk/note-autosave"
import { router, Stack, useLocalSearchParams, useNavigation } from "expo-router"
import { useCallback, useEffect, useRef, useState } from "react"
import {
	ActivityIndicator,
	Alert,
	Animated,
	AppState,
	Easing,
	Linking,
	PixelRatio,
	Share,
	StyleSheet,
	Text,
	View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { WebView } from "react-native-webview"
import type {
	ShouldStartLoadRequest,
	WebViewMessageEvent,
} from "react-native-webview/lib/WebViewTypes"
import { AppearanceSheet } from "@/components/appearance-sheet"
import { EditionNoteSheet } from "@/components/edition-note-sheet"
import { HighlightCard } from "@/components/highlight-card"
import { LinkCard, type TappedLink } from "@/components/link-card"
import { ListenBar } from "@/components/listen-bar"
import type { NoteLinking } from "@/components/note-field"
import { NotesSheet } from "@/components/notes-sheet"
import { ReaderStatus } from "@/components/reader-status"
import { useTagSheet } from "@/components/tag-sheet"
import { retagged } from "@/lib/article-tags"
import { useAuth } from "@/lib/auth"
import { copyText } from "@/lib/clipboard"
import type { ColorSchemePref } from "@/lib/color-scheme"
import { finishOnLeave, showFinished } from "@/lib/finish-on-leave"
import { minutesLeft } from "@/lib/home"
import {
	canUseOffline,
	loadArticle,
	lostConnection,
	NOT_KEPT,
	saveArticle,
	type StoredHtml,
} from "@/lib/offline"
import { useReadAloud } from "@/lib/read-aloud"
import {
	loadColorScheme,
	loadTypePrefs,
	readerFolder,
	saveColorScheme,
	saveTypePrefs,
	storeAsset,
	writePage,
} from "@/lib/reader-files"
import { clampScale, highlightsJson, localImages, readerHtml, sampleText } from "@/lib/reader-html"
import { textScale, type TypePrefs } from "@/lib/reader-type"
import { createReadingSync } from "@/lib/reading-sync"
import { applyColorScheme, useColors } from "@/lib/theme"
import type { EndAction, PageEnd, PageMessage, PageSelection } from "@/page/messages"
import { canLookUp, lookUp } from "../../../modules/klip-lookup"

/**
 * An article, read in the app: its stored HTML through the API (no web session needed), shown in a
 * WebView styled like the web reader. The page is a file in the article's cache folder; its stored
 * images, which need the app's token, are downloaded there by the app and set as they land.
 */
export default function Reader() {
	// `highlight`: opened from the Highlights tab, at that highlight, with its card open.
	const { id, highlight: openAt } = useLocalSearchParams<{ id: string; highlight?: string }>()
	const { state, apiUrl } = useAuth()
	const colors = useColors()
	const insets = useSafeAreaInsets()
	const client = state.status === "signed-in" ? state.client : null
	const [article, setArticle] = useState<ArticleDetails | null>(null)
	const tags = useTagSheet(client, (changed) => setArticle((a) => a && retagged(a, changed)))
	const [page, setPage] = useState<{ uri: string; folder: string } | null>(null)
	const [error, setError] = useState<string | null>(null)
	/** Counts loads asked for after the first: the article changed on the server (`readPost`). */
	const [generation, setGeneration] = useState(0)
	// The controls at the top float over the page, which runs under them; they hide while the reader
	// scrolls down, and the page says when (`controlsStep` in src/page/controls.ts). Shown while
	// loading.
	const [controls, setControls] = useState(true)
	const showControls = controls || !page
	const controlsHeight = useRef(insets.top + NAV_BAR)
	const web = useRef<WebView>(null)
	// Stored images already in the folder (asset id → file name), set once the page has loaded.
	const images = useRef(new Map<string, string>())
	const loaded = useRef(false)
	const showImage = (id: string, name: string) =>
		web.current?.injectJavaScript(
			`window.klipAsset && window.klipAsset(${JSON.stringify(id)}, ${JSON.stringify(name)}); true;`,
		)
	// The page's current selection, reported as it changes: what "Highlight" saves, by its place.
	const selection = useRef<PageSelection | null>(null)
	// The version the page's text is from: highlight handles move ends within it.
	const versionId = useRef<string | null>(null)
	const [saving, setSaving] = useState(false)
	const [notesOpen, setNotesOpen] = useState(false)
	// The article note as typed, saved as it changes; set up once the details load.
	const [note, setNote] = useState("")
	const [noteStatus, setNoteStatus] = useState<NoteSaveStatus>("idle")
	const noteSave = useRef<ReturnType<typeof createNoteAutosave> | null>(null)
	const flushNote = () => void noteSave.current?.flush()
	// The note for the next edition's readers, from the end block: saved the same way.
	const [editionOpen, setEditionOpen] = useState(false)
	const [editionNote, setEditionNote] = useState("")
	const [editionStatus, setEditionStatus] = useState<NoteSaveStatus>("idle")
	const editionSave = useRef<ReturnType<typeof createNoteAutosave> | null>(null)
	const flushEditionNote = () => void editionSave.current?.flush()
	// Where the reader is, kept in the library as the web reader keeps it; set up once it's ready.
	const reading = useRef<ReturnType<typeof createReadingSync> | null>(null)
	// Finishing on the way out: the end came into view, after long enough on the page for what was
	// left to read (`needed`, set once the details load).
	const [reachedEnd, setReachedEnd] = useState(false)
	const [kept, setKept] = useState(false)
	const [seconds, setSeconds] = useState(0)
	const [needed, setNeeded] = useState<number | null>(null)
	// For the status line: set when the whole minute changes, not on every scroll.
	const [minutes, setMinutes] = useState<number | null>(null)
	// Text size and font, kept on the device; the page is written with them and changed in place.
	const [type, setType] = useState(loadTypePrefs)
	const typeAtLoad = useRef(type)
	const [appearanceOpen, setAppearanceOpen] = useState(false)
	// Light or dark mode, for the whole app; the page follows it (prefers-color-scheme).
	const [scheme, setScheme] = useState(loadColorScheme)
	// How far down the reader is, 0–1: the status line's, moved without rendering the screen.
	const [line] = useState(() => new Animated.Value(0))
	// Reading aloud: its language is guessed from the text when the article has none.
	const text = useRef("")
	const listen = useReadAloud({
		article,
		textSample: () => text.current,
		inject: (script) => web.current?.injectJavaScript(script),
	})

	// Unsaved typing and the exact position go out when the app leaves the foreground and when the
	// reader closes.
	useEffect(() => {
		const sub = AppState.addEventListener("change", (appState) => {
			if (appState !== "active") {
				void noteSave.current?.flush()
				void editionSave.current?.flush()
				reading.current?.flush()
			}
		})
		return () => {
			sub.remove()
			void noteSave.current?.flush()
			noteSave.current?.dispose()
			void editionSave.current?.flush()
			editionSave.current?.dispose()
			reading.current?.flush()
			reading.current?.dispose()
		}
	}, [])

	// Ten seconds with the article on screen (and the app in front) count as reading it.
	useEffect(() => {
		if (!page) return
		let seconds = 0
		const timer = setInterval(() => {
			if (AppState.currentState !== "active") return
			if (++seconds >= 10) {
				reading.current?.engage()
				clearInterval(timer)
			}
		}, 1000)
		return () => clearInterval(timer)
	}, [page])

	// Seconds with the article on screen and the app in front, until they are enough.
	useEffect(() => {
		if (!page || needed === null || seconds >= needed) return
		const timer = setInterval(() => {
			if (AppState.currentState === "active") setSeconds((n) => n + 1)
		}, 1000)
		return () => clearInterval(timer)
	}, [page, needed, seconds])
	const end: PageEnd | null =
		article && needed !== null
			? {
					state: endState({
						finished: article.finished,
						reachedEnd,
						seconds,
						needed,
						kept,
					}),
					archived: article.location === "archive",
					starred: article.starred,
					shortlisted: article.shortlisted,
					editionNote: editionNote.trim() ? editionNote : null,
				}
			: null
	const endJson = end ? JSON.stringify(end) : null
	useEffect(() => {
		if (!endJson || !loaded.current) return
		web.current?.injectJavaScript(`window.klipEnd && window.klipEnd(${endJson}); true;`)
	}, [endJson])
	// Leaving finishes it when the end block says so: as the screen goes (back, a swipe), or, if
	// that was missed, as it unmounts. Once.
	const armed = useRef(false)
	armed.current = end?.state === "finishing"
	const leaving = useRef({ client, id, archived: false })
	leaving.current = { client, id, archived: article?.location === "archive" }
	const finishIfArmed = useCallback(() => {
		const { client: c, id: articleId, archived } = leaving.current
		if (!armed.current || !c || !articleId) return
		armed.current = false
		void finishOnLeave(c, articleId, archived)
	}, [])
	const navigation = useNavigation()
	useEffect(
		() => navigation.addListener("beforeRemove", finishIfArmed),
		[navigation, finishIfArmed],
	)
	useEffect(() => finishIfArmed, [finishIfArmed])

	// Repaint when the highlights change after the page is up (it paints the first ones itself).
	// Notes aren't painted: a note saved doesn't repaint.
	const painted = article ? highlightsJson(article.highlights) : null
	useEffect(() => {
		if (!painted || !loaded.current) return
		web.current?.injectJavaScript(
			`window.klipHighlights && window.klipHighlights(${painted}); true;`,
		)
	}, [painted])

	// The highlight in the card, if open, is marked in the page.
	const [editing, setEditing] = useState<string | null>(null)
	const editingHighlight = article?.highlights.find((h) => h.id === editing) ?? null
	// The link tapped in the article, while its card is open.
	const [link, setLink] = useState<TappedLink | null>(null)
	const cardOpened = useRef(false)
	// A highlight picked in the notes sheet opens once the sheet is gone.
	const openAfterSheet = useRef<string | null>(null)
	// An article opened from a note, or from the sheet's Linked From, opens once the sheet or the
	// card is gone: a screen pushed under them would stay hidden.
	const openAfterClose = useRef<string | null>(null)
	const openPending = () => {
		const target = openAfterClose.current
		openAfterClose.current = null
		if (target) router.push({ pathname: "/read/[id]", params: { id: target } })
	}
	// For the note link picker: what the web's `[[` menu lists.
	const searchLinks = useCallback(
		async (q: string) => (client ? (await client.articles.search(q, { limit: 20 })).items : []),
		[client],
	)
	const recentLinks = useCallback(
		async () =>
			client ? (await client.articles.list({ view: "inbox", sort: "recent", limit: 9 })).items : [],
		[client],
	)
	useEffect(() => {
		if (!loaded.current) return
		web.current?.injectJavaScript(
			`window.klipActive && window.klipActive(${JSON.stringify(editing)}); true;`,
		)
	}, [editing])
	// The part of the screen the card covers: the highlight is kept above it.
	const [covered, setCovered] = useState(0)
	useEffect(() => {
		if (!loaded.current) return
		const at = editing ? covered : 0
		web.current?.injectJavaScript(
			`window.klipReveal && window.klipReveal(${JSON.stringify(editing)}, ${at}); true;`,
		)
	}, [editing, covered])

	useEffect(() => {
		if (!client || !id) return
		let live = true
		;(async () => {
			try {
				// Online, the article is kept for offline reading; offline, the kept copy opens.
				let details: ArticleDetails
				let stored: StoredHtml | null = null
				try {
					details = await client.articles.get(id)
					if (details.status === "ready") {
						stored = await client.articles.html(id)
						saveArticle(details, stored)
					}
				} catch (e) {
					const kept = canUseOffline(e) ? loadArticle(id) : null
					if (!kept) throw lostConnection(e) ? new Error(NOT_KEPT) : e
					details = kept.details
					stored = kept.stored
				}
				if (!live) return
				setArticle(details)
				setNote(details.note ?? "")
				noteSave.current = createNoteAutosave({
					initial: details.note ?? "",
					onStatus: setNoteStatus,
					save: async (text) => {
						await client.articles.setNote(id, text.trim() ? text : null)
					},
				})
				setEditionNote(details.editionNote ?? "")
				editionSave.current?.dispose()
				editionSave.current = createNoteAutosave({
					initial: details.editionNote ?? "",
					onStatus: setEditionStatus,
					save: async (text) => {
						await client.articles.setEditionNote(id, text.trim() ? text : null)
					},
				})
				if (details.status !== "ready" || !stored) return
				// Servers before the reading endpoints send no position: resume at the furthest point.
				const position = details.position ?? details.progress
				// Opened at a highlight, or at the top (readerHtml's `restorable`): the whole article.
				setNeeded(
					secondsToFinish(
						details.readingMinutes,
						!openAt && position >= 0.05 && position <= 0.95 ? position : 0,
					),
				)
				reading.current?.dispose()
				reading.current = createReadingSync({
					opened: details.opened,
					position,
					cycle: details.readingCycle ?? 0,
					open: () => client.articles.open(id),
					save: (at, cycle) => client.articles.setPosition(id, at, { cycle }),
				})
				versionId.current = stored.versionId
				text.current = sampleText(stored.html)
				const sizes = new Map(details.images.map((image) => [image.id, image]))
				const html = localImages(stored.html, sizes)
				if (!live) return
				const folder = readerFolder(id)
				const file = writePage(
					folder,
					readerHtml({
						title: details.title ?? details.url,
						byline: bylineOf(details),
						via: details.via,
						html: html.html,
						highlights: details.highlights,
						fontScale: textScale(typeAtLoad.current.size, PixelRatio.getFontScale()),
						sans: typeAtLoad.current.sans,
						position,
						highlight: openAt,
						top: controlsHeight.current,
					}),
				)
				setPage({ uri: file.uri, folder: folder.uri })
				// Four at a time; an image that fails to download stays a placeholder.
				const queue = [...html.ids]
				const worker = async () => {
					for (let asset = queue.shift(); asset && live; asset = queue.shift()) {
						const name = await storeAsset(folder, asset, client).catch(() => null)
						if (!name || !live) continue
						images.current.set(asset, name)
						if (loaded.current) showImage(asset, name)
					}
				}
				await Promise.all([worker(), worker(), worker(), worker()])
			} catch (e) {
				if (live) setError(e instanceof Error ? e.message : String(e))
			}
		})()
		return () => {
			live = false
		}
	}, [client, id, openAt, generation])

	/**
	 * The article was saved through a post that shared it: read the post instead. The server
	 * extracts the post again; the page loads again once it is ready.
	 */
	async function readPost() {
		if (!client) return
		try {
			const { queued } = await client.articles.readPost(id)
			if (!queued) return
			setPage(null)
			for (let attempt = 0; attempt < 20; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 1000))
				const details = await client.articles.get(id)
				if (details.status !== "queued" && details.status !== "processing") break
			}
		} catch (e) {
			Alert.alert("Couldn't switch to the post", e instanceof Error ? e.message : String(e))
		}
		setGeneration((n) => n + 1)
	}

	function changeType(next: TypePrefs) {
		setType(next)
		typeAtLoad.current = next
		saveTypePrefs(next)
		const size = 16 * clampScale(textScale(next.size, PixelRatio.getFontScale()))
		web.current?.injectJavaScript(
			`window.klipType && window.klipType(${size}, ${next.sans}); true;`,
		)
	}

	function changeScheme(next: ColorSchemePref) {
		setScheme(next)
		saveColorScheme(next)
		applyColorScheme(next)
	}

	async function update(changes: {
		starred?: boolean
		shortlisted?: boolean
		location?: "inbox" | "archive"
		finished?: boolean
	}) {
		if (!client || !article) return
		const before = article
		// Back to the library, or unread: leaving keeps it that way.
		if (changes.location === "inbox" || changes.finished === false) setKept(true)
		// Leaving after this changes nothing more.
		if (changes.location === "archive" || changes.finished) {
			armed.current = false
			setKept(true)
		}
		// Finishing archives too, as in the lists.
		setArticle({ ...article, ...changes, ...(changes.finished ? { location: "archive" } : {}) })
		try {
			const result = await client.articles.update([article.id], changes)
			if (changes.finished) showFinished(client, result.undo, before.location === "archive")
			// Out of the inbox (finishing archives too): back to the list, which no longer shows it.
			if (changes.location === "archive" || changes.finished) router.back()
		} catch (e) {
			setArticle(before)
			Alert.alert("Not saved", e instanceof Error ? e.message : String(e))
		}
	}

	function onMessage(event: WebViewMessageEvent) {
		// The page is ours (src/page/reader-page.ts), and its messages are `PageMessage`s.
		let message: PageMessage
		try {
			message = JSON.parse(event.nativeEvent.data) as PageMessage
		} catch {
			return
		}
		if (listen.onMessage(message)) return
		switch (message.type) {
			case "controls":
				setControls(message.shown)
				break
			case "reading": {
				Animated.timing(line, {
					toValue: message.position,
					duration: 250,
					easing: Easing.linear,
					useNativeDriver: true,
				}).start()
				reading.current?.scrolled(message.position, message.moved)
				if (message.ended) setReachedEnd(true)
				// At the end, the end block says the rest.
				setMinutes(
					minutesLeft({
						readingMinutes: message.ended ? null : (article?.readingMinutes ?? null),
						progress: message.position,
					}),
				)
				break
			}
			case "end":
				endAction(message.action)
				break
			case "highlight":
				setEditing(message.id)
				break
			case "outside":
				setEditing(null)
				break
			case "resize":
				resizeHighlight(message)
				break
			case "mail":
				if (/^mailto:/i.test(message.href)) void Linking.openURL(message.href)
				break
			case "link":
				openLink({ href: message.href, text: message.text })
				break
			case "selection":
				selection.current = message.selection
				break
		}
	}

	function endAction(action: EndAction) {
		if (!article) return
		switch (action) {
			case "star":
				return void update({ starred: !article.starred })
			case "shortlist":
				return void update({ shortlisted: !article.shortlisted })
			case "share":
				return void Share.share({ url: article.url, title: article.title ?? undefined })
			case "keep":
			case "unkeep":
				return setKept(action === "keep")
			case "finish":
				return void update({ finished: true })
			case "edition-note":
				return setEditionOpen(true)
		}
	}

	/**
	 * Saves the selected passage as a highlight, by its place in the article's text (the page's
	 * offsets), so a passage across paragraphs needs no search. Without one (the menu came before
	 * the page's report), by the text the menu had.
	 */
	async function highlight(selectedText: string) {
		if (!client || !article || saving) return
		const picked = selection.current
		const quote = picked?.exact ?? selectedText.trim()
		if (!quote) return
		setSaving(true)
		try {
			const created = await client.highlights.create(
				article.id,
				picked
					? {
							quote,
							start: picked.start,
							end: picked.end,
							prefix: picked.prefix,
							suffix: picked.suffix,
						}
					: { quote },
			)
			web.current?.injectJavaScript(
				"window.klipClearSelection && window.klipClearSelection(); true;",
			)
			setArticle((current) =>
				current ? { ...current, highlights: [...current.highlights, created.highlight] } : current,
			)
			void reloadHighlights()
			reading.current?.engage()
		} catch (e) {
			Alert.alert("Not highlighted", e instanceof Error ? e.message : String(e))
		} finally {
			setSaving(false)
		}
	}

	// The API lists highlights in reading order; a new one was added at the end.
	async function reloadHighlights() {
		if (!client || !article) return
		const details = await client.articles.get(article.id).catch(() => null)
		if (details)
			setArticle((current) => (current ? { ...current, highlights: details.highlights } : current))
	}

	function showHighlight(highlightId: string) {
		setNotesOpen(false)
		openAfterSheet.current = highlightId
		web.current?.injectJavaScript(
			`window.klipShow && window.klipShow(${JSON.stringify(highlightId)}); true;`,
		)
	}

	/** Applies a change to one highlight now, and undoes it if the API refuses it. */
	async function changeHighlight(
		highlightId: string,
		change: (list: Highlight[]) => Highlight[],
		send: () => Promise<unknown>,
		failure: string,
	) {
		if (!article) return
		const before = article.highlights
		setArticle((current) =>
			current ? { ...current, highlights: change(current.highlights) } : current,
		)
		try {
			await send()
		} catch (e) {
			setArticle((current) => (current ? { ...current, highlights: before } : current))
			Alert.alert(failure, e instanceof Error ? e.message : String(e))
		}
	}

	function setHighlightColor(highlightId: string, color: HighlightColor) {
		if (!client) return
		void changeHighlight(
			highlightId,
			(list) => list.map((h) => (h.id === highlightId ? { ...h, color } : h)),
			() => client.highlights.update(highlightId, { color }),
			"Color not changed",
		)
	}

	/** Its new ends, from the page's handles: shown at once, put back if the API refuses them. */
	function resizeHighlight(moved: Extract<PageMessage, { type: "resize" }>) {
		const version = versionId.current
		if (!client || !version) return
		const { start, end, quote, previous } = moved
		void changeHighlight(
			moved.id,
			(list) => list.map((h) => (h.id === moved.id ? { ...h, start, end, quote } : h)),
			async () => {
				const saved = await client.highlights.resize(moved.id, {
					versionId: version,
					start,
					end,
					quote,
					previous,
				})
				setArticle((current) =>
					current
						? {
								...current,
								highlights: current.highlights.map((h) =>
									h.id === moved.id ? saved.highlight : h,
								),
							}
						: current,
				)
			},
			"Highlight not changed",
		)
	}

	async function saveHighlightNote(highlightId: string, highlightNote: string | null) {
		if (!client) return
		await client.highlights.update(highlightId, { note: highlightNote })
		setArticle((current) =>
			current
				? {
						...current,
						highlights: current.highlights.map((h) =>
							h.id === highlightId ? { ...h, note: highlightNote } : h,
						),
					}
				: current,
		)
	}

	function deleteHighlight(target: Highlight) {
		if (!client) return
		const remove = () => {
			setEditing(null)
			void changeHighlight(
				target.id,
				(list) => list.filter((h) => h.id !== target.id),
				() => client.highlights.delete(target.id),
				"Not deleted",
			)
		}
		// Its note goes with it: ask first.
		if (!target.note) return remove()
		Alert.alert("Delete this highlight?", "Its note will be deleted too.", [
			{ text: "Cancel", style: "cancel" },
			{ text: "Delete", style: "destructive", onPress: remove },
		])
	}

	// The library's own reader links open here; other web links, their card.
	function openLink(tapped: TappedLink) {
		const own = new RegExp(`^${escapeRegExp(apiUrl)}/read/([0-9a-f-]{36})`).exec(tapped.href)
		if (own) router.push({ pathname: "/read/[id]", params: { id: own[1]! } })
		else setLink(tapped)
	}

	// The page never leaves. Taps on links reach `openLink` through the page's script; this
	// catches the other ways to follow one (the long-press preview's Open).
	function onNavigate(request: ShouldStartLoadRequest): boolean {
		// The page itself, and its own anchors (footnotes).
		if (page && request.url.startsWith(page.uri)) return true
		if (!request.isTopFrame) return request.url.startsWith("https:")
		if (/^https?:/.test(request.url)) openLink({ href: request.url, text: "" })
		return false
	}

	const linkStatus = new Map(article?.noteLinks.to.map((l) => [l.id, l.status]))
	const linking: NoteLinking = {
		// A link just added isn't in the details yet: its target was picked from the library.
		status: (target) => linkStatus.get(target) ?? "ok",
		open: (target) => {
			openAfterClose.current = target
			if (notesOpen) {
				setNotesOpen(false)
				flushNote()
			} else setEditing(null)
		},
		search: searchLinks,
		recent: recentLinks,
		articleId: id,
	}

	return (
		<View style={[styles.screen, { backgroundColor: colors.bg }]}>
			<Stack.Screen options={{ title: "", headerTransparent: true, headerShown: showControls }} />
			{article && showControls ? (
				// Native bar buttons: Read Aloud, Notes, and the rest under More. Mounted only while they
				// show: the toolbar turns the header on.
				<Stack.Toolbar placement="right">
					{page && listen.available ? (
						<Stack.Toolbar.Button
							icon="headphones"
							accessibilityLabel={listen.status ? "Stop reading aloud" : "Read aloud"}
							tintColor={colors.accent}
							onPress={() => (listen.status ? listen.close() : void listen.start())}
						/>
					) : null}
					{article.status === "ready" ? (
						<Stack.Toolbar.Button
							icon="note.text"
							accessibilityLabel="Notes and highlights"
							tintColor={colors.accent}
							onPress={() => setNotesOpen(true)}
						/>
					) : null}
					<Stack.Toolbar.Menu
						icon="ellipsis.circle"
						accessibilityLabel="More"
						tintColor={colors.accent}
					>
						<Stack.Toolbar.MenuAction
							icon={article.starred ? "star.slash" : "star"}
							onPress={() => update({ starred: !article.starred })}
						>
							{article.starred ? "Unstar" : "Star"}
						</Stack.Toolbar.MenuAction>
						<Stack.Toolbar.MenuAction
							icon="newspaper"
							hidden={article.status === "failed"}
							onPress={() => update({ shortlisted: !article.shortlisted })}
						>
							{article.shortlisted ? "Remove from Next Edition" : "Add to Next Edition"}
						</Stack.Toolbar.MenuAction>
						<Stack.Toolbar.MenuAction
							icon={article.location === "archive" ? "tray.and.arrow.up" : "archivebox"}
							onPress={() =>
								update({ location: article.location === "archive" ? "inbox" : "archive" })
							}
						>
							{article.location === "archive" ? "Move to Inbox" : "Archive"}
						</Stack.Toolbar.MenuAction>
						<Stack.Toolbar.MenuAction
							icon="checkmark.circle"
							hidden={article.finished}
							onPress={() => update({ finished: true })}
						>
							Mark as Finished
						</Stack.Toolbar.MenuAction>
						<Stack.Toolbar.MenuAction
							icon="tag"
							hidden={article.status === "failed"}
							onPress={() => tags.open([article])}
						>
							Tags…
						</Stack.Toolbar.MenuAction>
						<Stack.Toolbar.Menu inline>
							{page ? (
								<Stack.Toolbar.MenuAction
									icon="textformat.size"
									onPress={() => setAppearanceOpen(true)}
								>
									Appearance
								</Stack.Toolbar.MenuAction>
							) : null}
							{listen.available ? (
								<Stack.Toolbar.MenuAction icon="waveform" onPress={() => router.push("/voices")}>
									Voices
								</Stack.Toolbar.MenuAction>
							) : null}
						</Stack.Toolbar.Menu>
						<Stack.Toolbar.Menu inline>
							<Stack.Toolbar.MenuAction
								icon="safari"
								// Web pages open in the phone's browser, never inside the app.
								onPress={() => void Linking.openURL(article.url)}
							>
								Open the Original
							</Stack.Toolbar.MenuAction>
							<Stack.Toolbar.MenuAction
								icon="text.bubble"
								hidden={!article.via?.some((via) => via.restorable)}
								onPress={() => void readPost()}
							>
								Read the Post Instead
							</Stack.Toolbar.MenuAction>
							<Stack.Toolbar.MenuAction
								icon="square.and.arrow.up"
								// The original's address, with its title for apps that show one.
								onPress={() =>
									void Share.share({ url: article.url, title: article.title ?? undefined })
								}
							>
								Share
							</Stack.Toolbar.MenuAction>
						</Stack.Toolbar.Menu>
					</Stack.Toolbar.Menu>
				</Stack.Toolbar>
			) : null}
			{page ? (
				<WebView
					ref={web}
					source={{ uri: page.uri }}
					allowingReadAccessToURL={page.folder}
					allowFileAccess
					originWhitelist={["*"]}
					onShouldStartLoadWithRequest={onNavigate}
					onMessage={onMessage}
					// Custom items replace the system's menu, so Copy, Look Up and Share are ours too.
					menuItems={[
						{ label: "Highlight", key: "highlight" },
						{ label: "Copy", key: "copy" },
						...(canLookUp ? [{ label: "Look Up", key: "lookup" }] : []),
						{ label: "Share", key: "share" },
					]}
					onCustomMenuSelection={(event) => {
						const { key, selectedText } = event.nativeEvent
						if (key === "highlight") void highlight(selectedText)
						else if (key === "copy") void copyText(selectedText)
						else if (key === "lookup") void lookUp(selectedText.trim())
						else if (key === "share") void Share.share({ message: selectedText.trim() })
					}}
					onLoadEnd={() => {
						loaded.current = true
						if (endJson)
							web.current?.injectJavaScript(`window.klipEnd && window.klipEnd(${endJson}); true;`)
						// Once: the card of the highlight the reader was opened at.
						if (openAt && !cardOpened.current) {
							cardOpened.current = true
							setEditing(openAt)
						}
						for (const [asset, name] of images.current) showImage(asset, name)
						// After a reload the page paints what it was written with: repaint what is current.
						if (painted)
							web.current?.injectJavaScript(
								`window.klipHighlights && window.klipHighlights(${painted}); true;`,
							)
					}}
					// iOS ends a web page's process when it needs the memory (reading aloud, in the
					// background): the page would stay blank. Load it again.
					onContentProcessDidTerminate={() => {
						loaded.current = false
						web.current?.reload()
					}}
					dataDetectorTypes="none"
					style={{ backgroundColor: colors.bg }}
				/>
			) : (
				<View style={styles.center}>
					{error || (article && article.status !== "ready") ? (
						<Text style={[styles.message, { color: colors.mutedFg }]}>
							{error ?? statusMessage(article!)}
						</Text>
					) : (
						<ActivityIndicator color={colors.mutedFg} />
					)}
				</View>
			)}
			{article ? (
				<NotesSheet
					visible={notesOpen}
					onClose={() => {
						setNotesOpen(false)
						flushNote()
					}}
					onDismiss={() => {
						flushNote()
						if (openAfterSheet.current) setEditing(openAfterSheet.current)
						openAfterSheet.current = null
						openPending()
					}}
					note={{
						value: note,
						status: noteStatus,
						onChange: (text) => {
							setNote(text)
							noteSave.current?.change(text)
						},
						onFlush: flushNote,
					}}
					highlights={article.highlights}
					onSelect={showHighlight}
					linking={linking}
					backlinks={article.noteLinks.from}
					colors={colors}
				/>
			) : null}
			{article ? (
				<EditionNoteSheet
					visible={editionOpen}
					onClose={() => {
						setEditionOpen(false)
						flushEditionNote()
					}}
					onDismiss={flushEditionNote}
					note={{
						value: editionNote,
						status: editionStatus,
						onChange: (text) => {
							setEditionNote(text)
							editionSave.current?.change(text)
						},
						onFlush: flushEditionNote,
					}}
					colors={colors}
				/>
			) : null}
			{page ? (
				// The page runs under the status bar too: it fades out below the clock.
				<View
					pointerEvents="none"
					style={[
						styles.statusBar,
						{
							height: insets.top + 12,
							experimental_backgroundImage: `linear-gradient(to bottom, ${colors.bg} ${insets.top}px, ${colors.bg}00)`,
						},
					]}
				/>
			) : null}
			{page && article && !listen.status ? (
				<ReaderStatus
					title={article.title ?? hostOf(article.url)}
					minutesLeft={minutes}
					line={line}
					colors={colors}
				/>
			) : null}
			{listen.status ? (
				<ListenBar
					status={listen.status}
					speed={listen.speed}
					onPlayPause={listen.playPause}
					onSkip={listen.skip}
					onSpeed={listen.cycleSpeed}
					onClose={listen.close}
					colors={colors}
				/>
			) : null}
			{tags.sheet}
			<AppearanceSheet
				visible={appearanceOpen}
				type={type}
				onChange={changeType}
				scheme={scheme}
				onScheme={changeScheme}
				onClose={() => setAppearanceOpen(false)}
				colors={colors}
			/>
			<LinkCard
				link={link}
				client={client}
				onClose={() => setLink(null)}
				onRead={(articleId) => {
					setLink(null)
					router.push({ pathname: "/read/[id]", params: { id: articleId } })
				}}
				colors={colors}
			/>
			<HighlightCard
				highlight={editingHighlight}
				onClose={() => setEditing(null)}
				onCover={(points) => setCovered(Math.round(points))}
				onColor={(color) => editing && setHighlightColor(editing, color)}
				saveNote={saveHighlightNote}
				onCopy={() => {
					if (editingHighlight) void copyText(editingHighlight.quote)
					setEditing(null)
				}}
				onDelete={() => editingHighlight && deleteHighlight(editingHighlight)}
				onDismissed={openPending}
				linking={linking}
				colors={colors}
			/>
		</View>
	)
}

function bylineOf(a: ArticleDetails): string {
	const site = a.site ?? hostOf(a.url)
	return [site, a.author, a.readingMinutes ? `${a.readingMinutes} min` : null]
		.filter(Boolean)
		.join(" · ")
}

function statusMessage(a: ArticleDetails): string {
	if (a.status === "failed")
		return "Klipstack couldn't read this page. Open the original from the More menu above."
	return "Klipstack is still saving this article. Try again in a moment."
}

function hostOf(url: string): string {
	try {
		return new URL(url).host
	} catch {
		return url
	}
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// The navigation bar's height below the status bar (portrait).
const NAV_BAR = 44

const styles = StyleSheet.create({
	screen: { flex: 1 },
	statusBar: { position: "absolute", top: 0, left: 0, right: 0 },
	center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
	message: { fontSize: 16, lineHeight: 22, textAlign: "center" },
})
