import type { ReactNode } from "react"
import { useLocation, useMatches } from "react-router"
import type { NsKey } from "./i18n-keys"

/**
 * What the phone top bar shows for the current route. Routes declare it with
 * `export const handle: PageBarHandle = { pageBar: … }`; the desktop layout ignores it and
 * pages keep their own in-content header there.
 */
export interface PageBar {
	/** i18n key of the title. */
	titleKey: NsKey
	/** Optional dynamic heading, such as Home's personal greeting. */
	title?: ReactNode
	/** A search button: a link to the search page, or a field that takes the title's place. */
	search?: PageBarSearchLink | PageBarSearchField
	/** Show the "Save link" button. */
	save?: boolean
	/** Show the list/grid switch. */
	layoutToggle?: boolean
	/** Show Select / Done: multi-select on touch screens (`lib/selection-mode.ts`). */
	select?: boolean
}

/** The button goes to the search page (a list view's, looking where the view looks). */
export interface PageBarSearchLink {
	to: string
	labelKey: NsKey
}

export interface PageBarSearchField {
	action: string
	clearTo: string
	placeholderKey: NsKey
	labelKey: NsKey
	clearKey: NsKey
	/** The search page: the bar is the field, and closing it leaves the page. */
	always?: boolean
}

export interface PageBarHandle {
	pageBar: PageBar | ((args: { pathname: string }) => PageBar)
}

export function usePageBar(): PageBar | null {
	const matches = useMatches()
	const { pathname } = useLocation()
	for (let i = matches.length - 1; i >= 0; i--) {
		const handle = matches[i]?.handle as Partial<PageBarHandle> | undefined
		if (!handle?.pageBar) continue
		return typeof handle.pageBar === "function" ? handle.pageBar({ pathname }) : handle.pageBar
	}
	return null
}
