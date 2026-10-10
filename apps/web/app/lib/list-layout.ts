import { useSyncExternalStore } from "react"
import { useRouteLoaderData } from "react-router"

/**
 * List views render as a vertical list or a grid of cards. The choice is kept on the device (a
 * cookie, so the server renders it right away), not on the account: phones and desktops want
 * different things. Without a choice, CSS decides by viewport: grid on phones, list otherwise.
 * Logging out clears it.
 */
export type ListLayout = "list" | "grid"
export type LayoutPref = ListLayout | "auto"

export const LAYOUT_COOKIE = "klip_layout"

export function parseLayoutCookie(cookieHeader: string | null | undefined): LayoutPref {
	const match = /(?:^|;\s*)klip_layout=(list|grid)(?:;|$)/.exec(cookieHeader ?? "")
	return (match?.[1] as ListLayout | undefined) ?? "auto"
}

const listeners = new Set<() => void>()

function readClient(): LayoutPref {
	return parseLayoutCookie(typeof document === "undefined" ? "" : document.cookie)
}

export function setListLayout(layout: ListLayout) {
	// oxlint-disable-next-line unicorn/no-document-cookie -- a single first-party cookie, no library needed
	document.cookie = `${LAYOUT_COOKIE}=${layout}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
	for (const l of listeners) l()
}

/** Current preference; the server-rendered value (root loader) keeps hydration consistent. */
export function useListLayout(): LayoutPref {
	const root = useRouteLoaderData("root") as { layout?: LayoutPref } | undefined
	const server = root?.layout ?? "auto"
	return useSyncExternalStore(
		(onChange) => {
			listeners.add(onChange)
			return () => listeners.delete(onChange)
		},
		readClient,
		() => server,
	)
}
