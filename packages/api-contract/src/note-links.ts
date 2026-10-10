/**
 * Links between notes. A link is a plain Markdown link to a reader URL: `[Title](/read/<uuid>)`.
 * Notes stay plain text; this file is the whole grammar, framework-free so the server, the web
 * editor and the mobile app share it. Link titles are cleaned with `insertTitle` (`names.ts`),
 * which the CLI shares.
 */
import { insertTitle, TITLE_MAX } from "./names"

export { insertTitle, TITLE_MAX }

/** Lowercase uuid, as `newId` writes them. An uppercase one is not a link. */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
// Link text holds no bracket of either kind, so `[[ [One](/read/…)` keeps its stray brackets as
// text instead of swallowing them into the title.
const LINK = new RegExp(`\\[([^[\\]\\n]*)\\]\\(/read/(${UUID})\\)`, "g")

export type Segment = { kind: "text"; text: string } | { kind: "link"; id: string; title: string }

/** Whether a link's target is still readable. `missing` is the absence of a target. */
export type LinkStatus = "ok" | "trash" | "missing"
/** Targets the reader knows about; an id that is absent is `missing`. */
export type LinkTargets = Record<string, "ok" | "trash">

/** Note text as lines of segments. One line is one paragraph; a blank line is an empty one. */
export function parse(text: string): Segment[][] {
	return text.split("\n").map(parseLine)
}

function parseLine(line: string): Segment[] {
	const segments: Segment[] = []
	let at = 0
	LINK.lastIndex = 0
	for (const m of line.matchAll(LINK)) {
		const start = m.index
		if (start > at) segments.push({ kind: "text", text: line.slice(at, start) })
		segments.push({ kind: "link", id: m[2] as string, title: m[1] as string })
		at = start + m[0].length
	}
	if (at < line.length) segments.push({ kind: "text", text: line.slice(at) })
	return segments
}

/** The inverse of `parse`: `serialize(parse(t)) === t` for any `t` without carriage returns. */
export function serialize(lines: Segment[][]): string {
	return lines.map((line) => line.map(segmentText).join("")).join("\n")
}

function segmentText(s: Segment): string {
	return s.kind === "text" ? s.text : `[${s.title}](/read/${s.id})`
}

/** Every target linked from the text, first mention first, without repeats. */
export function extractLinkIds(text: string): string[] {
	const ids = new Set<string>()
	LINK.lastIndex = 0
	for (const m of text.matchAll(LINK)) ids.add(m[2] as string)
	return [...ids]
}

/**
 * Links written with the app's full reader URL (`[Title](https://…/read/<id>)`), the way tools
 * outside the app show them, as note links. Links to other origins stay as they are.
 */
export function internalizeReaderLinks(text: string, origin: string): string {
	const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const full = new RegExp(`\\]\\(${escaped}/read/(${UUID})\\)`, "gi")
	return text.replace(full, (_whole, id: string) => `](/read/${id.toLowerCase()})`)
}

/**
 * Point every link at a file instead of the app, for the export zip. A target `resolve` does not
 * know (trashed, or gone) loses its link and keeps its text.
 */
export function rewriteNoteLinks(text: string, resolve: (id: string) => string | null): string {
	LINK.lastIndex = 0
	return text.replace(LINK, (_whole, title: string, id: string) => {
		const path = resolve(id)
		return path ? `[${title}](${path})` : title
	})
}
