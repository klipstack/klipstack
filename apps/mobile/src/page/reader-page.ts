import {
	canonicalText,
	describeRange,
	rangeFromOffsets,
	resolveSelector,
	selectorFor,
	walkTextNodes,
} from "@klipstack/anchor"
import { EDITION_NOTE_PLACEHOLDER } from "../lib/edition-note"
import { controlsStep } from "./controls"
import { createInk, textRects } from "./ink"
import { type Box, lineBoxes } from "./line-boxes"
import type {
	EndAction,
	PageApi,
	PageConfig,
	PageEnd,
	PageHighlight,
	PageMessage,
	PageSelection,
	Sentence,
} from "./messages"
import { type Endpoint, moveEnd, type Offsets, wordEdges } from "./resize"
import { splitSentences } from "./sentences"
import { createTakeaway } from "./takeaway"

/**
 * The reader page's script, in the WebView (`readerHtml` puts it in the page; `scripts/build-page`
 * bundles it with `@klipstack/anchor` into `src/lib/reader-page.generated.ts`). It holds no token
 * and calls nothing: it tells the app what happens (`PageMessage`), and the app calls its
 * `window.klip…` functions (`PageApi`).
 * - The article is the stored HTML (`GET /articles/{id}/html`), untouched: the text of its text
 *   nodes is the text highlight offsets index, as in the web reader.
 * - `klipHighlights(list)` paints the highlights as marker strokes under the text (`ink.ts`), each
 *   at its offsets, or found by its quote and the text around it when the offsets are from another
 *   version (`resolveSelector`, as the server re-anchors). One with a note gets a tab beside its
 *   first line; a tap on it opens the highlight.
 * - `klipShow(id)` scrolls a highlight into view; `klipActive(id or null)` puts the one being edited
 *   in focus, as the web reader does: the text and the other highlights fade, and it stands out
 *   in its color with a line of that color around each of its strokes, and a handle at each end:
 *   dragging one moves that end to the nearest word (`{ type: "resize", … }` when let go; the app
 *   saves it and paints the list again). A tap off it says so (`{ type: "outside" }`).
 *   `klipReveal(id, covered)` moves it near the top when the bottom `covered` pixels
 *   would hide it.
 * - The selection, when inside the article, goes to the app as the place and text a highlight
 *   takes (`{ type: "selection", selection }`), for its Highlight item: offsets, so a passage
 *   across paragraphs needs no search.
 * - Scrolling tells the app where the reader is (`{ type: "reading", position, ended, moved }`:
 *   `ended`, the end of the article is on screen; `moved`, a screen or more since opening). It
 *   opens at the saved position, or at a highlight.
 * - Above the title, the article's topics; after the end block, the shelf of what to read next
 *   (`readerHtml`), whose cards are links to the library's reader pages. Reading progress is
 *   measured to the end block, not through it or the shelf (`readingSpan`).
 * - `klipEnd(end)` draws the end block after the article (whether leaving finishes it, the star,
 *   the mark for the next edition); its taps go to the app (`{ type: "end", action }`). In it, the
 *   article note's post-it (`takeaway.ts`), which `klipNote(note)` fills.
 * - A tap on a highlight tells the app which (`{ type: "highlight", id }`, the smallest when they
 *   overlap); a tap on a web link, which link (`{ type: "link", href, text }`), instead of
 *   following it.
 * - Reading aloud: `klipSentences(lang)` sends the title's and the text's sentences
 *   (`{ type: "sentences", list, start }`, `start` the first one on screen); `klipSpeaking(index
 *   or null)` marks the one being read and keeps it on screen, unless the reader touched the page
 *   in the last few seconds. While reading, a tap on the text (not on a link or a highlight) says
 *   which sentence (`{ type: "sentence", index }`).
 * - The app's controls hide as the reader scrolls down and come back as they scroll up
 *   (`controlsStep`); other taps show or hide them (`{ type: "controls", shown }`). `top` is what
 *   they cover: highlights and the first sentence to read are kept below it.
 */
