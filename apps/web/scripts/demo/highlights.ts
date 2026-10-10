import { canonicalText, walkTextNodes } from "@klipstack/anchor"
import { JSDOM } from "jsdom"
import { articlePlan, fraction } from "./profile"

interface Passage {
	start: number
	end: number
	exact: string
}
export interface PlannedHighlight extends Passage {
	color: number
	note: string | null
	createdAt: Date
}

/** Map paragraph sentences into the reader's coordinate space, including inline markup. */
export function highlightCandidates(html: string, text: string): Passage[] {
	const dom = new JSDOM(`<body>${html}</body>`)
	try {
		const body = dom.window.document.body
		if (canonicalText(body) !== text)
			throw new Error("Highlight source differs from canonical text")
		const blocks: Array<{ element: Element; start: number; end: number }> = []
		let offset = 0
		walkTextNodes(body, (node) => {
			const start = offset
			offset += node.data.length
			if (
				node.parentElement?.closest("h1,h2,h3,h4,h5,h6,pre,code,nav,header,footer,aside,figcaption")
			)
				return
			const element = node.parentElement?.closest("p,li,blockquote,td,div")
			if (!element) return
			const previous = blocks.at(-1)
			if (previous?.element === element && previous.end === start) previous.end = offset
			else blocks.push({ element, start, end: offset })
		})
		const segmenter = new Intl.Segmenter("en", { granularity: "sentence" })
		const passages: Passage[] = []
		for (const block of blocks) {
			const content = text.slice(block.start, block.end)
			const linked = Array.from(block.element.querySelectorAll("a")).reduce(
				(n, el) => n + canonicalText(el).length,
				0,
			)
			if (linked > content.length / 2) continue
			const sentences = Array.from(segmenter.segment(content), ({ segment, index }) => {
				const start = block.start + index + segment.length - segment.trimStart().length
				const end = block.start + index + segment.trimEnd().length
				return { start, end, exact: text.slice(start, end) }
			}).filter(
				(sentence) =>
					sentence.exact.length >= 40 &&
					sentence.exact.length <= 420 &&
					/[.!?][”’"')\]]?$/.test(sentence.exact),
			)
			for (const [i, sentence] of sentences.entries()) {
				passages.push(sentence)
				const next = sentences[i + 1]
				// A longer passage always stays inside one paragraph, with no omitted sentence in between.
				if (
					next &&
					/^\s*$/.test(text.slice(sentence.end, next.start)) &&
					next.end - sentence.start <= 600
				)
					passages.push({
						start: sentence.start,
						end: next.end,
						exact: text.slice(sentence.start, next.end),
					})
			}
		}
		return passages
	} finally {
		dom.window.close()
	}
}

/** Seeded selection: varied density and lengths, no overlaps or duplicate quotes, within read progress. */
export function planHighlights({
	html,
	text,
	url,
	title,
	wordCount,
	seed,
	date,
}: {
	html: string
	text: string
	url: string
	title: string
	wordCount: number
	seed: string
	date: string
}): PlannedHighlight[] {
	const plan = articlePlan(url, title, seed, date)
	if (plan.state === "unread" || plan.state === "trash") return []
	const readEnd = Math.floor(text.length * plan.dates.readingProgress)
	const candidates = highlightCandidates(html, text).filter((passage) => passage.end <= readEnd)
	if (!candidates.length) return []
	const target =
		plan.state === "finished"
			? 4 +
				Math.floor(fraction(seed, url, "highlight-count") * 5) +
				Math.min(6, Math.floor(wordCount / 1800))
			: 1 + Math.floor(fraction(seed, url, "highlight-count") * 4)
	// Keep short articles readable; long reads can have more highlights without becoming a wall of color.
	const budget = Math.max(140, Math.floor(readEnd * 0.18))
	const chosen: Array<Passage & { note: string | null }> = []
	const curated = plan.hint
		? candidates.find((passage) => plan.hint!.test(passage.exact))
		: undefined
	if (curated) chosen.push({ ...curated, note: plan.highlightNote })
	const ranked = candidates
		.map((passage) => ({
			passage,
			rank: fraction(seed, url, `highlight:${passage.start}:${passage.end}`),
		}))
		.sort((a, b) => a.rank - b.rank || a.passage.start - b.passage.start)
	let characters = curated?.exact.length ?? 0
	for (const { passage } of ranked) {
		if (chosen.length >= target) break
		if (characters + passage.exact.length > budget) continue
		if (
			chosen.some(
				(other) =>
					other.exact === passage.exact || (passage.start < other.end && passage.end > other.start),
			)
		)
			continue
		chosen.push({ ...passage, note: null })
		characters += passage.exact.length
	}
	return chosen
		.sort((a, b) => a.start - b.start)
		.map((passage) => ({
			...passage,
			color: Math.floor(fraction(seed, url, `highlight-color:${passage.start}`) * 4),
			createdAt: new Date(
				+plan.dates.firstOpenedAt! +
					Math.round(
						((+plan.dates.lastReadAt! - +plan.dates.firstOpenedAt!) * passage.end) / readEnd,
					),
			),
		}))
}
