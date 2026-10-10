import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { processImage } from "./images"

async function png(width: number, height: number) {
	return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } } })
		.png()
		.toBuffer()
}

describe("processImage", () => {
	it("refuses an image too large to decode within the worker's memory", async () => {
		await expect(processImage(await png(8000, 6000), { maxWidth: 1600 })).rejects.toThrow(
			/pixel limit/,
		)
	})

	it("takes more images than it decodes at a time, and finishes them all", async () => {
		const source = await png(800, 400)
		const all = await Promise.all(
			Array.from({ length: 5 }, () => processImage(source, { maxWidth: 400 })),
		)
		expect(all.map((out) => out?.width)).toEqual([400, 400, 400, 400, 400])
	})

	it("converts to webp and downsizes to maxWidth", async () => {
		const out = await processImage(await png(2400, 1200), {
			maxWidth: 1600,
			contentType: "image/png",
		})
		expect(out).not.toBeNull()
		expect(out!.width).toBe(1600)
		expect(out!.height).toBe(800)
		const meta = await sharp(out!.data).metadata()
		expect(meta.format).toBe("webp")
	})
	it("does not upscale small images", async () => {
		const out = await processImage(await png(300, 200), { maxWidth: 1600 })
		expect(out!.width).toBe(300)
	})
	it("drops icons and tracking pixels", async () => {
		expect(await processImage(await png(1, 1), { maxWidth: 1600 })).toBeNull()
		expect(await processImage(await png(32, 32), { maxWidth: 1600 })).toBeNull()
	})
	it("rasterizes svg", async () => {
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="teal"/><script>alert(1)</script></svg>',
		)
		const out = await processImage(svg, { maxWidth: 1600, contentType: "image/svg+xml" })
		expect(out!.width).toBe(400)
		expect((await sharp(out!.data).metadata()).format).toBe("webp")
	})
})
