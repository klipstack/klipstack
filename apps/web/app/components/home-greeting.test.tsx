import { resources } from "@klipstack/i18n"
import { createInstance } from "i18next"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nextProvider } from "react-i18next"
import { describe, expect, it } from "vitest"
import { Greeting } from "./home-greeting"

async function render(
	lng: "en" | "es",
	name: string | undefined,
	part: "morning" | "afternoon" | "evening" | null = null,
) {
	const i18n = createInstance()
	await i18n.init({ resources, lng, fallbackLng: "en", interpolation: { escapeValue: false } })
	return renderToStaticMarkup(
		<I18nextProvider i18n={i18n}>
			<Greeting name={name} part={part} />
		</I18nextProvider>,
	)
}

describe("Greeting", () => {
	it("marks the reader's name, in both languages", async () => {
		expect(await render("en", "Alex")).toBe('Welcome back, <mark class="marker swipe">Alex</mark>')
		expect(await render("es", "Alex")).toBe('Hola de nuevo, <mark class="marker swipe">Alex</mark>')
	})

	it("greets by the part of the day, when Home knows it", async () => {
		expect(await render("en", "Alex", "evening")).toBe(
			'Good evening, <mark class="marker swipe">Alex</mark>',
		)
		expect(await render("es", "Alex", "afternoon")).toBe(
			'Buenas tardes, <mark class="marker swipe">Alex</mark>',
		)
		expect(await render("es", undefined, "morning")).toBe("Buenos días")
	})

	it("shows a name that looks like markup or a placeholder as the text it is", async () => {
		expect(await render("en", "</mark><b>x</b>{{ns}}")).toBe(
			'Welcome back, <mark class="marker swipe">&lt;/mark&gt;&lt;b&gt;x&lt;/b&gt;{{ns}}</mark>',
		)
	})
})
