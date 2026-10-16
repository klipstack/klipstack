import { redirect } from "react-router"
import { saveLinkPath } from "~/components/save-link-dialog"
import { requireUser } from "~/lib/session.server"
import type { Route } from "./+types/add"

/** Pull a URL out of share-target params: `url`, or the first http(s) link inside `text`/`title`. */
export function sharedUrl(params: URLSearchParams): string | null {
	const direct = params.get("url")?.trim()
	if (direct && /^https?:\/\//i.test(direct)) return direct
	for (const key of ["text", "title", "url"]) {
		const match = /https?:\/\/[^\s<>"']+/i.exec(params.get(key) ?? "")
		if (match) return match[0]
	}
	return null
}

/**
 * The address the bookmarklet and the phone's share sheet send a link to: the library, with the
 * Save link dialog open and the link in it. Saving takes the dialog's explicit POST, so a link
 * from another site saves nothing by itself.
 */
export function loader({ context, request }: Route.LoaderArgs) {
	requireUser(context, request)
	throw redirect(saveLinkPath(sharedUrl(new URL(request.url).searchParams) ?? ""))
}
