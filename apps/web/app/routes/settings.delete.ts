import { redirect } from "react-router"
import { deleteAccount } from "~/commands/account.server"
import { AppError } from "~/lib/app-error"
import { auth } from "~/lib/auth.server"
import { readForm } from "~/lib/request-body.server"
import { cookieHeadersFrom, getSession, requireUser } from "~/lib/session.server"
import { refused } from "~/lib/web-action.server"
import type { Route } from "./+types/settings.delete"

/** POST /settings/delete  (confirmEmail must match). Signs out, deletes, and leaves for the login. */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const confirmEmail = String((await readForm(request)).get("confirmEmail") ?? "")
	// Signed out first: the session goes with the account, and its cookie must go too.
	let signOut: Response | null = null
	try {
		await deleteAccount(user.id, {
			confirmEmail,
			signedInAt: getSession(context)?.session.createdAt,
			beforeDelete: async () => {
				signOut = await auth.api
					.signOut({ headers: request.headers, asResponse: true })
					.catch(() => null)
			},
		})
	} catch (error) {
		if (error instanceof AppError) return refused(error)
		throw error
	}
	throw redirect("/login?deleted=1", {
		headers: signOut ? cookieHeadersFrom((signOut as Response).headers) : undefined,
	})
}

/** The form is Account → Delete account. */
export function loader() {
	throw redirect("/settings/account/delete")
}
