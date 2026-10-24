import { data, redirect } from "react-router"
import { requireAdminAction, safeAdminPath } from "~/lib/admin.server"
import { confirmPassword, getSession } from "~/lib/session.server"
import type { Route } from "./+types/admin.reauthenticate"

const NO_STORE = "private, no-store"

/**
 * POST /admin/reauthenticate  password=…&returnTo=…: the signed-in admin's own password renews
 * their sign-in in place (`confirmPassword`), without the login page, where anyone could sign in.
 * Then back to `returnTo`, a path inside /admin: the navigation also clears a refused change's
 * error page. The one admin action an older session may use (it is how that session recovers).
 * It carries no mutation with it: whatever was refused stays undone until the admin repeats it.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const { form } = await requireAdminAction(context, request, { recentSignIn: false })
	// requireAdminAction has authorized this session.
	const confirmed = await confirmPassword(
		request,
		getSession(context)!,
		String(form.get("password") ?? ""),
		String(form.get("code") ?? ""),
	)
	if ("error" in confirmed)
		return data(
			{ ok: false as const, error: confirmed.error },
			{ status: confirmed.error === "limited" ? 429 : 400, headers: { "Cache-Control": NO_STORE } },
		)
	confirmed.headers.set("Cache-Control", NO_STORE)
	const returnTo = form.get("returnTo")
	throw redirect(safeAdminPath(typeof returnTo === "string" ? returnTo : null), {
		headers: confirmed.headers,
	})
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
