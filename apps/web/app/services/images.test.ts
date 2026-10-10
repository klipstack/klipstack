import { htmlToMarkdown } from "@klipstack/extract"
import { describe, expect, it } from "vitest"
import { numberImages } from "./images"

const A = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"
const B = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"
const ORIGIN = "https://klipstack.test"

const HTML = [
	"<p>Intro.</p>",
	`<figure><img src="/assets/${A}" data-original-src="https://site.test/a.png" alt="A  chart"><figcaption>Figure 1:\n growth</figcaption></figure>`,
	'<p>Middle <img src="https://site.test/tracker.gif" alt=""> text.</p>',
	`<p><img src="/assets/${B}" data-original-src="https://site.test/b.png"></p>`,
	'<img src="data:image/png;base64,AAAA">',
].join("")

describe("numberImages", () => {
	it("numbers stored images in reading order and counts the others", () => {
		const { images, notStored } = numberImages(HTML, ORIGIN)
		expect(images).toEqual([
			{ number: 1, assetId: A, alt: "A chart", caption: "Figure 1: growth" },
			{ number: 2, assetId: B, alt: "", caption: "" },
		])
		expect(notStored).toBe(1)
	})

	it("labels stored images and links their copies in the Markdown", () => {
		const markdown = htmlToMarkdown(numberImages(HTML, ORIGIN).html)
		expect(markdown).toContain(`![Image 1: A chart](${ORIGIN}/assets/${A})`)
		expect(markdown).toContain("_Figure 1: growth_")
		expect(markdown).toContain(`![Image 2](${ORIGIN}/assets/${B})`)
		expect(markdown).toContain("![](https://site.test/tracker.gif)")
		expect(markdown).not.toContain("site.test/a.png")
	})

	it("leaves HTML without stored images untouched", () => {
		const html = '<p>Text <img src="https://site.test/x.png"></p>'
		expect(numberImages(html, ORIGIN)).toEqual({ html, images: [], notStored: 1 })
		expect(numberImages("<p>No images</p>", ORIGIN).images).toEqual([])
	})

	it("lists a caption repeated in the alt text once", () => {
		const figure = (alt: string, caption: string) =>
			`<figure><img src="/assets/${A}" alt="${alt}"><figcaption>${caption}</figcaption></figure>`
		const { images } = numberImages(
			figure("Getty Images Teens at a dance (Credit: Getty)", "Teens at a dance (Credit: Getty)") +
				figure("A map", "A map of the route"),
			ORIGIN,
		)
		expect(images.map(({ alt, caption }) => ({ alt, caption }))).toEqual([
			{ alt: "Getty Images Teens at a dance (Credit: Getty)", caption: "" },
			{ alt: "", caption: "A map of the route" },
		])
	})

	it("keeps the original alt text when asked not to label", () => {
		const { html, images } = numberImages(HTML, ORIGIN, { label: false })
		expect(images.map((i) => i.number)).toEqual([1, 2])
		const markdown = htmlToMarkdown(html)
		expect(markdown).toContain(`![A  chart](${ORIGIN}/assets/${A})`)
		expect(markdown).toContain(`![](${ORIGIN}/assets/${B})`)
		expect(markdown).not.toContain("Image 1")
		expect(markdown).not.toContain("site.test/a.png")
	})

	it("ignores asset-like paths that are not asset ids", () => {
		const { images } = numberImages('<img src="/assets/../settings"><img src="/assets/x">', ORIGIN)
		expect(images).toEqual([])
	})
})