export function startReaderPage(): void {
	const page = window as Window &
		Partial<PageApi> & { ReactNativeWebView?: { postMessage(message: string): void } }
	const config = readConfig()
	const TOP = config.top
	const root = document.querySelector("article")
	const post = (message: PageMessage) =>
		page.ReactNativeWebView?.postMessage(JSON.stringify(message))

	// ---- images ----

	// Stored images start empty; the app sets each as it lands in the page's folder.
	page.klipAsset = (id, name) => {
		for (const img of Array.from(document.querySelectorAll("img[data-asset]")))
			if (img.getAttribute("data-asset") === id) img.setAttribute("src", name)
	}
	// An image that doesn't load (gone, or a link to a page rather than a picture) takes no room.
	for (const img of Array.from(document.querySelectorAll("img")))
		img.addEventListener("error", () => {
			img.style.display = "none"
		})

	// ---- highlights ----

	// The article's text never changes once the page is up.
	let text: string | null = null
	const articleText = () => (text ??= root ? canonicalText(root) : "")

	function placeOf(h: PageHighlight): Offsets | null {
		if (!root || !h.quote) return null
		const found = resolveSelector(articleText(), {
			exact: h.quote,
			prefix: h.prefix,
			suffix: h.suffix,
			start: h.start,
			end: h.end,
		})
		if (!found || "ambiguous" in found) return null
		return { start: found.start, end: found.end }
	}

	const canPaint = () =>
		typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined"
	let byId = new Map<string, Range>()
	const colorOf = new Map<string, number>()
	const offsetsOf = new Map<string, Offsets>()
	const noted = new Set<string>()
	let active: string | null = null
	// The highlights' marker strokes, under the text (`ink.ts`), and the line around the one in focus
	// over them, drawn again whenever the strokes are measured.
	const ink = root ? createInk(root, outline) : null
	// Paints the highlights anew. The one in focus also gets its text at full strength over the
	// faded rest (`klip-active`, the CSS Custom Highlight API, whose text WebKit doesn't repaint when
	// it is taken away: the article is repainted).
	function paint() {
		ink?.set(
			[...byId].map(([id, range]) => ({
				id,
				range,
				color: colorOf.get(id) ?? 0,
				note: noted.has(id),
			})),
		)
		ink?.setActive(active && byId.has(active) ? active : null)
		const range = active ? byId.get(active) : undefined
		if (canPaint()) {
			if (range) {
				const mark = new Highlight(range)
				mark.priority = 1
				CSS.highlights.set("klip-active", mark)
			} else CSS.highlights.delete("klip-active")
		}
		if (range && active) root?.setAttribute("data-focus", String(colorOf.get(active) ?? 0))
		else root?.removeAttribute("data-focus")
		outline()
		repaint(root ?? undefined)
	}

	// The highlight in focus stands out: a line of its color around each of its strokes (`.hl-pop`),
	// over the ink, and a handle at each end of its text.
	// The handles stay the same elements while dragged: WebKit sends a touch's moves to the
	// element it started on, and one taken out of the page would get them no more.
	const layer = document.createElement("div")
	layer.className = "hl-layer"
	layer.setAttribute("aria-hidden", "true")
	const boxesEl = document.createElement("div")
	const handles = {
		start: makeHandle("start"),
		end: makeHandle("end"),
	}
	layer.append(boxesEl, handles.start, handles.end)
	document.body.appendChild(layer)
	function outline() {
		const range = active ? byId.get(active) : undefined
		if (!range || !active) {
			boxesEl.replaceChildren()
			layer.hidden = true
			delete layer.dataset.id
			return
		}
		layer.hidden = false
		const color = String(colorOf.get(active) ?? 0)
		placeHandles(
			lineBoxes(root ? textRects(range, root) : [], { x: window.scrollX, y: window.scrollY }),
		)
		// The same highlight measured again keeps its lines: they only appear once.
		const same = layer.dataset.id === active && layer.dataset.color === color
		layer.dataset.id = active
		layer.dataset.color = color
		boxesEl.replaceChildren(
			...(ink?.strokesOf(active) ?? []).map((stroke) => {
				const el = document.createElement("span")
				el.className = same ? "hl-pop" : "hl-pop hl-in"
				el.dataset.color = color
				el.style.left = `${stroke.left}px`
				el.style.top = `${stroke.top}px`
				el.style.width = `${stroke.width}px`
				el.style.height = `${stroke.height}px`
				el.style.borderRadius = stroke.radius
				if (stroke.tilt) el.style.transform = `rotate(${stroke.tilt}deg)`
				return el
			}),
		)
	}

	// ---- resizing ----

	function makeHandle(endpoint: Endpoint) {
		const el = document.createElement("div")
		el.className = `hl-handle hl-${endpoint}`
		el.addEventListener("touchstart", (event) => grab(event, endpoint), { passive: false })
		el.addEventListener("touchmove", drag, { passive: false })
		el.addEventListener("touchend", release)
		el.addEventListener("touchcancel", release)
		return el
	}
	/** The start's handle at the left of the first line, the end's at the right of the last. */
	function placeHandles(boxes: Box[]) {
		const first = boxes[0]
		const last = boxes[boxes.length - 1]
		for (const [el, box, x] of [
			[handles.start, first, first?.left],
			[handles.end, last, last && last.left + last.width],
		] as const) {
			el.hidden = !box
			if (!box || x === undefined) continue
			el.style.left = `${x}px`
			el.style.top = `${box.top}px`
			el.style.height = `${box.height}px`
		}
	}
	// Where each text node starts in the article's text, for the offset under a finger.
	let nodeStarts: Map<Node, number> | null = null
	function textOffset(node: Node, offset: number): number | null {
		if (!nodeStarts) {
			nodeStarts = new Map()
			let at = 0
			if (root)
				walkTextNodes(root, (text) => {
					nodeStarts!.set(text, at)
					at += text.data.length
				})
		}
		const start = nodeStarts.get(node)
		return start === undefined ? null : start + offset
	}
	let edges: ReturnType<typeof wordEdges> | null = null
	let dragging: {
		id: string
		endpoint: Endpoint
		from: Offsets
		draft: Offsets
		// From the finger to the point of the text the handle stands on: the finger doesn't hide it.
		dx: number
		dy: number
	} | null = null
	function grab(event: TouchEvent, endpoint: Endpoint) {
		const touch = event.touches[0]
		const from = active ? offsetsOf.get(active) : undefined
		if (!touch || !active || !from || event.touches.length > 1) return
		event.preventDefault()
		const box = handles[endpoint].getBoundingClientRect()
		dragging = {
			id: active,
			endpoint,
			from,
			draft: from,
			dx: box.left + box.width / 2 - touch.clientX,
			dy: box.top + box.height / 2 - touch.clientY,
		}
		document.documentElement.classList.add("hl-dragging")
	}
	function drag(event: TouchEvent) {
		const touch = event.touches[0]
		if (!dragging || !touch || !root) return
		event.preventDefault()
		const caret = document.caretRangeFromPoint?.(
			touch.clientX + dragging.dx,
			touch.clientY + dragging.dy,
		)
		const at = caret ? textOffset(caret.startContainer, caret.startOffset) : null
		if (at === null) return
		edges ??= wordEdges(articleText())
		const next = moveEnd(edges, dragging.draft, dragging.endpoint, at)
		if (next === dragging.draft) return
		const range = rangeFromOffsets(root, next.start, next.end)
		if (!range) return
		dragging.draft = next
		byId.set(dragging.id, range)
		offsetsOf.set(dragging.id, next)
		paint()
	}
	function release() {
		document.documentElement.classList.remove("hl-dragging")
		const done = dragging
		dragging = null
		if (!done || (done.draft.start === done.from.start && done.draft.end === done.from.end)) return
		const all = articleText()
		const place = ({ start, end }: Offsets) => ({ start, end, quote: all.slice(start, end) })
		post({ type: "resize", id: done.id, ...place(done.draft), previous: place(done.from) })
	}

	page.klipHighlights = (list) => {
		byId = new Map()
		colorOf.clear()
		offsetsOf.clear()
		noted.clear()
		for (const h of list) {
			const place = placeOf(h)
			const range = place && root ? rangeFromOffsets(root, place.start, place.end) : null
			if (!place || !range) continue
			offsetsOf.set(h.id, place)
			byId.set(h.id, range)
			colorOf.set(h.id, h.color >= 0 && h.color < 5 ? h.color : 0)
			if (h.note) noted.add(h.id)
		}
		paint()
	}
	page.klipActive = (id) => {
		active = id
		paint()
	}
	/** The smallest highlight at a point of the text; the point just after one is not in it. */
	function highlightAt(node: Node, offset: number): string | null {
		let best: { id: string; size: number } | null = null
		for (const [id, range] of byId) {
			const atEnd = node === range.endContainer && offset === range.endOffset
			if (atEnd || !range.isPointInRange(node, offset)) continue
			const size = range.toString().length
			if (!best || size < best.size) best = { id, size }
		}
		return best?.id ?? null
	}

	// Keeps a highlight clear of what covers the bottom of the page (the app's card, and the
	// keyboard over it): if it would be under it, it goes near the top. Room at the end lets the
	// last lines go that high; it goes when nothing covers the page.
	let room: HTMLDivElement | null = null
	page.klipReveal = (id, covered) => {
		if (!covered) {
			if (room) room.style.height = "0px"
			return
		}
		if (!room) {
			room = document.createElement("div")
			room.setAttribute("aria-hidden", "true")
			document.body.appendChild(room)
		}
		room.style.height = `${covered}px`
		const range = byId.get(id)
		if (!range) return
		const rect = range.getBoundingClientRect()
		if (rect.top >= TOP + 8 && rect.bottom <= window.innerHeight - covered - 8) return
		window.scrollTo({ top: window.scrollY + rect.top - TOP - 16, behavior: "smooth" })
	}
	page.klipShow = (id) => {
		const range = byId.get(id)
		if (!range) return
		const rect = range.getBoundingClientRect()
		window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight / 4, behavior: "smooth" })
	}

	// ---- the selection ----

	page.klipClearSelection = () => window.getSelection()?.removeAllRanges()
	/** The selected passage, without the whitespace at its ends; null outside the article. */
	function currentSelection(): PageSelection | null {
		const selection = window.getSelection()
		if (!root || !selection || !selection.rangeCount || selection.isCollapsed) return null
		const range = selection.getRangeAt(0)
		if (!root.contains(range.commonAncestorContainer)) return null
		const described = describeRange(range, root)
		if (!described) return null
		const all = articleText()
		let { start, end } = described
		while (start < end && /\s/.test(all.charAt(start))) start++
		while (end > start && /\s/.test(all.charAt(end - 1))) end--
		return start < end ? selectorFor(all, start, end) : null
	}
	let selectionTimer: ReturnType<typeof setTimeout> | undefined
	document.addEventListener("selectionchange", () => {
		clearTimeout(selectionTimer)
		selectionTimer = setTimeout(
			() => post({ type: "selection", selection: currentSelection() }),
			120,
		)
	})

	// ---- taps ----

	const squash = (value: string) => value.replace(/\s+/g, " ")
	// A tap on a web link goes to the app, which offers what to do with it; the page doesn't leave.
	// Anchors in the page (footnotes) behave as links; a mail link goes to the app, which opens
	// Mail; other schemes do nothing. A tap on a highlight (not ending a selection) opens it in the
	// app. While reading aloud, a tap on a sentence reads from there. Any other tap shows or hides
	// the app's controls, unless it only ends a selection.
	let hadSelection = false
	document.addEventListener(
		"touchstart",
		() => {
			hadSelection = !(window.getSelection()?.isCollapsed ?? true)
		},
		{ passive: true },
	)
	document.addEventListener("click", (event) => {
		const target = event.target instanceof Element ? event.target : null
		// The end block's buttons answer for themselves.
		if (target?.closest("#klip-end")) return
		// A noted highlight's tab opens it.
		const tab = target?.closest<HTMLElement>(".hl-tab[data-id]")
		if (tab) return post({ type: "highlight", id: tab.dataset.id! })
		const link = target?.closest<HTMLAnchorElement>("a[href]")
		if (link) {
			if ((link.getAttribute("href") ?? "")[0] === "#") return
			event.preventDefault()
			if (/^mailto:/i.test(link.href)) return post({ type: "mail", href: link.href })
			if (!/^https?:/i.test(link.href)) return
			return post({ type: "link", href: link.href, text: squash(link.textContent ?? "").trim() })
		}
		if (!(window.getSelection()?.isCollapsed ?? true)) return
		const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY) ?? null
		const id = caret ? highlightAt(caret.startContainer, caret.startOffset) : null
		if (id) return post({ type: "highlight", id })
		// A highlight is open: a tap elsewhere closes it, and does nothing else.
		if (active) return post({ type: "outside" })
		if (!speaking) {
			if (!hadSelection) toggleControls()
			return
		}
		if (!caret) return
		const index = spoken.findIndex((range) =>
			range.isPointInRange(caret.startContainer, caret.startOffset),
		)
		if (index !== -1) post({ type: "sentence", index })
	})

	// ---- the end of the article ----

	const endBlock = document.getElementById("klip-end")
	// The block's parts: what is drawn again with each `klipEnd`, around the post-it, which stays (it
	// may be written in) and is put in once the end is drawn.
	const endHead = document.createElement("div")
	const endRest = document.createElement("div")
	endHead.className = endRest.className = "end-part"
	const takeaway = createTakeaway(post)
	// Marked with its button here: what that opens below scrolls into view once the app says so.
	let showEdition = false
	page.klipEnd = (end) => {
		if (!endBlock) return
		if (!endBlock.firstChild) endBlock.append(endHead, takeaway.element, endRest)
		const parts = endParts(end)
		endHead.innerHTML = parts.head
		endRest.innerHTML = parts.rest
		if (!end.shortlisted) return
		const card = showEdition ? endBlock.querySelector(".end-edition") : null
		showEdition = false
		const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
		card?.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" })
	}
	page.klipNote = takeaway.update
	endBlock?.addEventListener("click", (event) => {
		const button =
			event.target instanceof Element ? event.target.closest<HTMLElement>("[data-end]") : null
		const action = button?.dataset.end as EndAction | undefined
		if (!action) return
		if (action === "shortlist") showEdition = button?.getAttribute("aria-pressed") !== "true"
		post({ type: "end", action })
	})

	// ---- reading ----

	// The web reader's position (the top plus a fifth of the screen, over the scrollable height),
	// reported to the app at most every 250 ms. The app draws the progress line: WebKit doesn't
	// repaint a fixed element after a scroll the page made until the next touch.
	let startY = 0
	let readingTimer: ReturnType<typeof setTimeout> | undefined
	function reportReading() {
		readingTimer = undefined
		const el = document.documentElement
		const max = readingSpan(el)
		post({
			type: "reading",
			position:
				max <= 0 ? 1 : Math.min(1, Math.max(0, (window.scrollY + el.clientHeight * 0.2) / max)),
			ended: endBlock ? endBlock.getBoundingClientRect().top < window.innerHeight : false,
			moved: Math.abs(window.scrollY - startY) >= el.clientHeight,
		})
	}
	window.addEventListener(
		"scroll",
		() => {
			readingTimer ??= setTimeout(reportReading, 250)
			followControls()
		},
		{ passive: true },
	)

	// The app's controls, shown or hidden as the reader scrolls (controlsStep) or taps: the page
	// keeps the state and tells the app when it changes. Not before the page has opened at its
	// saved position: that scroll isn't the reader's.
	let controls = { shown: true, from: 0 }
	let controlsReady = false
	function followControls() {
		if (!controlsReady) return
		const el = document.documentElement
		const next = controlsStep(controls, window.scrollY, el.scrollHeight - el.clientHeight)
		const changed = next.shown !== controls.shown
		controls = next
		if (changed) post({ type: "controls", shown: controls.shown })
	}
	function toggleControls() {
		controls = { shown: !controls.shown, from: window.scrollY }
		post({ type: "controls", shown: controls.shown })
	}

	// Changes the type in place, keeping the reader at the same place in the text.
	page.klipType = (fontSize, sans) => {
		const el = document.documentElement
		const before = el.scrollHeight - el.clientHeight
		const at = before > 0 ? window.scrollY / before : 0
		el.style.fontSize = `${fontSize}px`
		el.classList.toggle("sans", sans)
		window.scrollTo(0, at * (el.scrollHeight - el.clientHeight))
		ink?.measure()
		reportReading()
	}

	// ---- reading aloud ----

	// The title and the text's blocks, innermost first (a list item's paragraph, not the item);
	// code, tables, captions and footnote marks are left out.
	let spoken: Range[] = []
	let spokenBlocks: Element[] = []
	let speaking = false
	let current: number | null = null
	let touched = 0
	const SPEAKABLE = "P,LI,H1,H2,H3,H4,H5,H6,BLOCKQUOTE,DT,DD"
	const SKIPPED = "PRE,TABLE,FIGCAPTION,SUP,SCRIPT,STYLE,NOSCRIPT"
	function blockSentences(block: Element, lang: string) {
		let value = ""
		const at: Array<[Text, number]> = []
		const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
		for (
			let node = walker.nextNode() as Text | null;
			node;
			node = walker.nextNode() as Text | null
		) {
			const parent = node.parentElement
			if (!parent || parent.closest(SKIPPED)) continue
			const anchor = parent.closest("a[href^='#']")
			if (anchor && /^\W*\d+\W*$/.test(anchor.textContent ?? "")) continue
			const data = node.data
			for (let i = 0; i < data.length; i++) {
				if (/\s/.test(data.charAt(i))) {
					if (value === "" || value.endsWith(" ")) continue
					value += " "
				} else value += data.charAt(i)
				at.push([node, i])
			}
		}
		return splitSentences(value, lang).map(([start, end]) => {
			const range = document.createRange()
			const [first, firstAt] = at[start]!
			const [last, lastAt] = at[end - 1]!
			range.setStart(first, firstAt)
			range.setEnd(last, lastAt + 1)
			return { range, text: value.slice(start, end) }
		})
	}
	page.klipSentences = (lang) => {
		const title = document.querySelector("header h1")
		const blocks = [
			...(title ? [title] : []),
			...Array.from(root?.querySelectorAll(SPEAKABLE) ?? []).filter(
				(el) => !el.querySelector(SPEAKABLE) && !el.closest(SKIPPED),
			),
		]
		spoken = []
		spokenBlocks = []
		const list: Sentence[] = []
		for (const block of blocks) {
			const heading = /^H[1-6]$/.test(block.tagName)
			const found = blockSentences(block, lang)
			found.forEach((sentence, i) => {
				spoken.push(sentence.range)
				spokenBlocks.push(block)
				list.push({
					text: sentence.text,
					pause: i < found.length - 1 ? 0.15 : heading ? 0.7 : 0.5,
				})
			})
		}
		// The first sentence whose start is on screen; the title when at the top.
		let start = 0
		if (window.scrollY > 40) {
			const below = controls.shown ? TOP : 0
			const first = spoken.findIndex((range) => range.getBoundingClientRect().top >= below)
			if (first !== -1) start = first
		}
		post({ type: "sentences", list, start })
	}
	// WebKit doesn't repaint the text a highlight leaves: a style change on its block does.
	function repaint(block: Element | undefined) {
		if (!(block instanceof HTMLElement)) return
		block.style.outline = "1px solid transparent"
		requestAnimationFrame(() => {
			block.style.outline = ""
		})
	}
	page.klipSpeaking = (index) => {
		speaking = index !== null
		if (!canPaint()) return
		if (current !== null && current !== index) repaint(spokenBlocks[current])
		current = index
		const range = index === null ? undefined : spoken[index]
		if (!range) {
			CSS.highlights.delete("klip-speaking")
			return
		}
		const mark = new Highlight(range)
		mark.priority = -1
		CSS.highlights.set("klip-speaking", mark)
		if (Date.now() - touched < 5000) return
		// Clear of the player at the bottom; a third of the way down when it moves.
		const rect = range.getBoundingClientRect()
		if (rect.top >= 16 && rect.bottom <= window.innerHeight - 160) return
		window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight / 3, behavior: "smooth" })
	}
	const touch = () => {
		touched = Date.now()
	}
	document.addEventListener("touchstart", touch, { passive: true })
	document.addEventListener("touchmove", touch, { passive: true })

	// ---- opening ----

	page.klipHighlights(config.highlights)
	// At the saved position (the inverse of the one reported); 0 stays at the top. Or at a
	// highlight, a quarter of the way down, when it was found. After the first layout; and measured
	// a frame later, once the scroll has landed, so the first report is where the page opened.
	requestAnimationFrame(() => {
		const range = config.highlight ? byId.get(config.highlight) : undefined
		if (range) {
			const rect = range.getBoundingClientRect()
			window.scrollTo(0, Math.max(0, window.scrollY + rect.top - window.innerHeight / 4))
		} else if (config.position > 0) {
			const el = document.documentElement
			const max = readingSpan(el)
			window.scrollTo(0, Math.max(0, config.position * max - el.clientHeight * 0.2))
		}
		requestAnimationFrame(() => {
			startY = window.scrollY
			controls.from = startY
			controlsReady = true
			reportReading()
		})
	})
}

