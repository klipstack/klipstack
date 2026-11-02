import { KlipstackApiError } from "@klipstack/sdk"
import { describe, expect, it } from "vitest"
import {
	afterFailure,
	allowanceMessage,
	failureMessage,
	failureOf,
	NOTHING_WRITTEN,
	questionsLeft,
	written,
} from "./ai"
import {
	answerBlocks,
	answerLead,
	briefHeading,
	briefSummary,
	plainAnswer,
	siteOf,
	webLink,
} from "./ai-answer"

const NOW = Date.parse("2026-10-16T12:00:00Z")
const RESETS = "2026-11-01T00:00:00.000Z"
const allowance = (used: number, max = 100) => ({ used, max, resetsAt: RESETS })

describe("questions left", () => {
	it("says so only when a fifth or fewer are left, and why none can be asked", () => {
		expect(allowanceMessage(allowance(79), NOW)).toBeNull()
		expect(allowanceMessage(allowance(80), NOW)).toBe("20 questions left this month")
		expect(allowanceMessage(allowance(99), NOW)).toBe("1 question left this month")
		expect(allowanceMessage(allowance(100), NOW)).toBe(
			"You've asked as many questions as this month allows. It starts over on November 1.",
		)
		expect(questionsLeft(allowance(120), NOW)).toEqual({ left: 0, few: false, none: true })
	})

	it("stops counting once the month it counted is over", () => {
		expect(questionsLeft(allowance(100), Date.parse(RESETS))).toMatchObject({ none: false })
		expect(questionsLeft(null, NOW).none).toBe(false)
	})

	it("is at the cap after a refusal for it, with the server's numbers", () => {
		const refused = new KlipstackApiError(403, "limit_reached", "At the cap", {
			details: { limit: "ai", max: 50, resetsAt: "2026-12-01T00:00:00.000Z" },
		})
		expect(afterFailure(allowance(10), failureOf(refused))).toEqual({
			used: 50,
			max: 50,
			resetsAt: "2026-12-01T00:00:00.000Z",
		})
		expect(afterFailure(allowance(10), { code: "rate_limited" })).toEqual(allowance(10))
		expect(failureMessage(failureOf(refused), null)).toContain("starts over on December 1.")
	})

	it("names a lost connection, and says something for codes it doesn't know", () => {
		expect(failureOf(new TypeError("Network request failed"))).toEqual({ code: "network" })
		expect(failureMessage({ code: "network" }, null)).toContain("couldn't be reached")
		expect(failureMessage({ code: "too_large" }, null)).toBe(
			"This article is too long to ask about.",
		)
		expect(failureMessage({ code: "teapot" }, null)).toBe("Couldn't answer. Try again.")
	})

	it("says a fact check's cap is reached, not the questions'", () => {
		const refused = new KlipstackApiError(403, "limit_reached", "At the cap", {
			details: { limit: "factChecks", max: 20, resetsAt: "2026-12-01T00:00:00.000Z" },
		})
		expect(failureMessage(failureOf(refused), allowance(10))).toBe(
			"You've used this month's fact checks. They start over on December 1.",
		)
		expect(failureMessage({ code: "limit_reached", details: { limit: "factChecks" } }, null)).toBe(
			"You've used this month's fact checks. They start over on the 1st.",
		)
	})
})

describe("an answer as it is written", () => {
	it("adds text, citations, and a fact check's searches and sources in order", () => {
		const cite = { start: 4, end: 9, exact: "words", at: 5 }
		const source = { url: "https://example.org/", title: null, at: 11 }
		let so = written(NOTHING_WRITTEN, { type: "search", query: "who said hello" })
		so = written(so, { type: "text", text: "Hello" })
		so = written(so, { type: "citation", citation: cite })
		so = written(so, { type: "search", query: "hello world origin" })
		so = written(so, { type: "text", text: " world" })
		so = written(so, { type: "source", source })
		expect(so).toEqual({
			text: "Hello world",
			citations: [cite],
			searches: ["who said hello", "hello world origin"],
			sources: [source],
		})
	})
})

describe("answerBlocks", () => {
	const cite = (at: number) => ({ start: 0, end: 1, exact: "x", at })

	it("puts each citation after the words it supports, inside bold too", () => {
		const text = "**Makers need time.** Meetings cost them."
		const blocks = answerBlocks(text, [cite(18), cite(text.length)])
		expect(blocks).toEqual([
			{
				kind: "p",
				key: "0:0",
				runs: [
					{ kind: "text", text: "Makers need time", bold: true },
					{ kind: "cite", n: 0 },
					{ kind: "text", text: ".", bold: true },
					{ kind: "text", text: " Meetings cost them." },
					{ kind: "cite", n: 1 },
				],
			},
		])
	})

	it("puts each web source after its words, after an article's citation at the same place", () => {
		const text = "**Partly.** He wrote it. Then more."
		const source = (at: number, url = "https://www.example.org/a") => ({ url, title: null, at })
		const blocks = answerBlocks(text, [cite(24)], [source(24), source(text.length, "ftp://x")])
		expect(blocks).toEqual([
			{
				kind: "p",
				key: "0:0",
				runs: [
					{ kind: "text", text: "Partly.", bold: true },
					{ kind: "text", text: " He wrote it." },
					{ kind: "cite", n: 0 },
					{ kind: "source", n: 0 },
					{ kind: "text", text: " Then more." },
					{ kind: "source", n: 1 },
				],
			},
		])
		expect(siteOf("https://www.example.org/a")).toBe("example.org")
		expect(siteOf("not a url")).toBe("not a url")
		expect(webLink("https://example.org/a")).toBe(true)
		expect(webLink("javascript:alert(1)")).toBe(false)
	})

	it("reads headings, bullets and numbered lists, and a numbered list broken up goes on", () => {
		const text =
			"Gist *here*.\n## Key claims\n1. One\n2. Two\n\n3. Three\n## Parts\n- **A**: the start"
		const blocks = answerBlocks(text, [])
		expect(blocks.map((b) => b.kind)).toEqual(["p", "heading", "ol", "ol", "heading", "ul"])
		expect(blocks[1]).toMatchObject({ text: "Key claims" })
		expect(blocks[2]).toMatchObject({ start: 1, items: [[{ text: "One" }], [{ text: "Two" }]] })
		expect(blocks[3]).toMatchObject({ start: 3 })
		expect(blocks[0]).toMatchObject({
			runs: [{ text: "Gist " }, { text: "here", italic: true }, { text: "." }],
		})
		expect(blocks[5]).toMatchObject({
			items: [[{ text: "A", bold: true }, { text: ": the start" }]],
		})
	})

	it("keeps a block's key while the answer grows", () => {
		const first = answerBlocks("One.\n\nTwo", [])
		const later = answerBlocks("One.\n\nTwo more.\n\nThree", [])
		expect(later.slice(0, 2).map((b) => b.key)).toEqual(first.map((b) => b.key))
	})
})

describe("answer text", () => {
	it("copies without Markdown, and leads with its bold sentence", () => {
		expect(plainAnswer("**Bold** and *it*")).toBe("Bold and it")
		expect(answerLead("**It is short.** More here.")).toBe("It is short.")
		expect(answerLead("No bold here. Second.")).toBe("No bold here.")
	})

	it("names a brief's sections and sums it up in its gist", () => {
		expect(briefHeading("key claims:")).toBe("Key claims")
		expect(briefHeading("Something else")).toBe("Something else")
		expect(briefSummary("The gist.\n## Key claims\n1. One")).toBe("The gist.")
		expect(briefSummary("- One\n- Two")).toBe("One Two")
	})
})
