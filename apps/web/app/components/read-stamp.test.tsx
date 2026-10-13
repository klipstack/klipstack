import { resources } from "@klipstack/i18n"
import { createInstance } from "i18next"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nextProvider } from "react-i18next"
import { describe, expect, it } from "vitest"
import { ReadStamp } from "./read-stamp"

async function render(lng: "en" | "es", tilt = 0) {
	const i18n = createInstance()
	await i18n.init({ resources, lng, fallbackLng: "en", interpolation: { escapeValue: false } })
	return renderToStaticMarkup(
		<I18nextProvider i18n={i18n}>
			<ReadStamp tilt={tilt} />
		</I18nextProvider>,
	)
}

const tiltOf = (html: string) => /(-?rotate-\[[^\]]+\])/.exec(html)?.[1]

describe("ReadStamp", () => {
	it("stamps the word in ink and says Finished to screen readers", async () => {
		const en = await render("en")
		expect(en).toMatch(/<span class="sr-only">Finished<\/span>/)
		expect(en).toMatch(/<span aria-hidden="true"[^>]*text-stamp[^>]*>Read<\/span>/)
		const es = await render("es")
		expect(es).toContain(">Terminado</span>")
		expect(es).toMatch(/aria-hidden="true"[^>]*>Leído<\/span>/)
	})

	it("is always tilted, the same way for the same article", async () => {
		const tilts = await Promise.all([0, 1, 2, 3, 4, -1].map((tilt) => render("en", tilt)))
		const seen = tilts.map(tiltOf)
		for (const tilt of seen) expect(tilt).toMatch(/rotate-\[-?\d+deg\]/)
		expect(new Set(seen.slice(0, 4)).size).toBe(4)
		expect(seen[4]).toBe(seen[0])
		expect(seen[5]).toBe(seen[3])
	})
})