/**
 * How far the page scrolls while reading the article: to its end, not through what comes after it
 * (`data-after-reading`: the end block with the note's post-it, then the shelf of what to read
 * next), so an article read to its end is read, however tall its note. As the web reader's
 * (apps/web/app/hooks/use-reading-progress.ts). An end block not drawn yet takes no room.
 */
export function readingSpan(el: HTMLElement): number {
	let tail = 0
	for (const after of document.querySelectorAll<HTMLElement>("[data-after-reading]")) {
		if (!after.offsetHeight) continue
		tail += after.offsetHeight + (Number.parseFloat(getComputedStyle(after).marginTop) || 0)
	}
	return el.scrollHeight - el.clientHeight - tail
}

const NO_CONFIG: PageConfig = { top: 0, highlights: [], position: 0, highlight: null }

const CHECK =
	'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const STAR =
	'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6L2.5 9.3l6.6-.8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'
const SHARE =
	'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const EDITION =
	'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h13v14H6a2 2 0 01-2-2zM17 9h3v8a2 2 0 01-2 2M8 9h5M8 13h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'

/** Text in HTML: what the user wrote never becomes markup. */
const escapeText = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Links (`[text](https://…)`) as their text, as the note reads. */
const linkText = (text: string) => text.replace(/\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g, "$1")

