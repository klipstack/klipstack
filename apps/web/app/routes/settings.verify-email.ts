import { APIError } from "better-auth/api"
import { data } from "react-router"
import { requestEmailVerification } from "~/lib/email-verification.server"
import { emailEnabled } from "~/lib/email.server"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import type { Route } from "./+types/settings.verify-email"

/** Only the signed-in account can request its verification email. */
export async function action({ context, request }: Route.ActionArgs) {
	const user = requireUser(context, request)
	await readForm(request)
	if (user.emailVerified) return { result: "verified" as const }
	if (!emailEnabled) return data({ result: "unavailable" as const }, { status: 503 })
	try {
		await requestEmailVerification(user.email, request.headers)
	} catch (error) {
		if (error instanceof APIError && error.statusCode === 429) {
			const retryAfter = new Headers(error.headers).get("Retry-After") ?? "900"
			return data(
				{ result: "limited" as const, minutes: Math.max(1, Math.ceil(Number(retryAfter) / 60)) },
				{ status: 429, headers: { "Retry-After": retryAfter } },
			)
		}
		return data({ result: "failed" as const }, { status: 503 })
	}
	return { result: "sent" as const }
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
