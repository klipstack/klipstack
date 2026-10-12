import sharp from "sharp"
import { describe, expect, it, vi } from "vitest"
import { loader } from "./edition-cover-example"

vi.mock("~/lib/i18n.server", async () => {
	const { createInstance } = await import("i18next")
	const { resources } = await import("@klipstack/i18n")
	const i18n = createInstance()
	await i18n.init({ resources, fallbackLng: "en", interpolation: { escapeValue: false } })
	return { getInstance: () => i18n }
})

const example = (name: string) =>
	loader({ params: { name }, context: {} } as never).then(
		(response) => response,
		(thrown: unknown) => thrown,
	)
const status = (thrown: unknown) => (thrown as { init?: { status?: number } }).init?.status

describe("a cover's example for the editor", () => {
	it("is a small PNG of each cover, in each language, kept by browsers", async () => {
		for (const name of ["stack-en.png", "shelf-es.png"]) {
			const response = (await example(name)) as Response
			expect(response.headers.get("Content-Type")).toBe("image/png")
			expect(response.headers.get("Cache-Control")).toMatch(/max-age=\d+/)
			const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
			expect([meta.width, meta.height]).toEqual([600, 315])
		}
	})

	it("is not found for a cover or a language Klipstack lacks", async () => {
		for (const name of ["poster-en.png", "stack-fr.png", "stack-en", "stack.png"])
			expect(status(await example(name))).toBe(404)
	})
})
