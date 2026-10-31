import { useCallback, useEffect, useState } from "react"
import {
	type BlockerFunction,
	createPath,
	useBlocker,
	useLocation,
	useMatches,
	useNavigation,
} from "react-router"

/**
 * A page whose loader lets its forms go on to other sites (`allowFormTargets` in csp.server.ts):
 * `export const handle: WiderFormActionHandle = { widerFormAction: true }`.
 */
export interface WiderFormActionHandle {
	widerFormAction: true
}

export const widerFormAction = (handle: unknown) =>
	(handle as Partial<WiderFormActionHandle> | undefined)?.widerFormAction === true

/**
 * The page this document began on when its policy is wider (a flagged route), or null. A policy
 * belongs to the document, and React Router's navigation keeps the document: such a document must
 * never show another page. Kept for the document's whole life; a later navigation into a flagged
 * page does not change the policy it began with.
 */
export function useDocumentBeganWider(): string | null {
	const matches = useMatches()
	const { pathname } = useLocation()
	const [page] = useState(() =>
		matches.some((match) => widerFormAction(match.handle)) ? pathname : null,
	)
	return page
}

/**
 * Leaves `page` with a full page load, so the next page gets its own policy, and the reader never
 * runs under a sign-in page's.
 *
 * - A link, `navigate()`, the palette or a shortcut: the blocker stops the navigation before React
 *   Router loads anything, and the browser loads the address instead. Starting a page load while
 *   React Router imports the next page's module would race it: WebKit cancels the import, and
 *   React Router answers a failed import by reloading the page being left.
 * - A form posting to another page goes on as it is (as a load it would turn into a GET).
 * - A server redirect skips blockers, so the flagged pages answer with `redirectDocument`. Any
 *   other redirect that still ends on another page is loaded again once it has settled.
 * - Back and Forward: every history entry this document made is this page's (the rest are
 *   documents of their own), so they never lead to another page here.
 *
 * Mounted only in a document that began on such a page: a router has one blocker at a time, and
 * the reader's (useFinishOnLeave) is never in that document.
 */
export function useFreshDocumentOnLeave(page: string) {
	const submitting = usePostingForm()
	const shouldBlock = useCallback<BlockerFunction>(
		({ nextLocation }) => nextLocation.pathname !== page && !submitting(),
		[page, submitting],
	)
	const blocker = useBlocker(shouldBlock)
	useEffect(() => {
		if (blocker.state !== "blocked") return
		const next = createPath(blocker.location)
		blocker.reset()
		window.location.assign(next)
	}, [blocker])

	const { pathname, search, hash } = useLocation()
	const idle = useNavigation().state === "idle"
	useEffect(() => {
		if (idle && pathname !== page) window.location.replace(pathname + search + hash)
	}, [idle, pathname, search, hash, page])
}

/** Whether a form is posting right now (a `submit` event in this task), not a GET form or a link. */
function usePostingForm() {
	const [state] = useState(() => ({ posting: false }))
	useEffect(() => {
		const onSubmit = (event: SubmitEvent) => {
			const form = event.target as HTMLFormElement
			const method = (
				event.submitter?.getAttribute("formmethod") ??
				form.getAttribute("method") ??
				"get"
			).toLowerCase()
			if (method === "get") return
			state.posting = true
			setTimeout(() => (state.posting = false))
		}
		document.addEventListener("submit", onSubmit, true)
		return () => document.removeEventListener("submit", onSubmit, true)
	}, [state])
	return useCallback(() => state.posting, [state])
}

/** Renders nothing: `useFreshDocumentOnLeave` for the page this document began on. */
export function FreshDocumentOnLeave({ page }: { page: string }) {
	useFreshDocumentOnLeave(page)
	return null
}
