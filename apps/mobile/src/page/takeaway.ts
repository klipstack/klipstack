import { NOTE_MAX } from "@klipstack/api-contract/names"
import { parse } from "@klipstack/api-contract/note-links"
import { fromStored, insertLink, linkRange, toStored } from "../lib/note-field"
import { LEAST_HEIGHT, postItChars } from "../lib/post-it"
import type { PageMessage, PageNote, PageStrings } from "./messages"

/**
 * The article note on a post-it at the end of the article, written on in place: the web reader's
 * (apps/web/app/components/post-it.tsx). It is the note of the app's notes sheet: what is typed
 * goes to the app (`{ type: "note" }`), which saves it, and the app's note comes back
 * (`klipNote`). Links show as their titles and can't be typed into; a deletion takes the whole
 * link, as in the sheet. While the post-it is written in, it keeps its own text, unless the app
 * replaced the note (`rev`). Its paper grows with the text and doesn't shrink under the caret.
 *
 * `[[` or `@` typed in it, or its Link Article button, asks the app for an article
 * (`{ type: "note-pick" }`), as the app's own note fields do. The article picked (`link`) takes
 * the place of what was typed, or goes where the caret last was.
 */
export function createTakeaway(
	post: (message: PageMessage) => void,
	strings: PageStrings,
): {
	element: HTMLElement
	update: (note: PageNote) => void
	link: (article: { id: string; title: string } | null) => void
} {
	const element = document.createElement("div")
	element.className = "takeaway"
	// What the post-it asks while the note is empty.
	const placeholder = strings.notePlaceholder
	const say = (key: keyof PageStrings) => escapeHtml(strings[key])
	element.innerHTML = `<div class="takeaway-label">${say("yourNote")} <span>${say("onlyYou")}</span></div><div class="post-it"><span class="tape" aria-hidden="true"></span><div class="takeaway-field" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="${say("yourNote")}" aria-placeholder="${say("notePlaceholder")}" autocapitalize="sentences" data-placeholder="${say("notePlaceholder")}"></div></div><button type="button" class="takeaway-link-article">${LINK_ICON}${say("linkArticle")}</button><div class="takeaway-status"></div>`
	const paper = element.querySelector<HTMLElement>(".post-it")!
	const field = element.querySelector<HTMLElement>(".takeaway-field")!
	const status = element.querySelector<HTMLElement>(".takeaway-status")!
	const linkButton = element.querySelector<HTMLElement>(".takeaway-link-article")!

	// The app's note, and the text the paper is sized for (the longest since writing began).
	let latest: PageNote | null = null
	let fit = ""
	const focused = () => document.activeElement === field

	function show(text: string, links: PageNote["links"]) {
		field.replaceChildren()
		parse(text).forEach((line, i) => {
			if (i > 0) field.append("\n")
			for (const segment of line) {
				if (segment.kind === "text") {
					field.append(segment.text)
					continue
				}
				const link = document.createElement("span")
				link.className = `takeaway-link ${links[segment.id] ?? "ok"}`
				link.setAttribute("contenteditable", "false")
				link.dataset.link = segment.id
				link.textContent = segment.title
				field.append(link)
			}
		})
		fit = text
		changed(text)
	}

	/** The paper's size and the placeholder, for this text. */
	function changed(text: string) {
		field.classList.toggle("empty", text === "")
		if (text.length > fit.length) fit = text
		Object.assign(paper.style, postItSize(fit || placeholder))
	}

	changed("")

	// A paste brings its text in `dataTransfer`, not `data`.
	field.addEventListener("beforeinput", (event) => {
		if (!event.inputType.startsWith("insert")) return
		const adding = (event.data ?? event.dataTransfer?.getData("text/plain") ?? " ").length
		const selected = window.getSelection()?.toString().length ?? 0
		if (fieldText(field).length + adding - selected > NOTE_MAX) event.preventDefault()
	})
	// Where the caret last was in the note's text (links as their titles): the button takes focus
	// from the field before its tap, and the picker is a sheet over the page.
	let caret: { start: number; end: number } | null = null
	// The `[[` or `@` that asked for the article: the link takes its place.
	let trigger: { start: number; end: number } | null = null
	document.addEventListener("selectionchange", () => {
		const selection = window.getSelection()
		if (!focused() || !selection?.rangeCount) return
		const range = selection.getRangeAt(0)
		caret = {
			start: offsetOf(field, range.startContainer, range.startOffset),
			end: offsetOf(field, range.endContainer, range.endOffset),
		}
	})

	field.addEventListener("input", (event) => {
		const text = fieldText(field)
		changed(text)
		post({ type: "note", text })
		keepInView()
		const typed = (event as InputEvent).data
		const selection = window.getSelection()
		if ((typed !== "@" && typed !== "[") || !selection?.rangeCount) return
		const range = selection.getRangeAt(0)
		const end = offsetOf(field, range.endContainer, range.endOffset)
		const before = fromStored(text).text.slice(0, end)
		// `@` only starts a word, as in the app's own note fields.
		const typedAt = typed === "@" && (end < 2 || /\s/.test(before[end - 2]!))
		const chars = typedAt ? "@" : typed === "[" && before.endsWith("[[") ? "[[" : null
		if (!chars) return
		trigger = { start: end - chars.length, end }
		post({ type: "note-pick" })
	})
	linkButton.addEventListener("click", () => {
		trigger = null
		post({ type: "note-pick" })
	})
	field.addEventListener("focus", () => post({ type: "note-focus", focused: true }))
	field.addEventListener("blur", () => {
		post({ type: "note-focus", focused: false })
		// What the app has now: written in the sheet meanwhile, or links whose state changed.
		if (latest) show(latest.text, latest.links)
	})

	// A link opens its article, unless the tap was to write.
	let wasFocused = false
	field.addEventListener("touchstart", () => (wasFocused = focused()), { passive: true })
	field.addEventListener("click", (event) => {
		const link =
			event.target instanceof Element
				? event.target.closest<HTMLElement>(".takeaway-link[data-link]")
				: null
		if (!link || wasFocused) return
		event.preventDefault()
		field.blur()
		post({ type: "note-link", id: link.dataset.link! })
	})

	/**
	 * While written in, the paper stays above the keyboard: WebKit scrolls to the caret when the
	 * field is tapped, but not when the keyboard comes back (after an alert) or the paper grows.
	 */
	function keepInView() {
		if (!focused()) return
		const view = window.visualViewport
		const bottom = view ? view.offsetTop + view.height : window.innerHeight
		const below = paper.getBoundingClientRect().bottom + 16 - bottom
		if (below > 0) window.scrollBy({ top: below })
	}
	window.visualViewport?.addEventListener("resize", keepInView)

	function update(note: PageNote) {
		const replaced = latest !== null && note.rev !== latest.rev
		latest = note
		// Drawn when it changes: a failure is announced once.
		if (status.dataset.state !== note.status) {
			status.dataset.state = note.status
			status.innerHTML = statusHtml(note.status, strings)
		}
		if (focused() && !replaced) return
		if (fieldText(field) !== note.text || !focused()) show(note.text, note.links)
		keepInView()
	}

	/** The article picked, or null when the picker closed without one: back to writing either way. */
	function link(article: { id: string; title: string } | null) {
		const state = fromStored(fieldText(field))
		const length = state.text.length
		const end = { start: length, end: length }
		// A trigger no longer in its place (the note was replaced meanwhile): at the end.
		const within = linkRange(state.text, trigger, trigger ? end : (caret ?? end))
		trigger = null
		const next = article ? insertLink(state, within, article) : null
		// Past the longest note the server keeps, the link would only be refused on save.
		if (next && toStored(next.state).length <= NOTE_MAX) {
			const text = toStored(next.state)
			show(text, latest?.links ?? {})
			post({ type: "note", text })
			caret = { start: next.cursor, end: next.cursor }
		}
		field.focus()
		placeCaret(field, caret?.end ?? length)
	}

	return { element, update, link }
}

