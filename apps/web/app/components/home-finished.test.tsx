import { resources } from "@klipstack/i18n"
import { createInstance } from "i18next"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nextProvider } from "react-i18next"
import { describe, expect, it } from "vitest"
import { FinishedLately } from "./home-finished"

async function render(lng: "en" | "es", props: { count: number; title: string | null }) {
	const i18n = createInstance()
	await i18n.init({ resources, lng, fallbackLng: "en", interpolation: { escapeValue: false } })
	return renderToStaticMarkup(
		<I18nextProvider i18n={i18n}>
			<FinishedLately {...props} />
		</I18nextProvider>,
	)
}
const text = (html: string) => html.replace(/<[^>]+>/g, "")

describe("FinishedLately", () => {
	it("counts two or more articles", async () => {
		expect(text(await render("en", { count: 4, title: null }))).toBe(
			"You finished 4 articles this past week.",
		)
		expect(text(await render("es", { count: 4, title: null }))).toBe(
			"Terminaste 4 artículos esta última semana.",
		)
	})

	it("names one article, its title set apart and never read as markup", async () => {
		const html = await render("en", { count: 1, title: "Why <b>bold</b> claims & {{count}}" })
		expect(html).toContain(
			'You finished <cite class="text-fg italic">Why &lt;b&gt;bold&lt;/b&gt; claims &amp; {{count}}</cite> this past week.',
		)
		expect(await render("es", { count: 1, title: "Cómo leer un libro" })).toContain(
			'Terminaste <cite class="text-fg italic">Cómo leer un libro</cite> esta última semana.',
		)
	})

	it("cuts a long title", async () => {
		const title = `${"word ".repeat(30)}end`
		const cited = /<cite[^>]*>([^<]*)<\/cite>/.exec(await render("en", { count: 1, title }))?.[1]
		expect(cited).toBe(`${"word ".repeat(15).trimEnd()}…`)
	})

	it("says an article without a title was finished", async () => {
		const html = await render("en", { count: 1, title: null })
		expect(text(html)).toBe("You finished an article this past week.")
		expect(html).not.toContain("<cite")
	})
})
