import { createHash } from "node:crypto"
import { FAKE_FAIL, FAKE_REFUSE } from "@klipstack/ai"
import {
	aiThreads,
	db,
	documents,
	documentVersions,
	eq,
	user as userTable,
	userFeatures,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})

const { env } = await import("~/lib/env.server")
const { monthOf, usageOf } = await import("~/lib/limits.server")
const { listDocumentThreads } = await import("~/services/ai-threads.server")
const {
	AI_TEXT_MAX,
	askAboutPassage,
	askArticle,
	briefArticle,
	deleteThread,
	followUp,
	restoreThread,
	retryAnswer,
} = await import("./ai.server")

const userId = `test-ai-${Date.now()}`
const otherId = `${userId}-off`
const TEXT =
	"Makers need long blocks of time. Managers work in one hour slots. A meeting costs makers more."
const en = { language: "en" as const }

async function article(text = TEXT, title = "Schedules") {
	const [doc] = await db
		.insert(documents)
		.values({
			userId,
			sourceUrl: `https://example.com/ai/${Math.random()}`,
			urlHash: `${userId}-${Math.random()}`,
			status: "ready",
			title,
		})
		.returning({ id: documents.id })
	await newVersion(doc!.id, text, 1)
	return doc!.id
}

async function newVersion(documentId: string, text: string, version: number) {
	const [row] = await db
		.insert(documentVersions)
		.values({
			documentId,
			version,
			html: `<p>${text}</p>`,
			text,
			textHash: createHash("sha256").update(text).digest("hex"),
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	await db.update(documents).set({ currentVersionId: row!.id }).where(eq(documents.id, documentId))
	return row!.id
}

/** Reads the answer to its end, as the route does. */
async function read(asked: Awaited<ReturnType<typeof askAboutPassage>>) {
	const events = []
	try {
		for await (const event of asked.events) events.push(event)
	} catch {
		// A failed answer ends the stream with its error; `answer` is saved as failed.
	}
	return { events, answer: await asked.answer }
}

const refusal = (promise: Promise<unknown>) =>
	promise.then(
		() => null,
		(error: unknown) => error,
	)

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "Asker", email: `${userId}@example.com` },
		{ id: otherId, name: "No AI", email: `${otherId}@example.com` },
	])
	await db.insert(userFeatures).values({ userId, feature: "ai" })
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
	await db.delete(userTable).where(eq(userTable.id, otherId))
})

