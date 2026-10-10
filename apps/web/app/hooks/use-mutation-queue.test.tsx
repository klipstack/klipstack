// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { createRoutesStub } from "react-router"
import { afterEach, expect, it, vi } from "vitest"
import { useMutationQueue } from "./use-mutation-queue"

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

/** A page with one queue on `/change`, whose server answers only when the test lets it. */
async function setup() {
	const received: string[] = []
	const release: Array<() => void> = []
	const settled: Array<[string, unknown]> = []
	function Page() {
		const queue = useMutationQueue<string, { got: string }>({
			action: "/change",
			body: (change) => ({ change }),
			onSettled: (change, answer) => settled.push([change, answer]),
		})
		const sendTwo = () => {
			queue.submit("a")
			queue.submit("b")
		}
		return (
			<button type="button" onClick={sendTwo}>
				{queue.pending.join(",")}
			</button>
		)
	}
	const Stub = createRoutesStub([
		{ path: "/", Component: Page },
		{
			path: "/change",
			action: async ({ request }) => {
				const change = String((await request.formData()).get("change"))
				received.push(change)
				await new Promise<void>((resolve) => release.push(resolve))
				return { got: change }
			},
		},
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
	return {
		received,
		release,
		settled,
		sendTwo: () => button().click(),
		pending: () => button().textContent,
	}
}

it("sends changes one at a time, in order, and hands each its own answer", async () => {
	const page = await setup()
	await act(async () => page.sendTwo())
	// Both show at once; only the first is on its way.
	expect(page.pending()).toBe("a,b")
	await vi.waitFor(() => expect(page.received).toEqual(["a"]))

	await act(async () => page.release.shift()?.())
	await vi.waitFor(() => expect(page.received).toEqual(["a", "b"]))
	expect(page.settled).toEqual([["a", { got: "a" }]])
	expect(page.pending()).toBe("b")

	await act(async () => page.release.shift()?.())
	await vi.waitFor(() => expect(page.settled).toHaveLength(2))
	expect(page.settled[1]).toEqual(["b", { got: "b" }])
	expect(page.pending()).toBe("")
})
