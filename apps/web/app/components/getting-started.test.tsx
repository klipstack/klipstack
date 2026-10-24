// @vitest-environment jsdom
import { resources } from "@klipstack/i18n"
import { createInstance } from "i18next"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { I18nextProvider } from "react-i18next"
import { createRoutesStub } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { GettingStarted, type GettingStartedNav } from "./getting-started"

const saveLink = vi.hoisted(() => ({ opened: 0 }))
vi.mock("./save-link-dialog", () => ({
	openSaveLink: () => {
		saveLink.opened++
		return true
	},
	saveLinkPath: () => "/library?save",
}))

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

const STORE = "https://klipstack.com/extension"
const card = (steps: Partial<NonNullable<GettingStartedNav>["steps"]>): GettingStartedNav => ({
	steps: {
		save: false,
		extension: false,
		highlight: false,
		feature: false,
		topics: true,
		...steps,
	},
	extensionUrl: STORE,
	guide: "guide-en",
})

/** The card in a page, with `/onboarding` counting what it is sent. */
async function render(nav: GettingStartedNav, { collapsed = false } = {}) {
	const i18n = createInstance()
	await i18n.init({
		resources,
		lng: "en",
		fallbackLng: "en",
		defaultNS: "common",
		interpolation: { escapeValue: false },
	})
	const sent: string[] = []
	const onExpand = vi.fn()
	const Stub = createRoutesStub([
		{
			path: "/",
			Component: () => <GettingStarted card={nav} collapsed={collapsed} onExpand={onExpand} />,
		},
		{
			path: "/onboarding",
			action: async ({ request }) => {
				sent.push(String((await request.formData()).get("intent")))
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
	await act(async () => {})
	cleanup = () => {
		act(() => root.unmount())
		container.remove()
	}
	return { container, sent, onExpand }
}

describe("Getting started", () => {
	it("lists the steps with their state, the store a link out, the save step opening Save link", async () => {
		const { container } = await render(card({ feature: true }))
		expect(container.textContent).toContain("1 of 4")
		const boxes = [...container.querySelectorAll('[role="img"]')].map((box) =>
			box.getAttribute("aria-label"),
		)
		expect(boxes).toEqual(["To do", "To do", "To do", "Done"])
		const store = container.querySelector<HTMLAnchorElement>(`a[href="${STORE}"]`)!
		expect(store.textContent).toBe("browser extension")
		expect(store.target).toBe("_blank")
		expect(store.rel).toContain("noopener")
		const save = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "Save your first article",
		)!
		await act(async () => save.click())
		expect(saveLink.opened).toBe(1)
	})

	it("leaves the extension out where it is not offered, and names topics only where they can be", async () => {
		const { container } = await render(card({ extension: null, topics: false }))
		expect(container.textContent).toContain("0 of 3")
		expect(container.textContent).not.toContain("browser extension")
		expect(container.textContent).toContain("Turn on feeds or editions")
	})

	it("says All set once every step is done, and ends the card, once", async () => {
		const { container, sent } = await render(
			card({ save: true, extension: null, highlight: true, feature: true }),
		)
		expect(container.textContent).toContain("All set")
		expect(sent).toEqual(["end-card"])
	})

	it("in the collapsed sidebar, is an icon with the count that opens the sidebar", async () => {
		const { container, onExpand } = await render(card({ save: true }), { collapsed: true })
		const icon = container.querySelector<HTMLButtonElement>('[data-testid="getting-started"]')!
		expect(icon.getAttribute("aria-label")).toBe("Getting started: 1 of 4 done")
		expect(icon.textContent).toBe("1/4")
		await act(async () => icon.click())
		expect(onExpand).toHaveBeenCalledOnce()
	})

	it("ends for good with its ✕", async () => {
		const { container, sent } = await render(card({}))
		const hide = container.querySelector<HTMLButtonElement>('[aria-label="Hide this"]')!
		await act(async () => hide.click())
		await act(async () => {})
		expect(sent).toEqual(["end-card"])
		expect(container.querySelector('[data-testid="getting-started"]')).toBeNull()
	})
})
