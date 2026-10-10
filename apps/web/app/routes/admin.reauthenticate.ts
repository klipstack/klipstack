import { data, redirect } from "react-router"
import { requireAdminAction, safeAdminPath } from "~/lib/admin.server"
import { signOutHeaders } from "~/lib/session.server"
import type { Route } from "./+types/admin.reauthenticate"

/**
 * POST /admin/reauthenticate: ends this browser session and goes to login, which returns to a path
 * inside /admin. The one admin action an older session may use (it is how that session recovers).
 * It carries no mutation with it: whatever was refused stays undone until the admin repeats it.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const { form } = await requireAdminAction(context, request, { recentSignIn: false })
	const returnTo = form.get("returnTo")
	const back = safeAdminPath(typeof returnTo === "string" ? returnTo : null)
	throw redirect(`/login?redirectTo=${encodeURIComponent(back)}`, {
		headers: await signOutHeaders(request),
	})
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
