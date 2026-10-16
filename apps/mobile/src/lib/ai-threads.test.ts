import type { AiMessage } from "@klipstack/sdk"
import { describe, expect, it } from "vitest"
import {
	type AiCard,
	afterRefusal,
	cardState,
	createAnswerStore,
	tempId,
	tempQuestion,
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
	it("drops the question not taken, keeping the turns before it", () => {
		const after = afterRefusal(
			card({ id: "t1", streaming: true, messages: [message("q1", "user"), tempQuestion("more?")] }),
			{ code: "limit_reached" },
		)
		expect(after.messages.map((m) => m.id)).toEqual(["q1"])
		expect(after.streaming).toBeUndefined()
		expect(after.failure).toEqual({ code: "limit_reached" })
	})

	it("keeps a new chat's question: Try Again sends it", () => {
		const question = tempQuestion("What is it about?")
		const after = afterRefusal(card({ id: tempId("t"), action: "chat", messages: [question] }), {
			code: "network",
		})
		expect(after.messages).toEqual([question])
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
