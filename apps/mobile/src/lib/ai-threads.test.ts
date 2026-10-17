import type { AiMessage } from "@klipstack/sdk"
import { describe, expect, it } from "vitest"
import {
	type AiCard,
	afterRefusal,
	askCard,
	cardState,
	chosen,
	createAnswerStore,
	followingUp,
	passageOf,
	retryOf,
	tempId,
	tempQuestion,
	unasked,
	withQuestion,
} from "./ai-threads"

const message = (id: string, role: AiMessage["role"], text = id): AiMessage => ({
	id,
	role,
	text,
	status: "done",
	citations: [],
	createdAt: "2026-10-01T00:00:00.000Z",
})

const card = (more: Partial<AiCard>): AiCard => ({
	id: "t1",
	action: "explain",
	start: 0,
	end: 5,
	exact: "Alpha",
	versionId: "v1",
	highlightId: null,
	orphaned: false,
	createdAt: "2026-10-01T00:00:00.000Z",
	messages: [],
	...more,
})

describe("withQuestion", () => {
	it("puts the saved question in place of the temporary one", () => {
		const temp = tempQuestion("why?")
		const saved = message("q2", "user", "why?")
		const before = [message("q1", "user"), message("a1", "assistant"), temp]
		expect(withQuestion(before, saved).map((m) => m.id)).toEqual(["q1", "a1", "q2"])
	})

	it("on a retry, drops the answers after the question asked again", () => {
		const q1 = message("q1", "user")
		const before = [
			q1,
			message("a1", "assistant"),
			message("q2", "user"),
			message("a2", "assistant"),
		]
		expect(withQuestion(before, q1).map((m) => m.id)).toEqual(["q1"])
	})
})

describe("afterRefusal", () => {
	it("keeps a follow-up refused before it began, after the turns before it", () => {
		const more = tempQuestion("more?")
		const after = afterRefusal(
			card({
				id: "t1",
				streaming: true,
				messages: [message("q1", "user"), message("a1", "assistant"), more],
			}),
			{ code: "limit_reached" },
		)
		expect(after.messages.map((m) => m.id)).toEqual(["q1", "a1", more.id])
		expect(after.messages.at(-1)?.text).toBe("more?")
		expect(after.streaming).toBeUndefined()
		expect(after.failure).toEqual({ code: "limit_reached" })
	})

	it("drops a follow-up cut off by the network: the server may have it", () => {
		const after = afterRefusal(
			card({ streaming: true, messages: [message("q1", "user"), tempQuestion("more?")] }),
			{ code: "network" },
		)
		expect(after.messages.map((m) => m.id)).toEqual(["q1"])
		expect(retryOf(after)).toEqual({ kind: "retry" })
	})

	it("keeps a new thread's first question: Try Again sends it", () => {
		for (const action of ["chat", "ask"] as const) {
			const question = tempQuestion("What is it about?")
			const after = afterRefusal(card({ id: tempId("t"), action, messages: [question] }), {
				code: "network",
			})
			expect(after.messages).toEqual([question])
		}
	})
})

describe("retryOf", () => {
	const saved = [message("q1", "user", "Why?"), message("a1", "assistant")]

	it("a refused follow-up is asked again, not the question before it", () => {
		const refused = afterRefusal(
			card({ streaming: true, messages: [...saved, tempQuestion("And then?")] }),
			{ code: "rate_limited" },
		)
		expect(retryOf(refused)).toEqual({ kind: "follow-up", question: "And then?" })
	})

	it("a saved thread's last question is answered again by the server", () => {
		expect(retryOf(card({ messages: saved }))).toEqual({ kind: "retry" })
		expect(
			retryOf(card({ messages: [message("q1", "user")], failure: { code: "network" } })),
		).toEqual({ kind: "retry" })
	})

	it("a new thread refused before it began starts again", () => {
		const id = tempId("t")
		const chat = card({ id, action: "chat", messages: [tempQuestion("What is it?")] })
		expect(retryOf(chat)).toEqual({ kind: "first", question: "What is it?" })
		expect(retryOf(card({ id, action: "explain", messages: [tempQuestion("")] }))).toEqual({
			kind: "passage",
		})
	})
})

describe("followingUp", () => {
	it("a follow-up takes the place of one refused before it", () => {
		const refused = tempQuestion("And then?")
		const next = followingUp([message("q1", "user"), message("a1", "assistant"), refused], "So?")
		expect(next.map((m) => m.text)).toEqual(["q1", "a1", "So?"])
		expect(next.at(-1)?.id).not.toBe(refused.id)
	})
})

