import { useSyncExternalStore } from "react"
import { useRouteLoaderData } from "react-router"

/**
 * The desktop sidebar: its width, and whether it is folded to a rail of icons. Kept on the device
 * (a cookie, so the server renders the right width straight away), not on the account: a laptop
 * and a wide screen want different things. Phones always get the full drawer.
 *
 * One cookie holds both: `klip_sidebar=280` (open, 280px wide) or `klip_sidebar=rail.280` (folded,
 * and 280px again once opened).
 */
export const SIDEBAR_COOKIE = "klip_sidebar"
export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 360
export const SIDEBAR_DEFAULT = 240

export interface SidebarState {
	collapsed: boolean
	width: number
}

const DEFAULT_STATE: SidebarState = { collapsed: false, width: SIDEBAR_DEFAULT }

export const clampSidebarWidth = (width: number) =>
	Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)))

export function parseSidebarCookie(cookieHeader: string | null | undefined): SidebarState {
	const value = /(?:^|;\s*)klip_sidebar=([^;]*)/.exec(cookieHeader ?? "")?.[1]
	if (!value) return DEFAULT_STATE
	const match = /^(rail)?\.?(\d+)?$/.exec(value)
	if (!match) return DEFAULT_STATE
	return {
		collapsed: Boolean(match[1]),
		width: match[2] ? clampSidebarWidth(Number(match[2])) : SIDEBAR_DEFAULT,
	}
}

const listeners = new Set<() => void>()
let cached: { raw: string; state: SidebarState } | null = null

function readClient(): SidebarState {
	const raw = typeof document === "undefined" ? "" : document.cookie
	// A stable object per cookie value: useSyncExternalStore compares snapshots by identity.
	if (cached?.raw !== raw) cached = { raw, state: parseSidebarCookie(raw) }
	return cached.state
}

export function setSidebar(next: Partial<SidebarState>) {
	const current = readClient()
	const collapsed = next.collapsed ?? current.collapsed
	const width = clampSidebarWidth(next.width ?? current.width)
	// oxlint-disable-next-line unicorn/no-document-cookie -- a single first-party cookie, no library needed
	document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "rail." : ""}${width}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
	for (const listener of listeners) listener()
}

/** The sidebar's state; the server-rendered value keeps hydration consistent. */
export function useSidebar(): SidebarState {
	const root = useRouteLoaderData("root") as { sidebar?: SidebarState } | undefined
	const server = root?.sidebar ?? DEFAULT_STATE
	return useSyncExternalStore(
		(onChange) => {
			listeners.add(onChange)
			return () => listeners.delete(onChange)
		},
		readClient,
		() => server,
	)
}
