import type { HighlightColor } from "@klipstack/api-contract/enums"
import { endState, secondsToFinish } from "@klipstack/api-contract/reading"
import type {
	AiCitation,
	ArticleDetails,
	ArticleTopics,
	Highlight,
	KlipstackClient,
} from "@klipstack/sdk"
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
	Pressable,
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
import { askTitle } from "@/components/article-actions"
import { BriefSheet } from "@/components/brief-sheet"
import { EditionNoteSheet } from "@/components/edition-note-sheet"
import { HighlightCard } from "@/components/highlight-card"
import { LinkCard, type TappedLink } from "@/components/link-card"
import { ListenBar } from "@/components/listen-bar"
import type { NoteLinking } from "@/components/note-field"
import { NotesSheet } from "@/components/notes-sheet"
import { ReaderStatus } from "@/components/reader-status"
import { useTagSheet } from "@/components/tag-sheet"
import { showToast, track } from "@/lib/article-changes"
import { retagged } from "@/lib/article-tags"
import { useAuth } from "@/lib/auth"
import { copyText } from "@/lib/clipboard"
import type { ColorSchemePref } from "@/lib/color-scheme"
import { afterMarking, withUndone } from "@/lib/draft-undo"
import { waitForExtraction } from "@/lib/extraction"
import { finishOnLeave, showFinished } from "@/lib/finish-on-leave"
import { offerHighlightUndo } from "@/lib/highlight-undo"
import { minutesLeft } from "@/lib/home"
import { inTime } from "@/lib/in-time"
import { guardNoteSaves, type SavedNote } from "@/lib/note-guard"
import {
	canUseOffline,
	loadArticle,
	lostConnection,
	NOT_KEPT,
	saveArticle,
	type StoredHtml,
} from "@/lib/offline"
import { useReadAloud } from "@/lib/read-aloud"
import { useReaderAi } from "@/lib/reader-ai"
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
import type { EndAction, PageEnd, PageMessage, PageNote, PageSelection } from "@/page/messages"
import { dictation } from "../../../modules/klip-dictation"
import { canLookUp, lookUp } from "../../../modules/klip-lookup"

/**
 * An article, read in the app: its stored HTML through the API (no web session needed), shown in a
 * WebView styled like the web reader. The page is a file in the article's cache folder; its stored
 * images, which need the app's token, are downloaded there by the app and set as they land.
 */
