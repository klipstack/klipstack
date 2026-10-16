import { AiAnswerEvent } from "@klipstack/api-contract"
import { db, documents, documentVersions, eq, userFeatures } from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import type { KlipstackApiError } from "@klipstack/sdk"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// The fake model, as on a server with a provider set up.
vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})

const { env } = await import("~/lib/env.server")
const { askAboutPassage } = await import("~/commands/ai.server")
const { apiUsers, captured, FIXTURES, request } = await import("~/test/api-harness")

/** The reader's AI through /api/v1, through the SDK as the iPhone app calls it. */

const users = apiUsers("api-ai")
afterAll(async () => {
	await users.cleanup()
	await stopBoss()
})

const errorOf = (promise: Promise<unknown>) =>
	promise.then(
		() => {
			throw new Error("expected the call to fail")
		},
		(e: unknown) => e as KlipstackApiError,
	)

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = []
	for await (const event of events) out.push(event)
	return out
}

type Me = Awaited<ReturnType<typeof users.create>>
let me: Me
let articleId: string
/** A passage of the article, as the reader selects it: its place in the text and its words. */
let passage: { exact: string; start: number; end: number }

beforeAll(async () => {
	me = await users.create("Asker")
	await db.insert(userFeatures).values({ userId: me.id, feature: "ai" })
	articleId = await captured(me.id, FIXTURES.makers)
	const [row] = await db
		.select({ text: documentVersions.text })
		.from(documents)
		.innerJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
		.where(eq(documents.id, articleId))
	const exact = "manager's schedule"
	const start = row!.text.toLowerCase().indexOf(exact)
	passage = {
		exact: row!.text.slice(start, start + exact.length),
		start,
		end: start + exact.length,
	}
})

