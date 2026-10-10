import { expect, it } from "vitest"
import { downloadResponse } from "./download-response.server"

it("sends the bytes as an attachment with their length", async () => {
	const body = new TextEncoder().encode("hello")
	const response = downloadResponse({ body, contentType: "text/plain", filename: "a.txt" })
	expect(response.headers.get("content-type")).toBe("text/plain")
	expect(response.headers.get("content-disposition")).toBe('attachment; filename="a.txt"')
	expect(response.headers.get("content-length")).toBe("5")
	expect(response.headers.get("cache-control")).toBe("no-store")
	expect(await response.text()).toBe("hello")
})