describe("askAboutPassage", () => {
	it("streams an answer citing the article, saves it, and counts the question", async () => {
		const id = await article()
		const before = (await usageOf(userId)).ai.used
		const asked = await askAboutPassage(
			userId,
			id,
			{ action: "explain", exact: "one hour slots" },
			en,
		)
		expect(asked.thread).toMatchObject({
			action: "explain",
			exact: "one hour slots",
			documentId: id,
		})
		expect(asked.question).toMatchObject({ role: "user", text: "" })
		const { events, answer } = await read(asked)
		const start = TEXT.indexOf("one hour slots")
		const citation = { start, end: start + "one hour slots".length, exact: "one hour slots" }
		expect(events).toContainEqual({ type: "citation", citation: expect.objectContaining(citation) })
		expect(answer).toMatchObject({
			role: "assistant",
			status: "done",
			text: expect.stringContaining("Answer 1."),
			citations: [expect.objectContaining(citation)],
			model: "fake:fixed",
			inputTokens: 100,
		})
		expect((await usageOf(userId)).ai.used).toBe(before + 1)
		// Where the account stands, for the card's "questions left".
		expect(asked.allowance).toEqual({
			used: before + 1,
			max: env.LIMIT_AI_PER_MONTH,
			resetsAt: monthOf().resetsAt.toISOString(),
		})
	})

	it("takes one word, and needs a question to Ask", async () => {
		const id = await article()
		const asked = await askAboutPassage(userId, id, { action: "define", exact: "Makers" }, en)
		expect((await read(asked)).answer.status).toBe("done")
		expect(
			await refusal(askAboutPassage(userId, id, { action: "ask", exact: "Makers" }, en)),
		).toMatchObject({
			code: "invalid_request",
		})
	})

	it("refuses a passage the article does not have, and accounts without the feature", async () => {
		const id = await article()
		expect(
			await refusal(askAboutPassage(userId, id, { action: "explain", exact: "not in it" }, en)),
		).toMatchObject({ code: "no_match" })
		expect(
			await refusal(askAboutPassage(otherId, id, { action: "explain", exact: "Makers" }, en)),
		).toMatchObject({ code: "not_found" })
		const [doc] = await db
			.insert(documents)
			.values({
				userId: otherId,
				sourceUrl: "https://example.com/x",
				urlHash: `${otherId}-x`,
				status: "ready",
			})
			.returning({ id: documents.id })
		expect(
			await refusal(askAboutPassage(otherId, doc!.id, { action: "explain", exact: "Makers" }, en)),
		).toMatchObject({ code: "forbidden" })
	})

	it("refuses at the monthly cap, before anything is written", async () => {
		const id = await article()
		const max = env.LIMIT_AI_PER_MONTH
		env.LIMIT_AI_PER_MONTH = (await usageOf(userId)).ai.used
		try {
			expect(
				await refusal(askAboutPassage(userId, id, { action: "explain", exact: "Makers" }, en)),
			).toMatchObject({ code: "limit_reached", details: { limit: "ai" } })
			expect(await db.select().from(aiThreads).where(eq(aiThreads.documentId, id))).toEqual([])
		} finally {
			env.LIMIT_AI_PER_MONTH = max
		}
	})
})

describe("what a question costs", () => {
	it("refuses an article too long to send, without counting it", async () => {
		const id = await article(`Makers. ${"word ".repeat(AI_TEXT_MAX / 5)}`)
		const before = (await usageOf(userId)).ai.used
		expect(
			await refusal(askAboutPassage(userId, id, { action: "explain", exact: "Makers" }, en)),
		).toMatchObject({ code: "too_large" })
		expect((await usageOf(userId)).ai.used).toBe(before)
	})

	it("doesn't count a follow-up or a retry whose article went to the trash", async () => {
		const id = await article()
		const asked = await askAboutPassage(userId, id, { action: "explain", exact: "Makers" }, en)
		await read(asked)
		await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, id))
		const before = (await usageOf(userId)).ai.used
		expect(await refusal(followUp(userId, asked.thread.id, "And?", en))).toMatchObject({
			code: "not_found",
		})
		expect(await refusal(retryAnswer(userId, asked.thread.id, en))).toMatchObject({
			code: "not_found",
		})
		expect((await usageOf(userId)).ai.used).toBe(before)
	})

	it("keeps the answer when Retry is refused at the cap", async () => {
		const id = await article()
		const asked = await askAboutPassage(userId, id, { action: "explain", exact: "Makers" }, en)
		await read(asked)
		const max = env.LIMIT_AI_PER_MONTH
		env.LIMIT_AI_PER_MONTH = (await usageOf(userId)).ai.used
		try {
			expect(await refusal(retryAnswer(userId, asked.thread.id, en))).toMatchObject({
				code: "limit_reached",
			})
		} finally {
			env.LIMIT_AI_PER_MONTH = max
		}
		const [thread] = await listDocumentThreads(userId, id, null)
		expect(thread!.messages.map((m) => m.role)).toEqual(["user", "assistant"])
	})
})

