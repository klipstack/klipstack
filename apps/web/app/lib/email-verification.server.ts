import { APIError } from "better-auth/api"
import { auth } from "./auth.server"

/** Email the signed-in account its verification link. `headers` carry the session. */
export async function requestEmailVerification(email: string, headers: Headers): Promise<void> {
	await auth.api.sendVerificationEmail({ body: { email }, headers })
}

/**
 * Verify the address the token names. It must be the signed-in account's (auth.server.ts):
 * `wrong-account` otherwise, `invalid` for an expired or damaged token.
 */
export async function verifyEmailToken(
	token: string,
	headers: Headers,
): Promise<"verified" | "wrong-account" | "invalid"> {
	try {
		await auth.api.verifyEmail({ query: { token }, headers })
		return "verified"
	} catch (error) {
		if (!(error instanceof APIError)) throw error
		return error.body?.code === "VERIFICATION_NEEDS_SESSION" ? "wrong-account" : "invalid"
	}
}
