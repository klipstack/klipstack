import { NOTE_MAX } from "@klipstack/api-contract/names"
import { parse } from "@klipstack/api-contract/note-links"
import type { PageMessage, PageNote } from "./messages"

/** What the post-it asks while the note is empty. */
export const TAKEAWAY_PLACEHOLDER = "What will you take from this?"

/**
 * The article note on a post-it at the end of the article, written on in place: the web reader's
 * (apps/web/app/components/post-it.tsx). It is the note of the app's notes sheet: what is typed
 * goes to the app (`{ type: "note" }`), which saves it, and the app's note comes back
 * (`klipNote`). Links show as their titles and can't be typed into; a deletion takes the whole
 * link, as in the sheet. While the post-it is written in, it keeps its own text, unless the app
 * replaced the note (`rev`). Its paper grows with the text and doesn't shrink under the caret.
 */
export function createTakeaway(post: (message: PageMessage) => void): {
	element: HTMLElement
	update: (note: PageNote) => void
} {
	const element = document.createElement("div")
	element.className = "takeaway"
	element.innerHTML = `<div class="takeaway-label">Your note <span>· only you</span></div><div class="post-it"><span class="tape" aria-hidden="true"></span><div class="takeaway-field" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="Your note" autocapitalize="sentences" data-placeholder="${TAKEAWAY_PLACEHOLDER}"></div></div><div class="takeaway-status" aria-live="polite"></div>`
	const paper = element.querySelector<HTMLElement>(".post-it")!
	const field = element.querySelector<HTMLElement>(".takeaway-field")!
	const status = element.querySelector<HTMLElement>(".takeaway-status")!

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
		Object.assign(paper.style, postItSize(fit || TAKEAWAY_PLACEHOLDER))
	}

	changed("")

	field.addEventListener("beforeinput", (event) => {
		if (!event.inputType.startsWith("insert")) return
		const adding = event.data?.length ?? 1
		const selected = window.getSelection()?.toString().length ?? 0
		if (fieldText(field).length + adding - selected > NOTE_MAX) event.preventDefault()
	})
	field.addEventListener("input", () => {
		const text = fieldText(field)
		changed(text)
		post({ type: "note", text })
		keepInView()
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
		status.innerHTML = statusHtml(note.status)
		if (focused() && !replaced) return
		if (fieldText(field) !== note.text || !focused()) show(note.text, note.links)
		keepInView()
	}

	return { element, update }
}

/**
 * The note as stored, from the post-it's text: links back to `[Title](/read/<id>)`. WebKit may
 * break lines with `<br>` or blocks instead of newlines; the `<br>` it keeps last, to show an
 * empty last line, adds nothing.
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
				if (el !== field.lastChild) out += "\n"
			} else {
				if (out && !out.endsWith("\n")) out += "\n"
				walk(el)
			}
		}
	}
	walk(field)
	return out.replace(/ /g, " ")
}

/** A note's text line, in characters: never a sliver, never wider than reads well. */
const MIN_CH = 14
const MAX_CH = 52

/**
 * The paper's size for this text, as the web's `postItSize`: about square for short notes,
 * growing toward a balanced rectangle, up to the room there is.
 */
export function postItSize(text: string): { width: string; minHeight: string } {
	const shown = text.trim().replace(/\[([^\]]*)\]\(\/read\/[^)\s]*\)/g, "$1")
	const breaks = shown.split("\n").length - 1
	const length = shown.length + breaks * 24
	const ch = Math.round(Math.min(MAX_CH, Math.max(MIN_CH, Math.sqrt(4 * length))))
	const width = `calc(${ch}ch + 2.5rem)`
	return { width: `min(100%, ${width})`, minHeight: `calc(${width} * 0.62)` }
}

function statusHtml(status: PageNote["status"]): string {
	if (status === "saving") return "Saving…"
	if (status === "saved") return "Saved"
	if (status === "error")
		return 'Not saved · <button type="button" class="end-link" data-end="note-retry">Retry</button>'
	return ""
}
