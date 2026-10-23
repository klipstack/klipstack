import { data, redirect } from "react-router"
import { readForm } from "~/lib/request-body.server"
import { confirmPassword, getSession, requireUser, signOutHeaders } from "~/lib/session.server"
import type { Route } from "./+types/settings.reauthenticate"

/**
 * For what needs a recent sign-in (`~/lib/recent-sign-in.server`): an API key, deleting the
 * account. Nothing refused is carried over: the user repeats it once confirmed.
 *
 * POST /settings/reauthenticate  password=…: the signed-in account's own password renews its
 * sign-in in place (`confirmPassword`), without the login page, where anyone could sign in.
 *
 * POST /settings/reauthenticate  returnTo=<a Settings section>: for an account without a password,
 * ends this browser session and goes to login, which returns to that section.
 */
export async function action({ request, context }: Route.ActionArgs) {
	requireUser(context, request)
	const form = await readForm(request)
	const password = form.get("password")
	if (typeof password === "string") {
		const confirmed = await confirmPassword(request, getSession(context)!, password)
		if ("error" in confirmed)
			return data(
				{ ok: false as const, error: confirmed.error },
				{ status: confirmed.error === "limited" ? 429 : 400 },
			)
		return data({ ok: true as const }, { headers: confirmed.headers })
	}
	const returnTo = String(form.get("returnTo") ?? "")
	const back = /^\/settings\/[a-z-]+$/.test(returnTo) ? returnTo : "/settings"
	throw redirect(`/login?redirectTo=${encodeURIComponent(back)}`, {
		headers: await signOutHeaders(request),
	})
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
