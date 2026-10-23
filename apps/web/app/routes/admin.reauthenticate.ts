import { APIError } from "better-auth/api"
import { data, redirect } from "react-router"
import { requireAdminAction, safeAdminPath } from "~/lib/admin.server"
import { confirmPassword, getSession } from "~/lib/session.server"
import type { Route } from "./+types/admin.reauthenticate"

const NO_STORE = { "Cache-Control": "private, no-store" }

/**
 * POST /admin/reauthenticate  password=…&returnTo=…: the signed-in admin's own password renews
 * their sign-in in place (`confirmPassword`), without the login page, where anyone could sign in.
 * Then back to `returnTo`, a path inside /admin: the navigation also clears a refused change's
 * error page. The one admin action an older session may use (it is how that session recovers).
 * It carries no mutation with it: whatever was refused stays undone until the admin repeats it.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const { form } = await requireAdminAction(context, request, { recentSignIn: false })
	let headers: Headers
	try {
		// requireAdminAction has authorized this session.
		headers = await confirmPassword(
			request,
			getSession(context)!,
			String(form.get("password") ?? ""),
		)
	} catch (error) {
		if (!(error instanceof APIError)) throw error
		const limited = error.statusCode === 429
		return data(
			{ ok: false as const, error: limited ? ("limited" as const) : ("wrong-password" as const) },
			{ status: limited ? 429 : 400, headers: NO_STORE },
		)
	}
	headers.set("Cache-Control", NO_STORE["Cache-Control"])
	const returnTo = form.get("returnTo")
	throw redirect(safeAdminPath(typeof returnTo === "string" ? returnTo : null), { headers })
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