/**
 * Where a point in the post-it falls in the note's text as the app's note fields hold it: links
 * as their titles (`fromStored` in `src/lib/note-field.ts`).
 */
function offsetOf(field: HTMLElement, node: Node, offset: number): number {
	const range = document.createRange()
	range.setStart(field, 0)
	range.setEnd(node, offset)
	const before = document.createElement("div")
	before.append(range.cloneContents())
	return fromStored(fieldText(before)).text.length
}

/** The caret at `offset` in the note's text (links as their titles), as `offsetOf` counts it. */
function placeCaret(field: HTMLElement, offset: number) {
	let left = offset
	const selection = window.getSelection()
	if (!selection) return
	for (const child of Array.from(field.childNodes)) {
		const length = child.nodeType === 3 ? (child as Text).length : (child.textContent ?? "").length
		if (left <= length && child.nodeType === 3) {
			selection.collapse(child, left)
			return
		}
		if (left < length) break
		left -= length
	}
	selection.collapse(field, field.childNodes.length)
}

const LINK_ICON =
	'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4l-1.1 1.1M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.1-1.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

/**
 * The note as stored, from the post-it's text: links back to `[Title](/read/<id>)`. WebKit may
 * break lines with `<br>` or blocks instead of newlines. A block starts a line; a `<br>` last in
 * the field or in a block adds nothing (it only keeps an empty line open).
 */
export function fieldText(field: Element): string {
	let out = ""
	const walk = (node: Node) => {
		for (const child of Array.from(node.childNodes)) {
			if (child.nodeType === 3) {
				out += (child as Text).data
				continue
			}
			if (child.nodeType !== 1) continue
			const el = child as HTMLElement
			if (el.dataset.link) out += `[${el.textContent ?? ""}](/read/${el.dataset.link})`
			else if (el.tagName === "BR") {
				if (el !== el.parentNode?.lastChild) out += "\n"
			} else {
				if (out && !out.endsWith("\n")) out += "\n"
				walk(el)
			}
		}
	}
	walk(field)
	return out.replace(/ /g, " ")
}

/**
 * The paper's size for this text, as the app's `PostIt` (`postItChars`): about square for short
 * notes, growing toward a balanced rectangle, up to the room there is.
 */
export function postItSize(text: string): { width: string; minHeight: string } {
	const width = `calc(${postItChars(text)}ch + 2.5rem)`
	return { width: `min(100%, ${width})`, minHeight: `calc(${width} * ${LEAST_HEIGHT.full})` }
}

function statusHtml(status: PageNote["status"], strings: PageStrings): string {
	if (status === "saving") return escapeHtml(strings.saving)
	if (status === "saved") return escapeHtml(strings.saved)
	if (status === "error")
		return `<span role="alert">${escapeHtml(strings.notSaved)}<button type="button" class="end-link" data-end="note-retry">${escapeHtml(strings.retry)}</button></span>`
	return ""
}

/** The page's words in HTML: never markup. */
const escapeHtml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