describe("cardState", () => {
	const answered = card({ messages: [message("q1", "user"), message("a1", "assistant")] })

	it("after an answer: answer again, copy it, follow up", () => {
		const state = cardState(answered, false)
		expect(state).toMatchObject({ busy: false, canRetry: true, canFollowUp: true })
		expect(state.lastAnswer?.id).toBe("a1")
	})

	it("none left this month: neither again nor a follow-up, but the answer to copy", () => {
		const state = cardState(answered, true)
		expect(state).toMatchObject({ canRetry: false, canFollowUp: false })
		expect(state.lastAnswer?.id).toBe("a1")
	})

	it("a question still waiting for its answer takes no other, unless it failed", () => {
		const waiting = card({ messages: [message("q1", "user")] })
		expect(cardState(waiting, false).canFollowUp).toBe(false)
		expect(cardState({ ...waiting, failure: { code: "network" } }, false).canFollowUp).toBe(true)
	})

	it("a passage gone from the text takes no follow-up; its answer can be asked again", () => {
		expect(cardState({ ...answered, orphaned: true }, false)).toMatchObject({
			canRetry: true,
			canFollowUp: false,
		})
	})

	it("while writing, or an Ask not sent, offers nothing", () => {
		expect(cardState({ ...answered, streaming: true }, false)).toMatchObject({
			busy: true,
			canRetry: false,
			canFollowUp: false,
		})
		expect(cardState(card({ draft: { question: "" } }), false)).toMatchObject({
			canRetry: false,
			canFollowUp: false,
		})
	})
})

describe("createAnswerStore", () => {
	it("gathers each thread's answer apart, and tells its listeners", () => {
		const store = createAnswerStore()
		let heard = 0
		const stop = store.subscribe(() => heard++)
		store.write("a", "Hello ")
		store.write("b", "Other")
		store.write("a", "world")
		const citation = { start: 0, end: 5, exact: "Alpha", at: 5 }
		store.cite("a", citation)
		expect(store.get("a")).toEqual({ text: "Hello world", citations: [citation] })
		expect(store.get("b")?.text).toBe("Other")
		store.clear("a")
		expect(store.get("a")).toBeUndefined()
		expect(heard).toBe(5)
		stop()
		store.clear("b")
		expect(heard).toBe(5)
	})
})

describe("askCard", () => {
	const passage = {
		exact: "the cost",
		prefix: "they understand ",
		suffix: ", which I'll call",
		start: 40,
		end: 48,
		versionId: "v1",
	}

	it("sends nothing yet: a draft, asking AI, how still to choose", () => {
		const draft = askCard("tmp-ai-t-1", passage, false)
		expect(draft.draft).toEqual({ question: "" })
		expect(draft.messages).toEqual([])
		expect(draft.streaming).toBeUndefined()
		expect(unasked(draft)).toBe(true)
	})

	it("with none left, says why instead of offering a question or a choice", () => {
		const none = askCard("tmp-ai-t-1", passage, true)
		expect(none.draft).toBeUndefined()
		expect(none.failure).toEqual({ code: "limit_reached" })
		expect(unasked(none)).toBe(true)
	})

	it("an Explain chosen from the draft goes with the text around the passage", () => {
		const explain = chosen(askCard("tmp-ai-t-1", passage, false), "explain")
		expect(explain).toMatchObject({ action: "explain", streaming: true, draft: undefined })
		expect(unasked(explain)).toBe(false)
		expect(passageOf(explain)).toEqual(passage)
	})

	it("a first question refused before it began keeps the text around it for Answer Again", () => {
		const asked = { ...askCard("tmp-ai-t-1", passage, false), draft: undefined }
		const refused = afterRefusal(asked, { code: "network" })
		expect(passageOf(refused)).toMatchObject({ prefix: passage.prefix, suffix: passage.suffix })
	})

	it("asked from a highlight, its questions are tied to the highlight", () => {
		const draft = askCard("tmp-ai-t-1", { ...passage, highlightId: "h1" }, false)
		expect(draft.highlightId).toBe("h1")
		expect(passageOf(chosen(draft, "define")).highlightId).toBe("h1")
	})

	it("a thread loaded from the server has no text around it to send", () => {
		expect(passageOf(card({}))).toMatchObject({ prefix: "", suffix: "" })
	})
})
