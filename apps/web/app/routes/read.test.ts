import type { ShouldRevalidateFunctionArgs } from "react-router"
import { describe, expect, it } from "vitest"
import { refreshAbout } from "~/hooks/use-live-updates"
import { shouldRevalidate } from "./read"

const ID = "0190a0e9-0000-7000-8000-000000000001"
const OTHER = "0190a0e9-0000-7000-8000-000000000002"
const page = new URL(`http://localhost/read/${ID}`)

/** What React Router asks the reader after a change posted to `action` (none: a plain refresh). */
function args(
	action?: string,
	body: { form?: Record<string, string>; json?: Record<string, unknown> } = {},
): ShouldRevalidateFunctionArgs {
	const formData = body.form ? new FormData() : undefined
	for (const [k, v] of Object.entries(body.form ?? {})) formData?.set(k, v)
	return {
		currentUrl: page,
		currentParams: { id: ID },
		nextUrl: page,
		nextParams: { id: ID },
		formMethod: action ? "POST" : undefined,
		formAction: action,
		formData,
		json: body.json,
		defaultShouldRevalidate: true,
	} as ShouldRevalidateFunctionArgs
}

describe("the reader loads its article again", () => {
	it("not after its own article changes, which it shows already", () => {
		for (const intent of ["star", "unstar", "archive", "unarchive", "finish", "unread", "delete"])
			expect(shouldRevalidate(args(`/documents/${ID}/state`, { form: { intent } }))).toBe(false)
	})

	it("after a rename, a retry, an undo, or a change to another article", () => {
		for (const intent of ["rename", "retry", "restore", "open"])
			expect(shouldRevalidate(args(`/documents/${ID}/state`, { form: { intent } }))).toBe(true)
		expect(shouldRevalidate(args(`/documents/${OTHER}/state`, { form: { intent: "star" } }))).toBe(
			true,
		)
		expect(shouldRevalidate(args(`/documents/${ID}/tags`, { form: { intent: "add" } }))).toBe(true)
	})

	it("not after its own highlight changes, except a note: its links need the loader", () => {
		const highlights = `/documents/${ID}/highlights`
		for (const json of [
			{ intent: "create", exact: "a quote" },
			{ intent: "update", id: OTHER, color: 2 },
			{ intent: "delete", id: OTHER },
			{ intent: "resize", id: OTHER },
		])
			expect(shouldRevalidate(args(highlights, { json }))).toBe(false)
		expect(
			shouldRevalidate(args(highlights, { json: { intent: "update", id: OTHER, note: "" } })),
		).toBe(true)
		// The toast's undo posts a form.
		expect(shouldRevalidate(args(highlights, { form: { intent: "restore", id: OTHER } }))).toBe(
			true,
		)
	})

	it("on live events about this article or everything, not about other articles only", () => {
		const during = (documents: ReadonlySet<string> | null) => {
			let answer: boolean | undefined
			refreshAbout(documents, () => {
				answer = shouldRevalidate(args())
			})
			return answer
		}
		expect(during(new Set([OTHER]))).toBe(false)
		expect(during(new Set())).toBe(false)
		expect(during(new Set([OTHER, ID]))).toBe(true)
		expect(during(null)).toBe(true)
		// Any other refresh (a failed resize, a link saved) still loads.
		expect(shouldRevalidate(args())).toBe(true)
	})
})
