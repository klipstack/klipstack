import { readFileSync } from "node:fs"
import { join } from "node:path"
import { db, eq, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { sameOrigin, signupUser } from "./helpers"
import { insertArticle } from "./seed"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const PASSAGE = "There are two types of schedule"

async function saveArticle(page: Page): Promise<string> {
	const res = await page.request.post("/api/documents", {
		data: {
			url: "https://paulgraham.com/makersschedule.html",
			html: readFileSync(FIXTURE, "utf8"),
		},
	})
	const { id } = ((await res.json()) as { article: { id: string } }).article
	await page.goto(`/read/${id}`)
	await expect(page.locator(".reader-content")).toContainText(PASSAGE, { timeout: 60_000 })
	return id
}

/** The server-sent events of an answer, each `data:` line parsed. */
const events = (body: string) =>
	body
		.split("\n\n")
		.filter((chunk) => chunk.startsWith("data: "))
		.map((chunk) => JSON.parse(chunk.slice(6)) as { type: string; [key: string]: unknown })

test("a question about a passage streams its answer, with a citation, and is kept", async ({
	page,
}) => {
	test.setTimeout(120_000)
	await signupUser(page, "Asker", { features: ["ai"] })
	const id = await saveArticle(page)
	const res = await page.request.post(`/documents/${id}/ai`, {
		headers: sameOrigin(),
		data: { intent: "ask", action: "explain", exact: PASSAGE },
	})
	expect(res.status()).toBe(201)
	expect(res.headers()["content-type"]).toContain("text/event-stream")
	const sent = events(await res.text())
	expect(sent[0]).toMatchObject({
		type: "start",
		thread: { action: "explain", exact: PASSAGE },
		question: { role: "user" },
	})
	expect(sent.filter((e) => e.type === "text").length).toBeGreaterThan(1)
	expect(sent).toContainEqual(
		expect.objectContaining({
			type: "citation",
			// The passage's whole sentence.
			citation: expect.objectContaining({ exact: expect.stringContaining(PASSAGE) }),
		}),
	)
	const last = sent.at(-1)!
	expect(last).toMatchObject({ type: "answer", message: { role: "assistant", status: "done" } })
	expect(JSON.stringify(last)).not.toContain("inputTokens")

	const threadId = (sent[0]!.thread as { id: string }).id
	const follow = events(
		await (
			await page.request.post(`/documents/${id}/ai`, {
				headers: sameOrigin(),
				data: { intent: "follow-up", id: threadId, question: "And then?" },
			})
		).text(),
	)
	expect(follow.at(-1)).toMatchObject({ message: { text: expect.stringContaining("Answer 2.") } })

	// The answer arrives in pieces as it is written: nothing on the way (compression, the proxy)
	// holds it back until the end.
	const reads = await page.evaluate(
		async ([url, thread]) => {
			const res = await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ intent: "retry", id: thread }),
			})
			const reader = res.body!.getReader()
			let count = 0
			while (!(await reader.read()).done) count++
			return count
		},
		[`/documents/${id}/ai`, threadId] as const,
	)
	expect(reads).toBeGreaterThan(2)

	const deleted = await page.request.post(`/documents/${id}/ai`, {
		headers: sameOrigin(),
		data: { intent: "delete", id: threadId },
	})
	expect(await deleted.json()).toEqual({ ok: true, id: threadId })
})

test("without the feature, nothing is asked", async ({ page }) => {
	const email = await signupUser(page, "NoAI")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	// Refused before anything reads the article: it need not be extracted.
	const id = await insertArticle(owner!.id, "No AI", `<p>${PASSAGE}.</p>`)
	const res = await page.request.post(`/documents/${id}/ai`, {
		headers: sameOrigin(),
		data: { intent: "ask", action: "explain", exact: PASSAGE },
	})
	expect(res.status()).toBe(403)
	expect(await res.json()).toMatchObject({ ok: false, error: { code: "forbidden" } })
})
