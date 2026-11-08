// @vitest-environment jsdom
import { act, useContext, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { createRoutesStub, UNSAFE_DataRouterContext, useFetcher } from "react-router"
import { afterEach, expect, it, vi } from "vitest"
import { useFetcherAnswer } from "./use-fetcher-answer"

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

/** A page whose fetcher saves on a click, with a render that changes nothing on each router update. */
async function setup() {
	const answers: unknown[] = []
	function Page() {
		const fetcher = useFetcher<{ saved: string }>()
		useFetcherAnswer(fetcher, (answer) => answers.push(answer))
		// As a store subscription makes: it reads the fetcher's new data before the router's own
		// render (remix-run/react-router#15724).
		const router = useContext(UNSAFE_DataRouterContext)?.router
		const [, setTick] = useState(0)
		useEffect(
			() =>
				router?.subscribe(() => {
					setTick(1)
					setTick(0)
				}),
			[router],
		)
		return (
			<button type="button" onClick={() => fetcher.submit({}, { method: "post", action: "/save" })}>
				{fetcher.state}
			</button>
		)
	}
	let saved = 0
	const Stub = createRoutesStub([
		{ path: "/", Component: Page },
		{ path: "/save", action: () => ({ saved: `#${++saved}` }) },
	])
	const container = document.createElement("div")
	document.body.append(container)
	const root = createRoot(container)
	await act(async () => root.render(<Stub />))
	cleanup = () => {
		act(() => root.unmount())
		container.remove()
	}
	const button = () => container.querySelector("button")!
	return { answers, button }
}

it("hands over each answer once, even when another render reads it first", async () => {
	const { answers, button } = await setup()
	await act(async () => button().click())
	await vi.waitFor(() => expect(button().textContent).toBe("idle"))
	expect(answers).toEqual([{ saved: "#1" }])

	// A second answer is new; the first is not handed over again.
	await act(async () => button().click())
	await vi.waitFor(() => expect(answers).toEqual([{ saved: "#1" }, { saved: "#2" }]))
	expect(button().textContent).toBe("idle")
})

it("hands over an answer whose submission lands in one commit, idle to idle", async () => {
	const { answers, button } = await setup()
	const submitAndSettle = () =>
		act(async () => {
			button().click()
			await new Promise((resolve) => setTimeout(resolve, 50))
		})
	await submitAndSettle()
	await submitAndSettle()
	expect(answers).toEqual([{ saved: "#1" }, { saved: "#2" }])
})
