import { useEffect, useState } from "react"
import { createPath, useMatches, useNavigation } from "react-router"

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
 * A page's Content-Security-Policy belongs to its document, and React Router's navigation keeps
 * the document. A document that began on a page with a wider form-action therefore leaves that
 * page with a full page load, whichever link, redirect or history step leads away: the next page
 * gets its own policy, and the reader never runs under a sign-in page's.
 */
export function useFreshDocumentOnLeave() {
	const matches = useMatches()
	const navigation = useNavigation()
	// The page this document began on, when its policy is wider; null otherwise. Kept for the
	// document's whole life: a later navigation into such a page does not change its policy.
	const [widerAt] = useState(() =>
		matches.some((match) => widerFormAction(match.handle))
			? (matches.at(-1)?.pathname ?? null)
			: null,
	)
	const leavingFor =
		widerAt && navigation.state === "loading" && navigation.location.pathname !== widerAt
			? createPath(navigation.location)
			: null
	useEffect(() => {
		if (leavingFor) window.location.assign(leavingFor)
	}, [leavingFor])
}
