import { data } from "react-router"
import { readForm } from "~/lib/request-body.server"
import { confirmPassword, getSession, requireUser } from "~/lib/session.server"
import type { Route } from "./+types/settings.confirm-password"

/**
 * POST /settings/confirm-password  password=…: for what needs a recent sign-in
 * (`~/lib/recent-sign-in.server`), the signed-in account's own password renews its sign-in in place
 * (`confirmPassword`), without the login page, where anyone could sign in. Nothing refused is
 * carried over: the user repeats it. Accounts without a password use /settings/reauthenticate.
 * Not a sign-out, so the service worker keeps its caches (public/sw.js, `authChange`).
 */
export async function action({ request, context }: Route.ActionArgs) {
	requireUser(context, request)
	const form = await readForm(request)
	const confirmed = await confirmPassword(
		request,
		getSession(context)!,
		String(form.get("password") ?? ""),
		String(form.get("code") ?? ""),
	)
	if ("error" in confirmed)
		return data(
			{ ok: false as const, error: confirmed.error },
			{ status: confirmed.error === "limited" ? 429 : 400 },
		)
	return data({ ok: true as const }, { headers: confirmed.headers })
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