describe("the reader's AI in the API", () => {
	it("says whether the account can ask, and where it stands against its cap", async () => {
		const off = await users.create("No AI")
		expect(await off.client.ai.status()).toEqual({ enabled: false, allowance: null })
		const theirs = await captured(off.id, FIXTURES.joel)
		const error = await errorOf(
			off.client.ai.ask(theirs, { action: "explain", exact: "Joel", start: 0, end: 4 }),
		)
		expect([error.status, error.code]).toEqual([403, "forbidden"])
		expect((await errorOf(off.client.ai.article(theirs))).code).toBe("forbidden")
		const { enabled, allowance } = await me.client.ai.status()
		expect(enabled).toBe(true)
		expect(allowance).toMatchObject({ max: env.LIMIT_AI_PER_MONTH })
		expect(Date.parse(allowance!.resetsAt)).toBeGreaterThan(Date.now())
	})

	it("streams a cited answer about a passage, keeps it, and counts it", async () => {
		const before = (await me.client.ai.status()).allowance!.used
		const events = await collect(
			await me.client.ai.ask(articleId, { action: "explain", ...passage }),
		)
		const [start, ...rest] = events
		if (start?.type !== "start") throw new Error("no start event")
		expect(start.thread).toMatchObject({ action: "explain", exact: passage.exact })
		expect(start.thread.start).toBe(passage.start)
		expect(start.allowance.used).toBe(before + 1)
		const answer = rest.at(-1)
		if (answer?.type !== "answer") throw new Error("no answer event")
		expect(answer.message).toMatchObject({ role: "assistant", status: "done" })
		// What streamed is what was kept.
		const streamed = rest.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("")
		expect(streamed).toBe(answer.message.text)
		expect(answer.message.citations.length).toBeGreaterThan(0)
		expect(rest.filter((e) => e.type === "citation")).toHaveLength(answer.message.citations.length)
		expect((await me.client.ai.status()).allowance!.used).toBe(before + 1)
		const { threads } = await me.client.ai.article(articleId)
		const kept = threads.find((t) => t.id === start.thread.id)
		expect(kept?.messages.map((m) => m.role)).toEqual(["user", "assistant"])
		expect(kept?.messages[1]?.text).toBe(answer.message.text)
	})

	it("follows up, answers again in place, deletes and restores", async () => {
		const [start] = await collect(
			await me.client.ai.ask(articleId, {
				action: "ask",
				...passage,
				question: "Who keeps it?",
			}),
		)
		if (start?.type !== "start") throw new Error("no start event")
		const id = start.thread.id
		await collect(await me.client.ai.followUp(id, "Why does it matter?"))
		const thread = async () =>
			(await me.client.ai.article(articleId)).threads.find((t) => t.id === id)
		expect((await thread())?.messages.map((m) => m.text.slice(0, 20))).toHaveLength(4)
		const lastAnswer = (await thread())!.messages[3]!.id
		const used = (await me.client.ai.status()).allowance!.used
		const retried = await collect(await me.client.ai.retry(id))
		const answer = retried.at(-1)
		if (answer?.type !== "answer") throw new Error("no answer event")
		// In place: still four turns, the last one new. And counted.
		const after = (await thread())!.messages
		expect(after).toHaveLength(4)
		expect(after[3]!.id).toBe(answer.message.id)
		expect(after[3]!.id).not.toBe(lastAnswer)
		expect((await me.client.ai.status()).allowance!.used).toBe(used + 1)

		await me.client.ai.delete(id)
		expect(await thread()).toBeUndefined()
		const { thread: back } = await me.client.ai.restore(id)
		expect(back).toMatchObject({ id, action: "ask" })
		expect(back.messages).toHaveLength(4)
		expect(await thread()).toBeDefined()
	})

	it("keeps one chat per article", async () => {
		const first = await collect(await me.client.ai.chat(articleId, "What is it about?"))
		const second = await collect(await me.client.ai.chat(articleId, "And the makers?"))
		if (first[0]?.type !== "start" || second[0]?.type !== "start") throw new Error("no start event")
		expect(first[0].thread.action).toBe("chat")
		expect(second[0].thread.id).toBe(first[0].thread.id)
		const chats = (await me.client.ai.article(articleId)).threads.filter((t) => t.action === "chat")
		expect(chats).toHaveLength(1)
		expect(chats[0]!.messages).toHaveLength(4)
	})

	it("writes the brief once: again, it is only the kept brief, at no cost", async () => {
		const first = await collect(await me.client.ai.brief(articleId))
		expect(first[0]?.type).toBe("allowance")
		const brief = first.at(-1)
		if (brief?.type !== "brief" || !brief.brief) throw new Error("no brief")
		expect(brief.brief.text).toContain("## ")
		const used = (await me.client.ai.status()).allowance!.used
		expect(await collect(await me.client.ai.brief(articleId))).toEqual([brief])
		expect((await me.client.ai.status()).allowance!.used).toBe(used)
		expect((await me.client.ai.article(articleId)).brief).toEqual(brief.brief)
	})

	it("counts the web reader's questions and the API's against one cap", async () => {
		const used = (await me.client.ai.status()).allowance!.used
		// As the web reader asks (`routes/documents.ai.ts`).
		const asked = await askAboutPassage(
			me.id,
			articleId,
			{ action: "define", ...passage },
			{ language: "en" },
		)
		for await (const _ of asked.events);
		await asked.answer
		expect((await me.client.ai.status()).allowance!.used).toBe(used + 1)
		const max = env.LIMIT_AI_PER_MONTH
		env.LIMIT_AI_PER_MONTH = used + 1
		try {
			const error = await errorOf(me.client.ai.ask(articleId, { action: "explain", ...passage }))
			expect([error.status, error.code]).toEqual([403, "limit_reached"])
			expect(error.details).toMatchObject({ limit: "ai", max: used + 1 })
			const brief = await errorOf(me.client.ai.chat(articleId, "One more?"))
			expect(brief.code).toBe("limit_reached")
		} finally {
			env.LIMIT_AI_PER_MONTH = max
		}
	})

	it("finishes and keeps an answer when the client goes away", async () => {
		const gone = new AbortController()
		const response = await request(`/api/v1/articles/${articleId}/ai/threads`, {
			method: "POST",
			token: me.key,
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "ask", ...passage, question: "Left early?" }),
			signal: gone.signal,
		})
		const reader = response.body!.getReader()
		const first = new TextDecoder().decode((await reader.read()).value)
		const id = (JSON.parse(first.slice(6)) as { thread: { id: string } }).thread.id
		// The phone lost its connection: the request is gone.
		gone.abort()
		await reader.cancel().catch(() => {})
		let last: string | undefined
		for (let i = 0; i < 50 && !last; i++) {
			const thread = (await me.client.ai.article(articleId)).threads.find((t) => t.id === id)
			last = thread?.messages[1]?.status
			if (!last) await new Promise((resolve) => setTimeout(resolve, 20))
		}
		expect(last).toBe("done")
	})

	it("refuses another account's article and threads", async () => {
		const other = await users.create("Other")
		await db.insert(userFeatures).values({ userId: other.id, feature: "ai" })
		expect((await errorOf(other.client.ai.article(articleId))).code).toBe("not_found")
		expect(
			(await errorOf(other.client.ai.ask(articleId, { action: "explain", ...passage }))).code,
		).toBe("not_found")
		const { threads } = await me.client.ai.article(articleId)
		expect((await errorOf(other.client.ai.followUp(threads[0]!.id, "Mine?"))).code).toBe(
			"not_found",
		)
		expect((await errorOf(other.client.ai.delete(threads[0]!.id))).code).toBe("not_found")
	})

	it("sends events as server-sent events the contract describes", async () => {
		const response = await request(`/api/v1/articles/${articleId}/ai/threads`, {
			method: "POST",
			token: me.key,
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "define", ...passage }),
		})
		expect(response.status).toBe(200)
		expect(response.headers.get("content-type")).toContain("text/event-stream")
		expect(response.headers.get("cache-control")).toContain("no-transform")
		const lines = (await response.text()).split("\n\n").filter(Boolean)
		for (const line of lines) {
			expect(line.startsWith("data: ")).toBe(true)
			expect(AiAnswerEvent.safeParse(JSON.parse(line.slice(6))).success).toBe(true)
		}
	})
})