export default function Reader() {
	// `highlight`: opened from the Highlights tab, at that highlight, with its card open. `notes`:
	// from Home's question about a note, with the notes sheet open.
	const {
		id,
		highlight: openAt,
		notes: openNotes,
	} = useLocalSearchParams<{ id: string; highlight?: string; notes?: string }>()
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
	// A failed save being read again (Try Again).
	const [retrying, setRetrying] = useState(false)
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
	// The notes sheet opens dictating: "Speak" at the end of the article read aloud.
	const [dictateNote, setDictateNote] = useState(false)
	const notesOpened = useRef(false)
	// The article note as typed, saved as it changes; set up once the details load.
	const [note, setNote] = useState("")
	const [noteStatus, setNoteStatus] = useState<NoteSaveStatus>("idle")
	const noteSave = useRef<ReturnType<typeof createNoteAutosave> | null>(null)
	const flushNote = () => void noteSave.current?.flush()
	// Which note the next save replaces: a note changed elsewhere meanwhile is never written over
	// unseen (src/lib/note-guard.ts).
	const noteGuard = useRef<ReturnType<typeof guardNoteSaves> | null>(null)
	// Moves when the note is replaced here by the one saved elsewhere: the end block's post-it shows
	// it even while it is written in (`PageNote.rev`).
	const [noteRev, setNoteRev] = useState(0)
	// The post-it at the end is being written in: the page's text menu is the system's then.
	const [noteFocused, setNoteFocused] = useState(false)
	const askingNote = useRef(false)
	const mounted = useRef(true)
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
	// The AI about this article, with the `ai` feature: its brief, for now.
	const ai = useReaderAi(client, id, page !== null)
	const [briefOpen, setBriefOpen] = useState(false)
	// A citation followed from a sheet shows once the sheet is gone.
	const citeAfterSheet = useRef<AiCitation | null>(null)
	// Reading aloud: its language is guessed from the text when the article has none.
	const text = useRef("")
	const listen = useReadAloud({
		article,
		textSample: () => text.current,
		inject: (script) => web.current?.injectJavaScript(script),
		// Listened to the end: so recorded, also with the screen locked, as reading to it is.
		onEnded: () => void reading.current?.listened(),
	})

	// Unsaved typing and the exact position go out when the app leaves the foreground and when the
	// reader closes. The home screen widget waits for the position (src/lib/widget.ts).
	useEffect(() => {
		const sub = AppState.addEventListener("change", (appState) => {
			if (appState !== "active") {
				void noteSave.current?.flush()
				void editionSave.current?.flush()
				const saving = reading.current?.flush()
				if (saving) void track(saving)
			}
		})
		return () => {
			mounted.current = false
			sub.remove()
			void noteSave.current?.flush()
			noteSave.current?.dispose()
			void editionSave.current?.flush()
			editionSave.current?.dispose()
			const saving = reading.current?.flush()
			if (saving) void track(saving)
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
	// The article note on the end block's post-it: the notes sheet's note, so an edit in either
	// shows in the other.
	const pageNote: PageNote | null = article
		? {
				text: note,
				status: noteStatus,
				links: Object.fromEntries(
					article.noteLinks.to.flatMap((l) => (l.status === "ok" ? [] : [[l.id, l.status]])),
				),
				rev: noteRev,
			}
		: null
	const noteJson = pageNote ? JSON.stringify(pageNote) : null
	useEffect(() => {
		if (!noteJson || !loaded.current) return
		web.current?.injectJavaScript(`window.klipNote && window.klipNote(${noteJson}); true;`)
	}, [noteJson])
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
	// Only whether each has a note is painted (its tab): a note saved repaints when it starts or empties.
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
				// Its topics and what to read next in them, online only: a kept copy's would go stale.
				// Without them (an older server, a failed or slow call) the article opens all the same.
				let topics: ArticleTopics | null = null
				try {
					details = await client.articles.get(id)
					if (details.status === "ready") {
						;[stored, topics] = await Promise.all([
							client.articles.html(id),
							inTime(client.articles.topics(id), TOPICS_WAIT_MS),
						])
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
				noteSaveFrom.current(client, details.note ?? "", details.noteUpdatedAt)
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
				// Opened from Home to write its note, it isn't read again: opening it would start a new
				// reading (after a day), at the top, and its finish would no longer be asked about.
				reading.current = openNotes
					? null
					: createReadingSync({
							opened: details.opened,
							position,
							cycle: details.readingCycle ?? 0,
							open: () => client.articles.open(id),
							save: (at, cycle, listened) =>
								client.articles.setPosition(id, at, { cycle, listened }),
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
						topics,
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
	}, [client, id, openAt, openNotes, generation])

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
			await waitForExtraction(client, id)
		} catch (e) {
			Alert.alert("Couldn't switch to the post", e instanceof Error ? e.message : String(e))
		}
		setGeneration((n) => n + 1)
	}

	/** The save failed: the server reads the page again; the reader loads again once it is done. */
	async function retry() {
		if (!client) return
		setRetrying(true)
		try {
			const { queued } = await client.articles.retry(id)
			if (queued) await waitForExtraction(client, id)
		} catch (e) {
			Alert.alert("Couldn't try again", e instanceof Error ? e.message : String(e))
		}
		setRetrying(false)
		setGeneration((n) => n + 1)
	}

	/** The note's autosave, from `initial`, saved when it was `at` (undefined: not known). */
	function startNoteSave(c: KlipstackClient, initial: string, at: string | null | undefined) {
		noteSave.current?.dispose()
		const guard = guardNoteSaves({
			at,
			send: (text, expected) => c.articles.setNote(id, text.trim() ? text : null, expected),
			onChanged: (now) => noteChanged(c, now),
		})
		noteGuard.current = guard
		noteSave.current = createNoteAutosave({ initial, onStatus: setNoteStatus, save: guard.save })
	}

	/**
	 * The note changed elsewhere since it was read, and this save was refused: the reader chooses,
	 * as in the web's Notebook. The saved note replaces theirs, or theirs goes over it, knowingly.
	 */
	function noteChanged(c: KlipstackClient, now: SavedNote) {
		if (askingNote.current || !mounted.current) return
		askingNote.current = true
		Alert.alert(
			"Note Changed Elsewhere",
			"This note changed somewhere else while you were writing.",
			[
				{
					text: "Use the Saved Note",
					onPress: () => {
						askingNote.current = false
						const text = now.note ?? ""
						setNote(text)
						setNoteRev((n) => n + 1)
						startNoteSave(c, text, now.noteUpdatedAt)
						setNoteStatus("idle")
					},
				},
				{
					text: "Keep Mine",
					onPress: () => {
						askingNote.current = false
						noteGuard.current?.replaces(now.noteUpdatedAt)
						flushNote()
					},
				},
			],
			{ cancelable: false },
		)
	}

	const noteSaveFrom = useRef(startNoteSave)
	noteSaveFrom.current = startNoteSave

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
			// Out of the draft in progress: Undo puts it back, marked again.
			afterMarking(client, changes, result, (items) => setArticle((a) => withUndone(a, items)))
			// Out of the inbox (finishing archives too): back to the list, which no longer shows it.
			if (changes.location === "archive" || changes.finished) router.back()
		} catch (e) {
			setArticle(before)
			Alert.alert("Not saved", e instanceof Error ? e.message : String(e))
		}
	}

	// The new title at once, in the page's heading too; the old one back when the server refuses.
	async function rename(title: string) {
		if (!client || !article) return
		const before = article.title
		const show = (shown: string | null) => {
			setArticle((current) => current && { ...current, title: shown })
			web.current?.injectJavaScript(
				`(function(){var h=document.querySelector("body > header > h1");if(h)h.textContent=${JSON.stringify(shown ?? article.url)};})(); true;`,
			)
		}
		show(title)
		try {
			await track(client.articles.rename(article.id, title))
		} catch (e) {
			show(before)
			Alert.alert("Not renamed", e instanceof Error ? e.message : String(e))
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
			case "note":
				setNote(message.text)
				noteSave.current?.change(message.text)
				break
			case "note-focus":
				setNoteFocused(message.focused)
				if (!message.focused) flushNote()
				break
			case "note-link":
				openLink({ href: `${apiUrl}/read/${message.id}`, text: "" })
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
			case "note-retry":
				return flushNote()
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

	/** Scrolls to the passage an answer cites, and flashes it. */
	function cite(citation: AiCitation) {
		web.current?.injectJavaScript(
			`window.klipCite && window.klipCite(${citation.start}, ${citation.end}); true;`,
		)
	}

	/** The brief: the kept one, or, asked for here, written now. */
	function openBrief() {
		setBriefOpen(true)
		if (!ai.brief.brief && !ai.brief.writing) void ai.brief.make()
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

	// Gone at once, with its note; the toast's Undo brings both back, as on the web.
	function deleteHighlight(target: Highlight) {
		if (!client) return
		setEditing(null)
		const deleting = client.highlights.delete(target.id)
		void changeHighlight(
			target.id,
			(list) => list.filter((h) => h.id !== target.id),
			() => deleting,
			"Not deleted",
		)
		offerHighlightUndo(client, target, deleting, (back) => {
			setArticle((current) =>
				current && !current.highlights.some((h) => h.id === back.id)
					? { ...current, highlights: [...current.highlights, back] }
					: current,
			)
			void reloadHighlights()
		})
	}

	// The library's own reader links open here; other web links, their card. Going to another
	// article leaves this one, as on the web: it finishes now if the end block says leaving does,
	// and shows it finished when the reader comes back to it.
	function openLink(tapped: TappedLink) {
		const own = new RegExp(`^${escapeRegExp(apiUrl)}/read/([0-9a-f-]{36})`).exec(tapped.href)
		if (!own) return setLink(tapped)
		if (armed.current) {
			finishIfArmed()
			setArticle((a) => a && { ...a, finished: true, location: "archive" })
		}
		router.push({ pathname: "/read/[id]", params: { id: own[1]! } })
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
					{page && ai.enabled ? (
						<Stack.Toolbar.Menu
							icon="sparkles"
							accessibilityLabel="Ask AI"
							tintColor={colors.accent}
						>
							<Stack.Toolbar.MenuAction icon="list.bullet.rectangle.portrait" onPress={openBrief}>
								Sum Up This Article
							</Stack.Toolbar.MenuAction>
						</Stack.Toolbar.Menu>
					) : null}
					{article.status === "ready" ? (
						<Stack.Toolbar.Button
							icon="note.text"
							accessibilityLabel="Notes and highlights"
							tintColor={colors.accent}
							onPress={() => {
								// Out of the post-it first: the sheet holds the same note.
								web.current?.injectJavaScript("document.activeElement?.blur(); true;")
								setNotesOpen(true)
							}}
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
						<Stack.Toolbar.MenuAction
							icon="pencil"
							hidden={article.status === "failed"}
							onPress={() => askTitle(article, (title) => void rename(title))}
						>
							Rename…
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
					// While the post-it is written in, the system's menu (Paste, Select All); ours replace it.
					menuItems={
						noteFocused
							? undefined
							: [
									{ label: "Highlight", key: "highlight" },
									{ label: "Copy", key: "copy" },
									...(canLookUp ? [{ label: "Look Up", key: "lookup" }] : []),
									{ label: "Share", key: "share" },
								]
					}
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
						if (noteJson)
							web.current?.injectJavaScript(
								`window.klipNote && window.klipNote(${noteJson}); true;`,
							)
						// Once: the card of the highlight the reader was opened at.
						if (openAt && !cardOpened.current) {
							cardOpened.current = true
							setEditing(openAt)
						}
						// Once: the notes sheet, opened from Home to write the note.
						if (openNotes && !notesOpened.current) {
							notesOpened.current = true
							setNotesOpen(true)
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
					{retrying ? (
						<>
							<ActivityIndicator color={colors.mutedFg} />
							<Text style={[styles.message, { color: colors.mutedFg }]}>Trying again…</Text>
						</>
					) : error || (article && article.status !== "ready") ? (
						<>
							<Text style={[styles.message, { color: colors.mutedFg }]}>
								{error ?? statusMessage(article!)}
							</Text>
							{!error && article?.status === "failed" ? (
								<Pressable
									accessibilityRole="button"
									onPress={() => void retry()}
									hitSlop={8}
									style={({ pressed }) => pressed && styles.pressed}
								>
									<Text style={[styles.action, { color: colors.accent }]}>Try Again</Text>
								</Pressable>
							) : null}
						</>
					) : (
						<ActivityIndicator color={colors.mutedFg} />
					)}
				</View>
			)}
			{article ? (
				<NotesSheet
					visible={notesOpen}
					article={{
						title: article.title || hostOf(article.url),
						byline: bylineOf(article),
						description: article.description,
					}}
					dictate={dictateNote}
					onDictate={() => {
						if (listen.status?.kind === "speech" && listen.status.state === "playing")
							listen.playPause()
					}}
					onClose={() => {
						setNotesOpen(false)
						flushNote()
					}}
					onDismiss={() => {
						setDictateNote(false)
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
			{article && ai.enabled ? (
				<BriefSheet
					visible={briefOpen}
					title={article.title || hostOf(article.url)}
					brief={ai.brief}
					allowance={ai.allowance}
					onCite={(citation) => {
						// Its offsets are into the text the brief read: the page's, unless it changed since.
						if (ai.brief.brief && ai.brief.brief.versionId !== versionId.current)
							return void showToast({
								message: "That passage is from another version of the article.",
							})
						citeAfterSheet.current = citation
						setBriefOpen(false)
					}}
					onCopy={(text) => {
						void copyText(text)
						showToast({ message: "Brief copied" })
					}}
					onClose={() => setBriefOpen(false)}
					onDismiss={() => {
						const citation = citeAfterSheet.current
						citeAfterSheet.current = null
						if (citation) cite(citation)
					}}
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
					privateNote={note}
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
					onNote={
						note.trim()
							? undefined
							: (spoken) => {
									listen.close()
									setDictateNote(spoken)
									setNotesOpen(true)
								}
					}
					speak={dictation !== null}
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
		return "Klipstack couldn't read this page. Try again, or open the original from the More menu above."
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

// How long the reader waits for an article's topics before opening without them.
const TOPICS_WAIT_MS = 1500

// The navigation bar's height below the status bar (portrait).
const NAV_BAR = 44

const styles = StyleSheet.create({
	screen: { flex: 1 },
	statusBar: { position: "absolute", top: 0, left: 0, right: 0 },
	center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 },
	message: { fontSize: 16, lineHeight: 22, textAlign: "center" },
	action: { fontSize: 17, fontWeight: "600" },
	pressed: { opacity: 0.6 },
})
