import { redirect } from "react-router"
import { verifyEmailToken } from "~/lib/email-verification.server"
import { requireUser } from "~/lib/session.server"
import type { Route } from "./+types/verify-email"

/**
 * Where the verification email leads. Signed out, the visitor logs in first and comes back here:
 * the link alone verifies nothing.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	if (user.emailVerified) throw redirect("/settings/account")
	const token = new URL(request.url).searchParams.get("token")
	const result = token ? await verifyEmailToken(token, request.headers) : "invalid"
	if (result === "verified") throw redirect("/settings/account")
	throw redirect(`/settings/account?error=${result}`)
}
