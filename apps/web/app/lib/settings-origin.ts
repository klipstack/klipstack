import { useEffect } from "react"
import { useLocation, useMatches } from "react-router"
import { useClientValue } from "~/hooks/use-client-value"

/**
 * Where Settings' back button goes: the last app page this tab showed before Settings opened,
 * however it was opened (the account menu, the command menu, a link). Kept per tab, so a reload in
 * Settings still knows it. Without one (Settings opened from an email link), Home.
 */
const KEY = "klip_settings_origin"
const FALLBACK = "/home"

/** Where `/settings` and the links to Settings land: its first section. */
export const SETTINGS_HOME = "/settings/account"

/** The routes whose pages Settings goes back to; not sign-in pages, nor Settings itself. */
const ORIGIN_ROUTES = new Set(["routes/app-layout", "routes/read"])

/** Remembers each app page as it is shown. Called once, from the root. */
export function useRememberSettingsOrigin() {
	const matches = useMatches()
	const { pathname, search } = useLocation()
	const isOrigin = matches.some((match) => ORIGIN_ROUTES.has(match.id))
	useEffect(() => {
		if (!isOrigin) return
		try {
			sessionStorage.setItem(KEY, pathname + search)
		} catch {
			// Storage blocked: the back button goes Home.
		}
	}, [isOrigin, pathname, search])
}

function readOrigin(): string {
	try {
		const value = sessionStorage.getItem(KEY)
		return value?.startsWith("/") && !value.startsWith("//") ? value : FALLBACK
	} catch {
		return FALLBACK
	}
}

/** The page Settings' back button returns to; Home on the server and while hydrating. */
export function useSettingsOrigin(): string {
	return useClientValue(readOrigin, FALLBACK)
}
