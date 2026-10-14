import { resources } from "@klipstack/i18n"
import { createInstance } from "i18next"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"
import type { EditionEar } from "~/lib/home-masthead"
import { EditionCorner } from "./home-masthead"

async function render(lng: "en" | "es", edition: NonNullable<EditionEar>) {
	const i18n = createInstance()
	await i18n.init({ resources, lng, fallbackLng: "en", interpolation: { escapeValue: false } })
	return renderToStaticMarkup(
		<I18nextProvider i18n={i18n}>
			<MemoryRouter>
				<EditionCorner edition={edition} />
			</MemoryRouter>
		</I18nextProvider>,
	)
}
const text = (html: string) => html.replace(/<[^>]+>/g, "")

describe("EditionCorner", () => {
	it("counts what is marked, and leads to putting the edition together", async () => {
		const html = await render("en", { draft: false, count: 1 })
		expect(text(html)).toBe("Your next edition: 1 marked · Put it together")
		expect(html).toMatch(/<a [^>]*href="\/editions"[^>]*>Put it together<\/a>/)
		expect(text(await render("es", { draft: false, count: 3 }))).toBe(
			"Tu próxima edición: 3 marcados · Prepárala",
		)
	})

	it("tells of the draft in progress, empty or not, and leads to it", async () => {
		expect(text(await render("en", { draft: true, count: 2 }))).toBe(
			"Your next edition: 2 articles in the draft · Continue editing",
		)
		const empty = await render("en", { draft: true, count: 0 })
		expect(text(empty)).toBe("Your next edition: a draft started · Continue editing")
		expect(empty).toMatch(/<a [^>]*href="\/editions"[^>]*>Continue editing<\/a>/)
		expect(text(await render("es", { draft: true, count: 1 }))).toBe(
			"Tu próxima edición: 1 artículo en el borrador · Seguir editando",
		)
	})
})
