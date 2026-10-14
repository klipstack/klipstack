/**
 * The small animations of the list's key actions: archiving thumps a library date stamp on the card;
 * deleting, restoring or taking it out of the archive lifts it away, plainly. The card itself
 * leaves the list at once, as before (the cursor, the keys and the next click go on); what plays is
 * a copy of it laid over the page (a ghost), so a reload of the list, a live update or an Undo can
 * never cut it short. The cards below wait for it, then slide into the gap (`settleList`).
 *
 * Nothing here runs under `prefers-reduced-motion`, and app.css turns the animations off as well.
 * Client only: every function is called from an event or an effect.
 */

export type Leave = "archive" | "lift"

/** When the cards below start to close the gap: once the stamp has landed, or as the card lifts. */
const SETTLE_DELAY: Record<Leave | "settle", number> = {
	archive: 300,
	lift: 80,
	settle: 0,
}
const SETTLE_MS = 240
/** A batch goes card after card, so many read as many; only the first few animate. */
const STAGGER_MS = 45
const MAX_GHOSTS = 10
/** Longest a ghost can live, its delay included: removed then even if `animationend` never came. */
const GHOST_MS = 1300
/** A snapshot older than this is about something else: nothing slides. */
const SNAPSHOT_MS = 4000
/** A card that comes back this soon after leaving came back by Undo. */
const RETURN_MS = 20_000

export function reducedMotion() {
	return (
		typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches
	)
}

// ---- the cards below: they slide into place ----

interface Snapshot {
	at: number
	/** The page the list showed (`data-motion-page`): another page of it never slides. */
	page: string | undefined
	delay: number
	pos: Map<string, { x: number; y: number }>
}
const lists = new Set<HTMLElement>()
const snapshots = new WeakMap<HTMLElement, Snapshot>()

/** A list whose cards slide into place after a change (`DocumentList`). Returns the unregister. */
export function registerList(list: HTMLElement) {
	lists.add(list)
	return () => {
		lists.delete(list)
	}
}

/**
 * Where each card is in the list: where it shows (`shown`, a slide on its way included), or where
 * its slide will end (`laid`). A second change while the first slides starts from where it shows.
 */
function positions(list: HTMLElement, at: "shown" | "laid") {
	const origin = list.getBoundingClientRect()
	const pos = new Map<string, { x: number; y: number }>()
	for (const el of list.querySelectorAll<HTMLElement>(":scope > [data-motion-key]")) {
		const r = el.getBoundingClientRect()
		const sliding = at === "laid" && el.getAnimations().some((a) => a.id === SLIDE)
		const { m41: tx, m42: ty } = sliding
			? new DOMMatrixReadOnly(getComputedStyle(el).transform)
			: { m41: 0, m42: 0 }
		pos.set(el.dataset.motionKey as string, {
			x: r.left - tx - origin.left,
			y: r.top - ty - origin.top,
		})
	}
	return pos
}
const SLIDE = "klip-slide"

/**
 * Where every card is now, before a change that moves them: the next render that moves any slides
 * them from here. Called by the actions themselves (`playLeave`), an Undo, a save and a live update.
 */
export function prepareMotion(after: Leave | "settle" = "settle", extraDelay = 0) {
	if (reducedMotion()) return
	for (const list of lists)
		snapshots.set(list, {
			at: Date.now(),
			page: list.dataset.motionPage,
			delay: SETTLE_DELAY[after] + extraDelay,
			pos: positions(list, "shown"),
		})
}

/** After a render (a layout effect): the cards that moved since the snapshot slide there. */
export function settleList(list: HTMLElement) {
	const snapshot = snapshots.get(list)
	if (!snapshot) return
	if (
		Date.now() - snapshot.at > SNAPSHOT_MS ||
		snapshot.page !== list.dataset.motionPage ||
		reducedMotion()
	) {
		snapshots.delete(list)
		return
	}
	const now = positions(list, "laid")
	let moved = false
	for (const el of list.querySelectorAll<HTMLElement>(":scope > [data-motion-key]")) {
		const key = el.dataset.motionKey as string
		const before = snapshot.pos.get(key)
		const after = now.get(key)
		if (!before || !after) continue
		const dx = before.x - after.x
		const dy = before.y - after.y
		if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
		moved = true
		for (const a of el.getAnimations()) if (a.id === SLIDE) a.cancel()
		el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
			duration: SETTLE_MS,
			delay: snapshot.delay,
			easing: "cubic-bezier(0.3, 0.7, 0.2, 1)",
			fill: "backwards",
			id: SLIDE,
		})
	}
	// One change, one slide: renders that follow (the reload) start from where things are.
	if (moved) snapshots.delete(list)
}