describe("follow-ups, retries and refusals", () => {
	it("answers a follow-up with the whole thread, and the thread comes back with both", async () => {
		const id = await article()
		const first = await askAboutPassage(userId, id, { action: "explain", exact: "Makers" }, en)
		await read(first)
		const second = await read(await followUp(userId, first.thread.id, "And managers?", en))
		expect(second.answer.text).toContain("Answer 2.")
		const [thread] = await listDocumentThreads(userId, id, null)
		expect(thread!.messages.map((m) => [m.role, m.text.slice(0, 13)])).toEqual([
			["user", ""],
			["assistant", "**A fixed ans"],
			["user", "And managers?"],
			["assistant", "**A fixed ans"],
		])
	})

	it("saves a failed answer, and Retry answers again in its place", async () => {
		const id = await article()
		const asked = await askAboutPassage(
			userId,
			id,
			{ action: "ask", exact: "Makers", question: `Why? ${FAKE_FAIL}` },
			en,
		)
		const failed = await read(asked)
		expect(failed.answer).toMatchObject({ status: "failed", text: "" })
		// Retrying the same question fails the same way: the fake reads it. The failed one goes.
		const again = await read(await retryAnswer(userId, asked.thread.id, en))
		expect(again.answer.status).toBe("failed")
		const [thread] = await listDocumentThreads(userId, id, null)
		expect(thread!.messages.map((m) => m.status)).toEqual(["done", "failed"])
	})

	it("says when the model declines", async () => {
		const id = await article()
		const asked = await askAboutPassage(
			userId,
			id,
			{ action: "ask", exact: "Makers", question: FAKE_REFUSE },
			en,
		)
		expect((await read(asked)).answer.status).toBe("refused")
	})
})

describe("threads", () => {
	it("delete and restore, and move to a new version of the article", async () => {
		const id = await article()
		const asked = await askAboutPassage(
			userId,
			id,
			{ action: "explain", exact: "one hour slots" },
			en,
		)
		await read(asked)
		await deleteThread(userId, asked.thread.id)
		expect(await listDocumentThreads(userId, id, null)).toEqual([])
		await restoreThread(userId, asked.thread.id)
		expect(await refusal(restoreThread(userId, asked.thread.id))).toMatchObject({
			code: "not_found",
		})

		const moved = `Preface. ${TEXT}`
		const versionId = await newVersion(id, moved, 2)
		const [thread] = await listDocumentThreads(userId, id, versionId)
		expect(thread).toMatchObject({
			versionId,
			startOffset: moved.indexOf("one hour slots"),
			orphaned: false,
		})
		// The answer's citations move with it: a chip still points at the words it quoted.
		const cited = thread!.messages.flatMap((m) => m.citations)
		expect(cited.length).toBeGreaterThan(0)
		for (const c of cited) expect(moved.slice(c.start, c.end)).toBe(c.exact)
		expect(cited[0]!.start).toBe(TEXT.indexOf(cited[0]!.exact) + "Preface. ".length)
		const gone = await newVersion(id, "Nothing of it is left.", 3)
		expect((await listDocumentThreads(userId, id, gone))[0]).toMatchObject({ orphaned: true })
		expect(await refusal(followUp(userId, asked.thread.id, "Still?", en))).toMatchObject({
			code: "no_match",
		})
	})
})

describe("briefArticle", () => {
	it("writes a cited brief once per version, and counts it once", async () => {
		const id = await article()
		const before = (await usageOf(userId)).ai.used
		const first = await briefArticle(userId, id, en)
		if (!("events" in first)) throw new Error("expected a new brief")
		const events = []
		for await (const event of first.events) events.push(event)
		const brief = await first.brief
		expect(brief?.text.split("\n")).toHaveLength(3)
		expect(brief?.citations[0]).toMatchObject({
			start: 0,
			exact: "Makers need long blocks of time.",
		})
		expect(events.some((e) => e.type === "citation")).toBe(true)
		expect((await usageOf(userId)).ai.used).toBe(before + 1)
		expect(first.allowance).toMatchObject({ used: before + 1, max: env.LIMIT_AI_PER_MONTH })

		// Kept: the same brief, at no cost.
		const again = await briefArticle(userId, id, en)
		expect(again).toMatchObject({ id: brief!.id })
		expect((await usageOf(userId)).ai.used).toBe(before + 1)

		// A new version of the article needs a new one.
		await newVersion(id, `Preface. ${TEXT}`, 2)
		expect("events" in (await briefArticle(userId, id, en))).toBe(true)
	})

	it("is the user's own: another account can't read or make one", async () => {
		const id = await article()
		expect(await refusal(briefArticle(otherId, id, en))).toMatchObject({ code: "not_found" })
	})
})

