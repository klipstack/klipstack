import { describe, expect, it } from "vitest"
import type { AiThreadWithMessages } from "~/lib/ai-threads"
import { type AiCard, createAnswerStore, reloaded, withQuestion } from "./use-ai-threads"

const thread = (id: string, answers = 1): AiThreadWithMessages => ({
	id,
	action: "define",
	start: 0,
	end: 8,
	exact: "schedule",
	versionId: "v1",
	highlightId: null,
	orphaned: false,
	createdAt: "2026-10-09T00:00:00.000Z",
	messages: Array.from({ length: answers }, (_, i) => ({
		id: `${id}-m${i}`,
		role: "assistant" as const,
		text: `Answer ${i + 1}.`,
		status: "done" as const,
		citations: [],
		createdAt: "2026-10-09T00:00:00.000Z",
	})),
})
const none = new Set<string>()
const ids = (cards: AiCard[]) => cards.map((c) => c.id)

describe("reloaded", () => {
	it("keeps a thread asked on this page that a load which began earlier doesn't have", () => {
		const cards = [thread("a"), thread("b")]
		expect(ids(reloaded(cards, [thread("a")], new Set(["b"]), none))).toEqual(["a", "b"])
	})

	it("drops a thread deleted elsewhere", () => {
		expect(ids(reloaded([thread("a"), thread("b")], [thread("a")], none, none))).toEqual(["a"])
	})

	it("keeps cards not sent yet", () => {
		const draft: AiCard = { ...thread("tmp-ai-t-1", 0), draft: { question: "" } }
		expect(ids(reloaded([draft], [thread("a")], none, none))).toEqual(["a", "tmp-ai-t-1"])
	})

	it("takes the answer saved after the stream broke, and drops the failure", () => {
		const broken: AiCard = { ...thread("a", 0), failure: { code: "network" } }
		const [card] = reloaded([broken], [thread("a", 1)], none, none)
		expect(card?.failure).toBeUndefined()
		expect(card?.messages).toHaveLength(1)
	})

	it("keeps a refusal while nothing newer comes", () => {
		const refused: AiCard = { ...thread("a"), failure: { code: "limit_reached" } }
		expect(reloaded([refused], [thread("a")], none, none)[0]?.failure).toEqual({
			code: "limit_reached",
		})
	})

	it("keeps a refused follow-up and its refusal while nothing newer comes", () => {
		const question = { ...thread("a").messages[0]!, id: "tmp-ai-q-9", role: "user" as const }
		const refused: AiCard = {
			...thread("a"),
			messages: [...thread("a").messages, question],
			failure: { code: "rate_limited" },
		}
		const [card] = reloaded([refused], [thread("a")], none, none)
		expect(card?.messages.map((m) => m.id)).toEqual(["a-m0", "tmp-ai-q-9"])
		expect(card?.failure).toEqual({ code: "rate_limited" })
		// The load brings an answer given since (on another device): the refusal is old news.
		const [later] = reloaded([refused], [thread("a", 2)], none, none)
		expect(later?.messages.map((m) => m.id)).toEqual(["a-m0", "a-m1"])
		expect(later?.failure).toBeUndefined()
	})

	it("keeps a card whose answer is being written over the loaded copy", () => {
		const streaming: AiCard = { ...thread("a", 0), streaming: true }
		const [card] = reloaded([streaming], [thread("a", 0)], none, none)
		expect(card?.streaming).toBe(true)
	})

	it("takes the loaded copy of a settled thread, with answers given elsewhere", () => {
		const [card] = reloaded([thread("a")], [thread("a", 2)], none, none)
		expect(card?.messages).toHaveLength(2)
	})

	it("doesn't bring back a thread whose delete is on its way", () => {
		expect(ids(reloaded([], [thread("a")], none, new Set(["a"])))).toEqual([])
	})
})

describe("withQuestion", () => {
	const q = (id: string, text = "Why?") => ({
		...thread("x").messages[0]!,
		id,
		role: "user" as const,
		text,
	})

	it("puts the saved question in place of the temporary one", () => {
		expect(withQuestion([q("a1"), q("tmp-ai-q-3")], q("a2")).map((m) => m.id)).toEqual(["a1", "a2"])
	})

	it("keeps one copy of a retried question, without the answer it replaces", () => {
		const answer = { ...q("b2"), role: "assistant" as const }
		expect(withQuestion([q("a1"), q("a2"), answer], q("a2")).map((m) => m.id)).toEqual(["a1", "a2"])
	})
})

describe("createAnswerStore", () => {
	it("gathers an answer's words and citations, and tells who listens", () => {
		const store = createAnswerStore()
		let heard = 0
		store.subscribe(() => heard++)
		store.write("a", "One ")
		store.write("a", "two.")
		store.cite("a", { start: 0, end: 3, exact: "One", at: 4 })
		expect(store.get("a")).toEqual({
			text: "One two.",
			citations: [{ start: 0, end: 3, exact: "One", at: 4 }],
		})
		store.clear("a")
		store.clear("a")
		expect(store.get("a")).toBeUndefined()
		expect(heard).toBe(4)
	})
})