// ---- the card that leaves: its ghost ----

const left = new Map<string, number>()

/** How long after it was saved a card that shows up in the list is new: it gets the clip. */
const FRESH_MS = 2 * 60_000

export type Entering = "clip" | "return"

/**
 * A card showed up in a list that stayed on the page: back by Undo when it left by an action here a
 * moment ago, clipped when just saved, else nothing.
 */
export function entersAs(id: string, createdAt: Date | string): Entering | null {
	const now = Date.now()
	const at = left.get(id)
	if (at !== undefined && now - at < RETURN_MS) return "return"
	return now - new Date(createdAt).getTime() < FRESH_MS ? "clip" : null
}

export interface StampText {
	/** "Archived", in the reader's language. */
	label: string
	locale: string
}

let layer: HTMLElement | null = null
function ghostLayer() {
	if (layer?.isConnected) return layer
	layer = document.createElement("div")
	layer.className = "motion-layer"
	layer.setAttribute("aria-hidden", "true")
	document.body.append(layer)
	return layer
}

/**
 * The cards `ids` leave the list now, by `kind`. Call it before the change renders (in the click or
 * key handler), while the cards are still on the page. Cards out of view just go.
 */
export function playLeave(ids: readonly string[], kind: Leave, stamp?: StampText) {
	const now = Date.now()
	for (const id of ids) left.set(id, now)
	if (reducedMotion()) return
	const cards = ids
		.map((id) => document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`))
		.filter((el): el is HTMLElement => el !== null && inView(el))
		.slice(0, MAX_GHOSTS)
	cards.forEach((card, i) => ghost(card, kind, i * STAGGER_MS, stamp))
	prepareMotion(kind, Math.max(0, cards.length - 1) * STAGGER_MS)
}

function inView(el: HTMLElement) {
	const r = el.getBoundingClientRect()
	return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight
}

function ghost(card: HTMLElement, kind: Leave, delay: number, stamp?: StampText) {
	const r = card.getBoundingClientRect()
	const wrap = document.createElement("div")
	wrap.className = "motion-ghost"
	wrap.dataset.kind = kind
	// The list's layout, for its `layout-grid:` styles.
	wrap.dataset.layout = card.closest("[data-layout]")?.getAttribute("data-layout") ?? "list"
	// Where archived cards stay (starred): archiving puts only the stamp on the card, which stays,
	// and taking it out of the archive does not move it.
	const stays = card.closest("[data-keeps-archived]") !== null
	if (stays && kind === "lift") return
	if (stays && kind === "archive") wrap.dataset.stays = ""
	Object.assign(wrap.style, {
		left: `${r.left}px`,
		top: `${r.top}px`,
		width: `${r.width}px`,
		height: `${r.height}px`,
	})
	// A batch goes card after card: the ghost and everything in it start this late (app.css).
	wrap.style.setProperty("--delay", `${delay}ms`)
	if (!stays) {
		const copy = card.cloneNode(true) as HTMLElement
		// A picture of the card, not the card: nothing that finds the card (ids, test hooks) finds it.
		for (const el of [copy, ...copy.querySelectorAll("*")])
			for (const name of ["id", "data-testid", "data-card-id", "data-motion-key"])
				el.removeAttribute(name)
		copy.removeAttribute("data-cursor")
		copy.removeAttribute("data-checked")
		copy.inert = true
		copy.className = `${copy.className} motion-copy`
		wrap.append(copy)
	}
	if (kind === "archive" && stamp) wrap.append(dateStamp(stamp))
	ghostLayer().append(wrap)
	const done = () => wrap.remove()
	wrap.addEventListener("animationend", (e) => {
		if (e.target === wrap) done()
	})
	window.setTimeout(done, GHOST_MS + delay)
}

/** Never quite straight, as a stamp by hand. */
const TILTS = [-7, -4, 3, -9, 5]
let tiltIndex = 0

/** A library's date stamp: the word, and today's date under it. */
function dateStamp({ label, locale }: StampText) {
	const stamp = document.createElement("span")
	stamp.className = "motion-stamp"
	stamp.style.setProperty("--tilt", `${TILTS[tiltIndex++ % TILTS.length]}deg`)
	const word = document.createElement("span")
	word.textContent = label
	const date = document.createElement("span")
	date.textContent = new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		year: "numeric",
	}).format(new Date())
	stamp.append(word, date)
	return stamp
}
