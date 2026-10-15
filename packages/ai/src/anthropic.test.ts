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
