import { QUOTE_MAX } from "@klipstack/api-contract/names"

export type Endpoint = "start" | "end"
export type Offsets = { start: number; end: number }

/** Where words start and end in the text: the places a highlight's ends snap to under a finger. */
export function wordEdges(text: string): { starts: number[]; ends: number[] } {
	const starts: number[] = []
	const ends: number[] = []
	for (const part of new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)) {
		if (!part.isWordLike) continue
		starts.push(part.index)
		ends.push(part.index + part.segment.length)
	}
	return { starts, ends }
}

/**
 * The highlight with one end moved to the word edge nearest `at` (an offset into the text): the
 * start to a word's start, the end to a word's end. It keeps at least one word, and at most
 * QUOTE_MAX characters; `draft` when nothing changes.
 */
export function moveEnd(
	edges: { starts: number[]; ends: number[] },
	draft: Offsets,
	endpoint: Endpoint,
	at: number,
): Offsets {
	const candidates =
		endpoint === "start"
			? edges.starts.filter((s) => s < draft.end && draft.end - s <= QUOTE_MAX)
			: edges.ends.filter((e) => e > draft.start && e - draft.start <= QUOTE_MAX)
	let best: number | null = null
	for (const edge of candidates)
		if (best === null || Math.abs(edge - at) < Math.abs(best - at)) best = edge
	if (best === null || best === draft[endpoint]) return draft
	const next = { ...draft, [endpoint]: best }
	return next.start < next.end ? next : draft
}
