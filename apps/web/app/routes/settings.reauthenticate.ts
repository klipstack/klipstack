import { data, redirect } from "react-router"
import { readForm } from "~/lib/request-body.server"
import { requireUser, signOutHeaders } from "~/lib/session.server"
import type { Route } from "./+types/settings.reauthenticate"

/**
 * POST /settings/reauthenticate  returnTo=<a Settings section, or a page in one>: ends this browser session and goes
 * to login, which returns to that section. For what needs a recent sign-in
 * (`~/lib/recent-sign-in.server`): deleting the account. Nothing refused is carried
 * over: the user repeats it once signed in again.
 */
export async function action({ request, context }: Route.ActionArgs) {
	requireUser(context, request)
	const returnTo = String((await readForm(request)).get("returnTo") ?? "")
	const back = /^\/settings(\/[a-z-]+){1,2}$/.test(returnTo) ? returnTo : "/settings"
	throw redirect(`/login?redirectTo=${encodeURIComponent(back)}`, {
		headers: await signOutHeaders(request),
	})
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