describe("askArticle", () => {
	it("keeps one chat per article: the first question starts it, the next continue it", async () => {
		const id = await article()
		const first = await read(await askArticle(userId, id, "What is it about?", en))
		expect(first.answer.status).toBe("done")
		expect(first.answer.citations[0]).toMatchObject({ exact: "Makers need long blocks of time." })
		const second = await read(await askArticle(userId, id, "And managers?", en))
		expect(second.answer.text).toContain("Answer 2.")
		const threads = await listDocumentThreads(userId, id, null)
		expect(threads.map((t) => t.action)).toEqual(["chat"])
		expect(threads[0]!.messages.map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
		])

		// It moves with the article to a new version, and keeps taking questions.
		const versionId = await newVersion(id, `Preface. ${TEXT}`, 2)
		const [moved] = await listDocumentThreads(userId, id, versionId)
		expect(moved).toMatchObject({ versionId, orphaned: false })
		expect((await read(await askArticle(userId, id, "Still?", en))).answer.status).toBe("done")
	})

	it("is not a passage action", async () => {
		const id = await article()
		expect(
			await refusal(askAboutPassage(userId, id, { action: "chat" as never, exact: "Makers" }, en)),
		).toMatchObject({ code: "invalid_request" })
	})
})

describe("races", () => {
	it("two first questions at once make one chat: the second continues the first's", async () => {
		const id = await article()
		const before = (await usageOf(userId)).ai.used
		const [a, b] = await Promise.allSettled([
			askArticle(userId, id, "First?", en).then(read),
			askArticle(userId, id, "Second?", en).then(read),
		])
		const threads = await listDocumentThreads(userId, id, null)
		expect(threads.filter((t) => t.action === "chat")).toHaveLength(1)
		// The second waits for the first's answer (`already_pending`) or follows it up; never a second chat.
		const answered = [a, b].filter((r) => r.status === "fulfilled").length
		expect((await usageOf(userId)).ai.used).toBe(before + answered)
	})

	it("doesn't bring back a cleared chat over a newer one", async () => {
		const id = await article()
		const first = await askArticle(userId, id, "First?", en)
		await read(first)
		await deleteThread(userId, first.thread.id)
		await read(await askArticle(userId, id, "Again?", en))
		expect(await refusal(restoreThread(userId, first.thread.id))).toMatchObject({
			code: "not_found",
		})
	})

	it("writes one brief at a time per version, and finishes it when the reader leaves", async () => {
		const id = await article()
		const before = (await usageOf(userId)).ai.used
		const leaving = new AbortController()
		const first = await briefArticle(userId, id, { ...en, signal: leaving.signal })
		expect(await refusal(briefArticle(userId, id, en))).toMatchObject({ code: "already_pending" })
		leaving.abort()
		if (!("events" in first)) throw new Error("expected a new brief")
		for await (const _ of first.events) {
			// read to its end, as the route does
		}
		expect(await first.brief).toMatchObject({ text: expect.stringContaining("- ") })
		expect((await usageOf(userId)).ai.used).toBe(before + 1)
		expect(await briefArticle(userId, id, en)).toMatchObject({ id: (await first.brief)!.id })
	})

	it("keeps no failed brief", async () => {
		const id = await article(TEXT, `Schedules ${FAKE_FAIL}`)
		const failing = await briefArticle(userId, id, en)
		if (!("events" in failing)) throw new Error("expected a new brief")
		try {
			for await (const _ of failing.events) {
				// read to its end
			}
		} catch {
			// the provider broke off
		}
		expect(await failing.brief).toBeNull()
		expect("events" in (await briefArticle(userId, id, en))).toBe(true)
	})
})
