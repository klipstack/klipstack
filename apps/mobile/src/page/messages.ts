/**
 * What the app and the reader page (`reader-page.ts`, in the WebView) tell each other. The page
 * posts `PageMessage`s (`window.ReactNativeWebView.postMessage`, as JSON); the app calls the
 * page's `window.klip…` functions (`PageApi`) with `injectJavaScript`.
 */

/**
 * A highlight to paint: where it is (offsets into the article's text, `articles.html`) and its
 * quote with the text around it, to find it when the offsets are from another version.
 */
export type PageHighlight = {
	id: string
	/** Index in `HIGHLIGHT_COLORS`. */
	color: number
	quote: string
	prefix: string
	suffix: string
	start: number
	end: number
	/** It has a note: a tab beside it says so. */
	note: boolean
}

/** The selected passage: what `POST /articles/{id}/highlights` takes to highlight it. */
export type PageSelection = {
	start: number
	end: number
	exact: string
	prefix: string
	suffix: string
}

/** An AI thread's passage, underlined: offsets into the article's text. */
export type PageThread = { id: string; start: number; end: number }

/** What the page opens with, in `<script type="application/json" id="klip-config">`. */
export type PageConfig = {
	/** Points at the top of the screen the app's controls cover. */
	top: number
	highlights: PageHighlight[]
	/** The saved reading position, 0–1; 0 opens at the top. */
	position: number
	/** A highlight to open at instead (its id). */
	highlight: string | null
}

export type Sentence = { text: string; pause: number }

/**
 * The end of the article, after its last paragraph: `state` is `EndState` from
 * `@klipstack/api-contract/reading`.
 */
export type PageEnd = {
	state: "finished" | "finishing" | "kept" | "early"
	/** In the archive already: leaving only marks it finished. */
	archived: boolean
	starred: boolean
	shortlisted: boolean
	/** What the user wrote for the next edition's readers, shown once marked; null for none. */
	editionNote?: string | null
}

/**
 * A tap in the end block: star, share, mark; keep it as it is, finish on the way out again, or now;
 * write the note for the next edition.
 */
export type EndAction =
	| "star"
	| "share"
	| "shortlist"
	| "keep"
	| "unkeep"
	| "finish"
	| "edition-note"
	/** Save the article note again, after a save failed. */
	| "note-retry"

/**
 * The article note, for its post-it in the end block: the same note as the app's notes sheet.
 * `rev` moves when the app replaces the note (the reader took the one saved elsewhere): the
 * post-it shows it even while being written in. Otherwise it keeps what is typed in it.
 */
export type PageNote = {
	/** As stored: links are `[Title](/read/<id>)`. */
	text: string
	status: "idle" | "saving" | "saved" | "error"
	/** Linked articles in the trash or gone; the others are readable. */
	links: Record<string, "trash" | "missing">
	rev: number
}

/**
 * A heading in the article's contents (`outlineOf` in `@klipstack/anchor`, as the web reader's):
 * `key` is unique within them, `depth` 0 for a section and 1 for one under it.
 */
export type ContentsEntry = { key: string; text: string; depth: 0 | 1 }

export type PageMessage =
	| { type: "selection"; selection: PageSelection | null }
	/** `ended`: the end of the article (the end block's top) is on screen. */
	| { type: "reading"; position: number; ended: boolean; moved: boolean }
	| { type: "end"; action: EndAction }
	/** The article note, as written on the end block's post-it. */
	| { type: "note"; text: string }
	/** The post-it is being written in, or no longer. */
	| { type: "note-focus"; focused: boolean }
	/** A link in the post-it, tapped while not writing: open that article. */
	| { type: "note-link"; id: string }
	| { type: "highlight"; id: string }
	/** A tap on an AI thread's underlined passage. */
	| { type: "thread"; id: string }
	/** A tap off the open highlight. */
	| { type: "outside" }
	/** The open highlight's new place, as its handles left it, and the place it had. */
	| {
			type: "resize"
			id: string
			start: number
			end: number
			quote: string
			previous: { start: number; end: number; quote: string }
	  }
	| { type: "link"; href: string; text: string }
	| { type: "mail"; href: string }
	| { type: "controls"; shown: boolean }
	| { type: "sentences"; list: Sentence[]; start: number }
	| { type: "sentence"; index: number }
	/** The article's contents, once open: none when it has too few headings to make them. */
	| { type: "contents"; entries: ContentsEntry[] }
	/** The section being read changed: its index in the contents, -1 before the first heading. */
	| { type: "section"; index: number }

/** The page's functions, for the app. */
export type PageApi = {
	klipHighlights(list: PageHighlight[]): void
	klipActive(id: string | null): void
	klipReveal(id: string, covered: number): void
	klipShow(id: string): void
	/** Scrolls to a passage an answer cites (offsets into the article's text) and flashes it. */
	klipCite(start: number, end: number): void
	/** Underlines the AI threads' passages; `klipThreadFocus` marks the open one's. */
	klipThreads(list: PageThread[]): void
	klipThreadFocus(id: string | null): void
	klipClearSelection(): void
	klipType(fontSize: number, sans: boolean): void
	klipSentences(lang: string): void
	klipSpeaking(index: number | null): void
	klipAsset(id: string, name: string): void
	klipEnd(end: PageEnd): void
	klipNote(note: PageNote): void
	/** Scrolls to a heading in the contents (its index), and reads aloud from it while reading. */
	klipSection(index: number): void
}
