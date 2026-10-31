// @vitest-environment jsdom
import { resources } from "@klipstack/i18n"
import { createInstance } from "i18next"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { I18nextProvider } from "react-i18next"
import { createRoutesStub } from "react-router"
import { afterEach, expect, it } from "vitest"
import type { SidebarNewsItem } from "~/services/news.server"
import { NewsStack } from "./news-stack"

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

const item = (slug: string, title: string): SidebarNewsItem => ({
	slug,
	title,
	date: "2026-10-20T00:00:00.000Z",
	description: `About ${title}.`,
})
const NEWS = [item("first", "First"), item("second", "Second"), item("third", "Third")]

/** The stack in a page, with `/news/:slug/close` counting what it is sent. */
async function render() {
	const i18n = createInstance()
	await i18n.init({
		resources,
		lng: "en",
		fallbackLng: "en",
		defaultNS: "common",
		interpolation: { escapeValue: false },
	})
	const closed: string[] = []
	const Stub = createRoutesStub([
		{ path: "/", Component: () => <NewsStack news={NEWS} collapsed={false} /> },
		{
			path: "/news/:slug/close",
			action: ({ params }) => {
				closed.push(params.slug!)
				return { ok: true }
			},
		},
	])
	const container = document.createElement("div")
	document.body.append(container)
	const root = createRoot(container)
	await act(async () =>
		root.render(
			<I18nextProvider i18n={i18n}>
				<Stub />
			</I18nextProvider>,
		),
	)
	cleanup = () => {
		act(() => root.unmount())
		container.remove()
	}
	const edges = () => container.querySelector("ul")!
	const row = (title: string) =>
		[...edges().querySelectorAll("a")].find((a) => a.textContent === title)!
	/** A click, as a tap gives it: no pointer on the edges first. Whether the link was followed. */
	const tap = async (el: HTMLElement) => {
		let followed = false
		await act(async () => {
			followed = el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
		})
		return followed
	}
	return { container, closed, edges, row, tap }
}

it("opens the rows on the first tap, and the entry on the next, closing it", async () => {
	const { closed, edges, row, tap } = await render()
	expect(edges().dataset.open).toBeUndefined()

	expect(await tap(row("Second"))).toBe(false)
	expect(edges().dataset.open).toBe("true")
	expect(closed).toEqual([])

	expect(await tap(row("Third"))).toBe(true)
	await act(async () => {})
	expect(closed).toEqual(["third"])
	expect(row("Third")).toBeUndefined()
	expect(row("Second")).toBeDefined()
})

it("shuts on Escape, the focus going on to the top card", async () => {
	const { container, edges, row, tap } = await render()
	await tap(row("Second"))
	row("Second").focus()

	await act(async () => {
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
	})
	expect(edges().dataset.open).toBeUndefined()
	expect(document.activeElement).toBe(container.querySelector("article a"))
	expect(document.activeElement?.textContent).toBe("First")
})

it("shuts on a tap elsewhere", async () => {
	const { edges, row, tap } = await render()
	await tap(row("Second"))

	await act(async () => {
		document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }))
	})
	expect(edges().dataset.open).toBeUndefined()
})
