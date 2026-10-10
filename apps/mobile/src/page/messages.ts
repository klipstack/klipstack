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
}

/** The selected passage: what `POST /articles/{id}/highlights` takes to highlight it. */
export type PageSelection = {
	start: number
	end: number
	exact: string
	prefix: string
	suffix: string
}

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

export type PageMessage =
	| { type: "selection"; selection: PageSelection | null }
	/** `ended`: the end of the article (the end block's top) is on screen. */
	| { type: "reading"; position: number; ended: boolean; moved: boolean }
	| { type: "end"; action: EndAction }
	| { type: "highlight"; id: string }
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

/** The page's functions, for the app. */
export type PageApi = {
	klipHighlights(list: PageHighlight[]): void
	klipActive(id: string | null): void
	klipReveal(id: string, covered: number): void
	klipShow(id: string): void
	klipClearSelection(): void
	klipType(fontSize: number, sans: boolean): void
	klipSentences(lang: string): void
	klipSpeaking(index: number | null): void
	klipAsset(id: string, name: string): void
	klipEnd(end: PageEnd): void
}
