import { insertTitle, parse } from "@klipstack/api-contract/note-links"

/**
 * A note as the phone's text field shows it: links as their titles, with where each sits. Notes
 * store a link as `[Title](/read/<id>)` (the grammar is in `@klipstack/api-contract/note-links`);
 * the field can hold only plain text, so the app keeps the links beside it and puts them back on
 * save. Like the web editor's chips: typing inside a title makes it plain text, and deleting any
 * of it removes the whole link.
 */
export type NoteLink = { start: number; end: number; id: string }
export type NoteState = { text: string; links: NoteLink[] }

export function fromStored(stored: string): NoteState {
	let text = ""
	const links: NoteLink[] = []
	parse(stored).forEach((line, i) => {
		if (i > 0) text += "\n"
		for (const segment of line) {
			if (segment.kind === "link") {
				links.push({ start: text.length, end: text.length + segment.title.length, id: segment.id })
				text += segment.title
			} else text += segment.text
		}
	})
	return { text, links }
}

export function toStored({ text, links }: NoteState): string {
	let out = ""
	let at = 0
	for (const link of links) {
		out += `${text.slice(at, link.start)}[${text.slice(link.start, link.end)}](/read/${link.id})`
		at = link.end
	}
	return out + text.slice(at)
}

/**
 * The field's own `maxLength` for a note limited to `max` stored characters: the field shows each
 * link by its title alone, so the room its stored form takes (`[`, `](/read/<id>)`) comes off.
 */
export function fieldMaxLength(state: NoteState, max: number): number {
	return max - (toStored(state).length - state.text.length)
}

/**
 * The note after the field's text changed to `next`. The change is found by what the old and new
 * text share at both ends. `cursor` is set when the note differs from `next`: a deletion that
 * touched a link took the whole link, and the field must show it.
 */
export function applyEdit(prev: NoteState, next: string): { state: NoteState; cursor?: number } {
	const old = prev.text
	let from = 0
	while (from < old.length && from < next.length && old[from] === next[from]) from++
	let tail = 0
	while (
		tail < old.length - from &&
		tail < next.length - from &&
		old[old.length - 1 - tail] === next[next.length - 1 - tail]
	)
		tail++
	const oldEnd = old.length - tail
	const inserted = next.slice(from, next.length - tail)
	const touches = (l: NoteLink) => l.end > from && l.start < oldEnd

	if (!inserted && prev.links.some(touches)) {
		// A deletion into a link removes all of it.
		let start = from
		let end = oldEnd
		for (const l of prev.links.filter(touches)) {
			start = Math.min(start, l.start)
			end = Math.max(end, l.end)
		}
		const state = {
			text: old.slice(0, start) + old.slice(end),
			links: shift(prev.links, start, end, 0),
		}
		return { state, cursor: start }
	}
	// Typing inside a title makes it plain text.
	return { state: { text: next, links: shift(prev.links, from, oldEnd, inserted.length) } }
}

/**
 * The note with a link to `article` in place of the selection, then a space (the web adds one
 * after a chip too), and where the cursor goes: after them. A space goes before it too when it
 * would touch a word: the button inserts at the end of a note that ends in one.
 */
export function insertLink(
	prev: NoteState,
	selection: { start: number; end: number },
	article: { id: string; title: string },
): { state: NoteState; cursor: number } {
	const title = insertTitle(article.title) || "Untitled"
	const { start, end } = selection
	const blank = (c: string | undefined) => c === undefined || c === " " || c === "\n"
	const before = start > 0 && !blank(prev.text[start - 1]) ? " " : ""
	const after = blank(prev.text[end]) && end < prev.text.length ? "" : " "
	const added = before + title + after
	const at = start + before.length
	const links = shift(prev.links, start, end, added.length)
	links.push({ start: at, end: at + title.length, id: article.id })
	links.sort((a, b) => a.start - b.start)
	return {
		state: { text: prev.text.slice(0, start) + added + prev.text.slice(end), links },
		cursor: at + title.length + 1,
	}
}

/**
 * What typed in the field opens the article picker, as the web's `[[` menu: `[[` (the Obsidian
 * habit) or `@`, one keyboard layer away where `[` is two. `@` only starts a word: the picker is a
 * sheet over the note, so one opened in the middle of an email address would stop the typing.
 */
const TRIGGERS = ["[[", "@"]

type Range = { start: number; end: number }

/**
 * Where the trigger just typed sits in `next`, when the change from `prev` was one character typed
 * that completes `[[` or is `@`: the picker's link replaces that range. A paste never opens it.
 */
export function typedTrigger(prev: string, next: string): Range | null {
	if (next.length !== prev.length + 1) return null
	let at = 0
	while (at < prev.length && prev[at] === next[at]) at++
	if (prev.slice(at) !== next.slice(at + 1)) return null
	const end = at + 1
	for (const trigger of TRIGGERS) {
		const start = end - trigger.length
		if (next.slice(start, end) !== trigger) continue
		if (trigger === "@" && start > 0 && !/\s/.test(next[start - 1]!)) return null
		return { start, end }
	}
	return null
}

/**
 * Where the picked link goes in `text`: in place of the trigger typed, if it is still there, or
 * at `fallback`. The note may have changed while the picker was open (replaced from elsewhere):
 * the trigger's place then no longer holds it, and replacing it would take other words.
 */
export function linkRange(text: string, trigger: Range | null, fallback: Range): Range {
	const at =
		trigger && TRIGGERS.includes(text.slice(trigger.start, trigger.end)) ? trigger : fallback
	return { start: Math.min(at.start, text.length), end: Math.min(at.end, text.length) }
}

/**
 * Links after `[from, to)` is replaced by `length` characters: those before stay, those after
 * move, and those it overlaps (or an insertion splits) are dropped.
 */
function shift(links: NoteLink[], from: number, to: number, length: number): NoteLink[] {
	const delta = length - (to - from)
	return links.flatMap((l) => {
		if (l.end <= from) return [l]
		if (l.start >= to) return [{ ...l, start: l.start + delta, end: l.end + delta }]
		return []
	})
}

/** The field's text in runs, each plain or one link, to style the titles. */
export function runs({ text, links }: NoteState): Array<{
	start: number
	text: string
	link: NoteLink | null
}> {
	const out: Array<{ start: number; text: string; link: NoteLink | null }> = []
	let at = 0
	for (const link of links) {
		if (link.start > at) out.push({ start: at, text: text.slice(at, link.start), link: null })
		if (link.end > link.start)
			out.push({ start: link.start, text: text.slice(link.start, link.end), link })
		at = link.end
	}
	if (at < text.length) out.push({ start: at, text: text.slice(at), link: null })
	return out
}
