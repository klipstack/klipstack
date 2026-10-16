import { describe, expect, it } from "vitest"
import { citationReader } from "./markers"
import type { AnswerEvent } from "./types"

const text =
	"Makers need long\n\tblocks of time. Managers work in slots. Meetings cost makers more. So they clash."
const sentence = (exact: string) => ({
	start: text.indexOf(exact),
	end: text.indexOf(exact) + exact.length,
	exact,
})

/** The answer as the reader gets it: its text, and each citation where it sits. */
function read(deltas: string[]) {
	const reader = citationReader(text)
	const events: AnswerEvent[] = []
	for (const delta of deltas) events.push(...reader.push(delta))
	events.push(...reader.end())
	let answer = ""
	const citations = []
	for (const e of events)
		if (e.type === "text") answer += e.text
		else citations.push(e.citation)
	return { answer, citations }
}

describe("citationReader", () => {
	it("takes a marker and the space before it out, citing its sentence after the words", () => {
		expect(read(["Makers lose whole afternoons [3]. Managers don't [2]."])).toEqual({
			answer: "Makers lose whole afternoons. Managers don't.",
			citations: [
				{ ...sentence("Meetings cost makers more."), at: "Makers lose whole afternoons".length },
				{
					...sentence("Managers work in slots."),
					at: "Makers lose whole afternoons. Managers don't".length,
				},
			],
		})
	})

	it("cites a sentence by its range in the text, line breaks and all", () => {
		expect(read(["Time matters [1]."]).citations).toEqual([
			{ ...sentence("Makers need long\n\tblocks of time."), at: "Time matters".length },
		])
	})

	it("reads the same answer however the stream is cut", () => {
		const whole = "- Slots [2][3], not blocks [1, 4].\n- Clash [4] [2-3]"
		const expected = read([whole])
		expect(expected.answer).toBe("- Slots, not blocks.\n- Clash")
		const chars = read([...whole])
		expect(chars).toEqual(expected)
		for (let cut = 1; cut < whole.length; cut++)
			expect(read([whole.slice(0, cut), whole.slice(cut)])).toEqual(expected)
	})

	it("cites neighbouring sentences as one passage, and others apart", () => {
		const { citations } = read(["Slots [3][2], blocks [1, 4], all [1-3]."])
		expect(citations.map(({ exact }) => exact)).toEqual([
			"Managers work in slots. Meetings cost makers more.",
			"Makers need long\n\tblocks of time.",
			"So they clash.",
			"Makers need long\n\tblocks of time. Managers work in slots. Meetings cost makers more.",
		])
	})

	it("drops numbers the article doesn't have, other brackets as written, and a cut marker", () => {
		expect(read(["Slots [9][0][3-1][2], as [sic] and [a] say [1"])).toEqual({
			answer: "Slots, as [sic] and [a] say",
			citations: [{ ...sentence("Managers work in slots."), at: "Slots".length }],
		})
	})

	it("cites a passage once where the answer repeats its marker in one place", () => {
		expect(read(["Slots [2] [2]."]).citations).toHaveLength(1)
	})

	// The model's output is untrusted: a page it read may tell it what to write.
	it("reads output that only looks like markers in linear time", () => {
		const started = performance.now()
		const looks = Array.from({ length: 2000 }, () => "[ ")
		expect(read([...looks, "x"]).answer).toBe(`${looks.join("")}x`)
		expect(read(["[1".repeat(20_000), "x"]).citations).toHaveLength(0)
		expect(performance.now() - started).toBeLessThan(1000)
	})

	it("keeps a citation to ten sentences, and an answer to fifty citations", () => {
		const long = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} is here.`).join(" ")
		const reader = citationReader(long)
		const events = [
			...reader.push("All [1-30]. "),
			...reader.push("x[3][5]".repeat(40)),
			...reader.end(),
		]
		const citations = events.flatMap((e) => (e.type === "citation" ? [e.citation] : []))
		expect(citations[0]!.exact).toBe(long.slice(0, long.indexOf(" Sentence 11")))
		expect(citations).toHaveLength(50)
	})
})
