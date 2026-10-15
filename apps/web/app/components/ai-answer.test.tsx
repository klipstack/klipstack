import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { briefSection } from "~/lib/brief"
import { AiAnswer, answerLead } from "./ai-answer"

const render = (text: string, heading?: (title: string) => string) =>
	renderToStaticMarkup(
		<AiAnswer text={text} citations={[]} citeLabel={(n) => `${n}`} heading={heading} />,
	)

describe("AiAnswer", () => {
	it("shows a brief of three bullets, written before the sections, as one list", () => {
		expect(render("- One.\n- Two.\n\n- Three.")).toBe(
			'<div class="flex flex-col gap-2"><ul class="flex flex-col gap-1.5 pl-4 list-disc"><li>One.</li><li>Two.</li></ul><ul class="flex flex-col gap-1.5 pl-4 list-disc"><li>Three.</li></ul></div>',
		)
	})

	it("shows a brief's sections under the reader's headings, claims numbered", () => {
		const es = { claims: "Afirmaciones clave", caveats: "Ten en cuenta", parts: "Partes" }
		const html = render(
			"Gist.\n\n## Key claims\n1. One.\n2. Two.\n\n## Keep in mind\n\n- A caveat.\nNot listed.",
			(title) => es[briefSection(title)!] ?? title,
		)
		expect(html).toContain("<p>Gist.</p>")
		expect(html).toMatch(
			/<h3[^>]*>Afirmaciones clave<\/h3><ol[^>]*><li>One\.<\/li><li>Two\.<\/li><\/ol>/,
		)
		expect(html).toMatch(
			/<h3[^>]*>Ten en cuenta<\/h3><ul[^>]*><li>A caveat\.<\/li><\/ul><p>Not listed\.<\/p>/,
		)
		expect(html).not.toContain("##")
	})

	it("goes on counting a numbered list broken up by blank lines", () => {
		const html = render("1. One.\n\n2. Two.\n\n3. Three.")
		expect(html.match(/<ol[^>]*>/g)).toEqual([
			expect.stringContaining('start="1"'),
			expect.stringContaining('start="2"'),
			expect.stringContaining('start="3"'),
		])
	})
})

describe("answerLead", () => {
	it("is the bold sentence the answer opens with", () => {
		expect(answerLead("**Makers need whole afternoons.** One meeting. **Not this.**")).toBe(
			"Makers need whole afternoons.",
		)
	})

	it("is the first sentence of an answer that doesn't open in bold", () => {
		expect(answerLead("It costs 3.5 hours, *not* one. The rest follows.")).toBe(
			"It costs 3.5 hours, not one.",
		)
		expect(answerLead("Mid-way through the answer **a bold word**. More.")).toBe(
			"Mid-way through the answer a bold word.",
		)
	})

	it("is the bold sentence with italics inside it, without its marks", () => {
		expect(answerLead("**The *real* cost is time.** More.")).toBe("The real cost is time.")
	})

	it("is what is written so far while the bold sentence is still coming", () => {
		expect(answerLead("**Makers need who")).toBe("Makers need who")
	})
})
