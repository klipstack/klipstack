import { useRouteLoaderData } from "react-router"
import type { loader as layoutLoader } from "~/routes/app-layout"

/**
 * Editions are turned on for the account (Settings → Features): the ways to mark an article for the
 * next edition show only then. Pages outside the app's layout (the reader) say it themselves.
 */
export function useEditions(): boolean {
	return useRouteLoaderData<typeof layoutLoader>("routes/app-layout")?.editions ?? false
}
