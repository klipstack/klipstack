import { describe, expect, it } from "vitest"
import { type AnswerEvent, createAi } from "./index"

const text = "Makers need long blocks of time. Managers work in one hour slots."
const cited = "Managers work in one hour slots."
const start = text.indexOf(cited)

/** Anthropic's streamed answer. */
function sse(events: object[]) {
	const body = events.map(
		(e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`,
	)
	return new Response(body.join(""), { headers: { "content-type": "text/event-stream" } })
}

describe("Anthropic, through the AI SDK", () => {
	it("sends the article as a cached document of numbered sentences, and reads its markers back", async () => {
		let sent: Record<string, unknown> | undefined
		const fetch = (async (_url: string, init: RequestInit) => {
			sent = JSON.parse(String(init.body))
			const usage = { input_tokens: 50, output_tokens: 9, cache_read_input_tokens: 40 }
			return sse([
				{
					type: "message_start",
					message: {
						id: "m",
						type: "message",
						role: "assistant",
						model: "claude-haiku-5-5",
						content: [],
						stop_reason: null,
						usage,
					},
				},
				{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
				// A marker can come cut in two.
				...["**Short slots.** [", "2] More."].map((text) => ({
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text },
				})),
				{ type: "content_block_stop", index: 0 },
				{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } },
				{ type: "message_stop" },
			])
		}) as typeof globalThis.fetch
		const ai = createAi({ anthropicApiKey: "test", fetch })
		const answer = ai.answer({
			tier: "quick",
			article: { title: "Schedules", text },
			thread: {
				action: "explain",
				passage: { exact: "one hour slots", start: text.indexOf("one hour"), end: text.length - 1 },
				turns: [{ role: "user", text: "" }],
			},
			language: "en",
		})
		const events: AnswerEvent[] = []
		for await (const event of answer.events) events.push(event)
		const result = await answer.done

		const document = (sent!.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]!
			.content[0]
		expect(sent!.model).toBe("claude-haiku-5-5")
		expect(document).toMatchObject({
			type: "document",
			source: {
				type: "text",
				media_type: "text/plain",
				data: "[1] Makers need long blocks of time.\n[2] Managers work in one hour slots.",
			},
			title: "Schedules",
			cache_control: { type: "ephemeral" },
		})
		expect(document).not.toHaveProperty("citations")
		expect(events).toContainEqual({
			type: "citation",
			citation: { start, end: start + cited.length, exact: cited, at: "**Short slots.**".length },
		})
		expect(result).toMatchObject({
			status: "done",
			text: "**Short slots.** More.",
			model: "anthropic:claude-haiku-5-5",
			usage: { outputTokens: 9, cacheReadTokens: 40 },
		})
	})
})

describe("fact check, through Anthropic", () => {
	it("asks Sonnet with two searches at most, and reads its searches and cited pages back", async () => {
		let sent: Record<string, unknown> | undefined
		const page = { url: "https://example.org/darwin", title: "Darwin's day" }
		const fetch = (async (_url: string, init: RequestInit) => {
			sent = JSON.parse(String(init.body))
			const usage = { input_tokens: 900, output_tokens: 30, cache_read_input_tokens: 0 }
			return sse([
				{
					type: "message_start",
					message: {
						id: "m",
						type: "message",
						role: "assistant",
						model: "claude-sonnet-5-5",
						content: [],
						stop_reason: null,
						usage,
					},
				},
				{
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "server_tool_use",
						id: "srvtoolu_1",
						name: "web_search",
						input: {},
					},
				},
				{
					type: "content_block_delta",
					index: 0,
					delta: { type: "input_json_delta", partial_json: '{"query":"Darwin daily routine"}' },
				},
				{ type: "content_block_stop", index: 0 },
				{
					type: "content_block_start",
					index: 1,
					content_block: {
						type: "web_search_tool_result",
						tool_use_id: "srvtoolu_1",
						content: [
							{ type: "web_search_result", ...page, encrypted_content: "e", page_age: null },
							{
								type: "web_search_result",
								url: "https://example.com/listicle",
								title: "Ten habits",
								encrypted_content: "e",
								page_age: null,
							},
						],
					},
				},
				{ type: "content_block_stop", index: 1 },
				{ type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
				{
					type: "content_block_delta",
					index: 2,
					delta: { type: "text_delta", text: "Checked: it [2]\n\n" },
				},
				{ type: "content_block_stop", index: 2 },
				{
					type: "content_block_start",
					index: 3,
					content_block: { type: "text", text: "", citations: [] },
				},
				{
					type: "content_block_delta",
					index: 3,
					delta: {
						type: "citations_delta",
						citation: {
							type: "web_search_result_location",
							...page,
							cited_text: "worked in his study",
							encrypted_index: "i",
						},
					},
				},
				{
					type: "content_block_delta",
					index: 3,
					// Ends in a figure, which the marker reader holds back: the chip still goes after it.
					delta: { type: "text_delta", text: "He worked a third session until 1882" },
				},
				{ type: "content_block_stop", index: 3 },
				{
					type: "message_delta",
					delta: { stop_reason: "end_turn" },
					usage: { output_tokens: 30, server_tool_use: { web_search_requests: 1 } },
				},
				{ type: "message_stop" },
			])
		}) as typeof globalThis.fetch
		const answer = createAi({ anthropicApiKey: "test", fetch }).answer({
			tier: "check",
			article: { title: "Schedules", text },
			thread: {
				action: "check",
				passage: { exact: cited, start, end: start + cited.length },
				turns: [{ role: "user", text: "" }],
			},
			language: "en",
		})
		const events: AnswerEvent[] = []
		for await (const event of answer.events) events.push(event)
		const result = await answer.done

		expect(sent!.model).toBe("claude-sonnet-5-5")
		expect(sent!.tools).toEqual([
			expect.objectContaining({ type: "web_search_20250305", name: "web_search", max_uses: 2 }),
		])
		expect(events).toContainEqual({ type: "search", query: "Darwin daily routine" })
		expect(result.text).toBe("Checked: it\n\nHe worked a third session until 1882")
		expect(result.sources).toEqual([{ ...page, at: result.text.length }])
		const written = events.findLastIndex((e) => e.type === "text")
		expect(events.findIndex((e) => e.type === "source")).toBeGreaterThan(written)
		expect(result.citations).toEqual([expect.objectContaining({ exact: cited })])
		expect(result).toMatchObject({ model: "anthropic:claude-sonnet-5-5", usage: { searches: 1 } })
	})
})
