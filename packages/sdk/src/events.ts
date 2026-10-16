/**
 * The `data:` values of a server-sent event stream, parsed as JSON, as they arrive. Lines of one
 * event are joined; comments, other fields and empty events are skipped. The body is cancelled
 * when the reader stops early.
 */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
	const reader = body.getReader()
	const decoder = new TextDecoder()
	let buffer = ""
	let data: string[] = []
	let done = false
	try {
		while (!done) {
			const chunk = await reader.read()
			done = chunk.done
			buffer += done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
			// The last line may be cut off: it waits for the next chunk, unless the stream ended.
			const lines = buffer.split(/\r\n|\r|\n/)
			buffer = done ? "" : (lines.pop() ?? "")
			if (done) lines.push("")
			for (const line of lines) {
				if (line === "") {
					if (data.length) yield JSON.parse(data.join("\n"))
					data = []
				} else if (line.startsWith("data:"))
					data.push(line.slice(line.startsWith("data: ") ? 6 : 5))
			}
		}
	} finally {
		if (!done) await reader.cancel().catch(() => {})
		reader.releaseLock()
	}
}
