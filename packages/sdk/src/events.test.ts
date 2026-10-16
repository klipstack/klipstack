import { describe, expect, it } from "vitest"
import { sseData } from "./events"

/** A body that arrives in these pieces. */
function body(...chunks: string[]) {
	const encoder = new TextEncoder()
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
			controller.close()
		},
	})
}

async function all(stream: ReadableStream<Uint8Array>) {
	const out: unknown[] = []
	for await (const value of sseData(stream)) out.push(value)
	return out
}

describe("sseData", () => {
	it("parses each event's data, whatever the chunks cut", async () => {
		expect(
			await all(body('data: {"a":', '1}\n\ndata: {"b":"x\\n', 'y"}\r\n\r', "\n: a comment\n\n")),
		).toEqual([{ a: 1 }, { b: "x\ny" }])
	})

	it("joins an event's data lines, and takes a last event without its blank line", async () => {
		expect(await all(body("event: x\ndata: [1,\ndata:2]\n\ndata: 3"))).toEqual([[1, 2], 3])
	})

	it("decodes characters split between chunks", async () => {
		const bytes = new TextEncoder().encode('data: "é"\n\n')
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes.slice(0, 7))
				controller.enqueue(bytes.slice(7))
				controller.close()
			},
		})
		expect(await all(stream)).toEqual(["é"])
	})

	it("cancels the body when the reader stops early", async () => {
		let cancelled = false
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("data: 1\n\n"))
			},
			cancel() {
				cancelled = true
			},
		})
		for await (const value of sseData(stream)) {
			expect(value).toBe(1)
			break
		}
		expect(cancelled).toBe(true)
	})
})
