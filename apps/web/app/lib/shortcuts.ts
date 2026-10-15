/**
 * Single-key shortcuts for articles, shared by the list views and the reader. No modifiers; a key
 * counts only when nothing is being typed and no menu or dialog has the focus.
 */
export type ArticleShortcut =
	| "open"
	| "star"
	| "shortlist"
	| "archive"
	| "delete"
	| "unread"
	| "tags"
export type ListShortcut = "next" | "prev" | "down" | "up" | "left" | "right" | "clear" | "toggle"

const ARTICLE_KEYS: Record<string, ArticleShortcut> = {
	Enter: "open",
	o: "open",
	s: "star",
	// For the next edition.
	n: "shortlist",
	e: "archive",
	"#": "delete",
	Delete: "delete",
	Backspace: "delete",
	u: "unread",
	t: "tags",
}

/** With shift, the moves also check the cards they pass (multi-select). */
const LIST_KEYS: Record<string, ListShortcut> = {
	j: "next",
	k: "prev",
	J: "next",
	K: "prev",
	ArrowDown: "down",
	ArrowUp: "up",
	ArrowLeft: "left",
	ArrowRight: "right",
	Escape: "clear",
	x: "toggle",
}

/** What menus and tooltips show next to an action. */
export const SHORTCUT_HINTS: Record<ArticleShortcut, string> = {
	open: "↵",
	star: "S",
	shortlist: "N",
	archive: "E",
	delete: "#",
	unread: "U",
	tags: "T",
}

export function articleShortcut(e: KeyboardEvent): ArticleShortcut | null {
	if (!bareKey(e)) return null
	const shortcut = ARTICLE_KEYS[e.key] ?? null
	// Enter on a focused link or button is that control's own activation.
	if (shortcut === "open" && e.key === "Enter" && isControl(document.activeElement)) return null
	return shortcut
}

/** List views: `x` checks the card under the cursor. */
export const SELECT_HINT = "X"

/** List views and the search page: `/` goes to the search field. */
export const SEARCH_HINT = "/"

export function isSearchShortcut(e: KeyboardEvent): boolean {
	return bareKey(e) && e.key === "/"
}

/** Reader-only: `h` shows or hides the notes and highlights sidebar. */
export const HIGHLIGHTS_HINT = "H"

export function isHighlightsShortcut(e: KeyboardEvent): boolean {
	return bareKey(e) && e.key === "h"
}

/** Reader-only, with AI: `c` shows or hides the article's chat, in the same sidebar. */
export const CHAT_HINT = "C"

export function isChatShortcut(e: KeyboardEvent): boolean {
	return bareKey(e) && e.key === "c"
}

/**
 * Reader-only, reading by paragraph: `j`/`k` move a marker from paragraph to paragraph, Enter asks
 * the AI about the marked one, `[`/`]` go to the previous or next AI answer or note, `b` shows the
 * brief, `f` dims all but the marked paragraph, `?` lists the shortcuts. Escape leaves.
 */
export type ReaderShortcut =
	| "nextParagraph"
	| "prevParagraph"
	| "askParagraph"
	| "prevNote"
	| "nextNote"
	| "brief"
	| "focus"
	| "help"
	| "leave"

const READER_KEYS: Record<string, ReaderShortcut> = {
	j: "nextParagraph",
	k: "prevParagraph",
	"[": "prevNote",
	"]": "nextNote",
	b: "brief",
	f: "focus",
	"?": "help",
}

export const READER_HINTS: Record<ReaderShortcut, string> = {
	nextParagraph: "J",
	prevParagraph: "K",
	askParagraph: "↵",
	prevNote: "[",
	nextNote: "]",
	brief: "B",
	focus: "F",
	help: "?",
	leave: "Esc",
}

export function readerShortcut(e: KeyboardEvent): ReaderShortcut | null {
	// `[` and `]` need Option or AltGr on some layouts (Spanish, German, French…).
	const bracket = e.key === "[" || e.key === "]"
	if (!bareKey(e, bracket)) return null
	if (e.key === "Enter") return isControl(document.activeElement) ? null : "askParagraph"
	if (e.key === "Escape") return "leave"
	return READER_KEYS[e.key] ?? null
}

/**
 * Reader-only: ⌘C / Ctrl+C with nothing selected copies the highlight in focus. A selection
 * stops being one the moment it becomes a highlight, so the browser has nothing left to copy.
 */
export const COPY_HINT = "⌘C"

/** ⌘↵ / Ctrl+Enter in a text field: done with it, as its Done button. */
export const SUBMIT_HINT = "⌘↵"

/** ⌘↵ / Ctrl+Enter, without other modifiers. */
export function isSubmitShortcut(e: KeyboardEvent): boolean {
	return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !e.isComposing && e.key === "Enter"
}

export function isCopyShortcut(e: KeyboardEvent): boolean {
	if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.isComposing || e.defaultPrevented)
		return false
	if (e.key.toLowerCase() !== "c") return false
	const target = e.target instanceof Element ? e.target : null
	if (target?.closest(TYPING) || modalOpen()) return false
	return window.getSelection()?.isCollapsed !== false
}