/**
 * The end block's content, around the post-it of the article note: the web reader's
 * (apps/web/app/components/reader-end.tsx). `head`, above the post-it: one line that says where
 * reading left the article, and Mark as Finished while it is early. `rest`, below: the choices,
 * and once marked, the note for the next edition.
 */
export function endParts(end: PageEnd): { head: string; rest: string } {
	const done = end.state === "finished" || end.state === "finishing"
	const heading = `<span class="end-heading">${done ? `<span class="end-check">${CHECK}</span>Finished` : "You reached the end"}</span>`
	const state =
		end.state === "finishing"
			? ` ${end.archived ? "It's marked as finished when you leave." : "It goes to your archive when you leave."} <button type="button" class="end-link" data-end="keep">${end.archived ? "Keep unfinished" : "Keep in Library"}</button>`
			: end.state === "kept"
				? ` ${end.archived ? "It stays unfinished." : "It stays in your Library."} <button type="button" class="end-link" data-end="unkeep">Finish when I leave</button>`
				: ""
	const finish =
		end.state === "early"
			? `<button type="button" class="end-finish" data-end="finish">${CHECK}Mark as Finished</button>`
			: ""
	const star = `<button type="button" class="end-choice${end.starred ? " starred" : ""}" data-end="star" aria-pressed="${end.starred}">${STAR}${end.starred ? "Starred" : "Star"}</button>`
	const share = `<button type="button" class="end-choice" data-end="share">${SHARE}Share</button>`
	const edition = `<button type="button" class="end-choice wide${end.shortlisted ? " on" : ""}" data-end="shortlist" aria-pressed="${end.shortlisted}">${EDITION}${end.shortlisted ? "In Next Edition" : "Share in Next Edition"}</button>`
	// Marked: it says so, and offers the note for the edition's readers, which the app edits.
	const written = end.editionNote?.trim() ? linkText(end.editionNote) : null
	const card = end.shortlisted
		? `<div class="end-edition"><div class="end-edition-title"><span class="end-check">${CHECK}</span>Added to your next edition</div><div class="end-edition-label">For your edition's readers</div><button type="button" class="end-edition-note${written ? "" : " empty"}" data-end="edition-note">${escapeText(written ?? EDITION_NOTE_PLACEHOLDER)}</button></div>`
		: ""
	return {
		head: `<p class="end-status">${heading}${state}</p>${finish}`,
		rest: `<div class="end-choices">${star}${share}${edition}</div>${card}`,
	}
}

function readConfig(): PageConfig {
	try {
		const raw = document.getElementById("klip-config")?.textContent
		return raw ? { ...NO_CONFIG, ...(JSON.parse(raw) as Partial<PageConfig>) } : NO_CONFIG
	} catch {
		return NO_CONFIG
	}
}
