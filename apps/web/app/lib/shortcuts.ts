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
 * Reader-only: ⌘C / Ctrl+C with nothing selected copies the highlight in focus. A selection
 * stops being one the moment it becomes a highlight, so the browser has nothing left to copy.
 */
export const COPY_HINT = "⌘C"

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

function bareKey(e: KeyboardEvent): boolean {
	if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.defaultPrevented) return false
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