export function listShortcut(e: KeyboardEvent): ListShortcut | null {
	if (!bareKey(e)) return null
	return LIST_KEYS[e.key] ?? null
}

/** ⌘A / Ctrl+A in a list view checks every card, when nothing is being typed. */
export function isSelectAllShortcut(e: KeyboardEvent): boolean {
	if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.isComposing || e.defaultPrevented)
		return false
	if (e.key.toLowerCase() !== "a") return false
	const target = e.target instanceof Element ? e.target : null
	return !target?.closest(`${TYPING}, ${OVERLAY}`) && !modalOpen()
}

const TYPING = "input, textarea, select, [contenteditable]:not([contenteditable='false'])"
const OVERLAY = "dialog, [role='dialog'], [role='menu']"

/**
 * Settings can turn off the shortcuts that are a single character (WCAG 2.1.4): speech input types
 * letters, and a screen reader's browse keys can reach the page. Enter, the arrows, Escape and
 * Delete are not characters, and keep working.
 */
function charactersOff(e: KeyboardEvent): boolean {
	return e.key.length === 1 && document.documentElement.dataset.shortcuts === "off"
}

/** `altGr`: Option or AltGr (Ctrl+Alt on Windows) may be down, as typing the key needs on some layouts. */
function bareKey(e: KeyboardEvent, altGr = false): boolean {
	if (e.metaKey || e.isComposing || e.defaultPrevented) return false
	if (altGr ? e.ctrlKey && !e.altKey : e.ctrlKey || e.altKey) return false
	if (charactersOff(e)) return false
	const target = e.target instanceof Element ? e.target : null
	if (target?.closest(`${TYPING}, ${OVERLAY}, [data-resize-handles]`)) return false
	return !modalOpen()
}

/** A modal dialog owns the keyboard even when its focus is nowhere in particular. */
function modalOpen(): boolean {
	for (const el of document.querySelectorAll("dialog[open], [role='dialog'][aria-modal='true']")) {
		// The phone drawer stays in the DOM while closed, hidden.
		if (!el.closest("[aria-hidden='true']")) return true
	}
	return false
}

function isControl(el: Element | null): boolean {
	return Boolean(el?.closest("a[href], button, [role='button'], summary"))
}

/**
 * Every shortcut, for the list in Settings and the reader's `?`. A row's label is
 * `common:shortcuts.rows.<id>`, a group's `common:shortcuts.groups.<id>`. `ai`: only with AI.
 */
interface ShortcutRow {
	readonly id: string
	readonly keys: readonly string[]
	readonly ai?: boolean
}

export const SHORTCUT_GROUPS = [
	{
		id: "general",
		rows: [
			{ id: "palette", keys: ["⌘K"] },
			{ id: "submit", keys: [SUBMIT_HINT] },
		],
	},
	{
		id: "lists",
		rows: [
			{ id: "listMove", keys: ["J", "K"] },
			{ id: "listArrows", keys: ["↑", "↓", "←", "→"] },
			{ id: "listOpen", keys: [SHORTCUT_HINTS.open, "O"] },
			{ id: "star", keys: [SHORTCUT_HINTS.star] },
			{ id: "shortlist", keys: [SHORTCUT_HINTS.shortlist] },
			{ id: "archive", keys: [SHORTCUT_HINTS.archive] },
			{ id: "unread", keys: [SHORTCUT_HINTS.unread] },
			{ id: "tags", keys: [SHORTCUT_HINTS.tags] },
			{ id: "delete", keys: [SHORTCUT_HINTS.delete] },
			{ id: "select", keys: [SELECT_HINT] },
			{ id: "selectRange", keys: ["⇧J", "⇧K"] },
			{ id: "selectAll", keys: ["⌘A"] },
			{ id: "clear", keys: ["Esc"] },
			{ id: "search", keys: [SEARCH_HINT] },
		],
	},
	{
		id: "reader",
		rows: [
			{ id: "paragraph", keys: [READER_HINTS.nextParagraph, READER_HINTS.prevParagraph] },
			{ id: "askParagraph", keys: [READER_HINTS.askParagraph], ai: true },
			{ id: "stops", keys: [READER_HINTS.prevNote, READER_HINTS.nextNote] },
			{ id: "brief", keys: [READER_HINTS.brief], ai: true },
			{ id: "focus", keys: [READER_HINTS.focus] },
			{ id: "leave", keys: [READER_HINTS.leave] },
			{ id: "sidebar", keys: [HIGHLIGHTS_HINT] },
			{ id: "chat", keys: [CHAT_HINT], ai: true },
			{
				id: "articleActions",
				keys: (["star", "shortlist", "archive", "unread", "tags", "delete"] as const).map(
					(a) => SHORTCUT_HINTS[a],
				),
			},
			{ id: "copyHighlight", keys: [COPY_HINT] },
			{ id: "help", keys: [READER_HINTS.help] },
		],
	},
] as const satisfies ReadonlyArray<{ id: string; rows: readonly ShortcutRow[] }>
