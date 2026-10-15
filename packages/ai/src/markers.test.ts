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

	it("drops a number the article doesn't have, and leaves other brackets as written", () => {
		expect(read(["Slots [9][2], as [sic] and [a] say [1"])).toEqual({
			answer: "Slots, as [sic] and [a] say [1",
			citations: [{ ...sentence("Managers work in slots."), at: "Slots".length }],
		})
	})

	it("cites a passage once where the answer repeats its marker in one place", () => {
		expect(read(["Slots [2] [2]."]).citations).toHaveLength(1)
	})
})
