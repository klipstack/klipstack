import { APIError } from "better-auth/api"
import { auth } from "./auth.server"
import { oauthApiContext, oauthRedirectUrl } from "./oauth.server"

/**
 * Takes an app's authorization request up again with the session in `cookie` (or the request's):
 * the provider checks it as when the request arrived, and answers where to go next. That is the
 * consent screen, the app, or `VERIFY_TO_CONTINUE_PAGE` (auth-constants) while the email is not
 * verified. Null when the query is refused (tampered or expired).
 */
export async function resumeAuthorization(
	request: Request,
	oauthQuery: string,
	cookie?: string,
): Promise<string | null> {
	const headers = new Headers(request.headers)
	if (cookie) headers.set("cookie", cookie)
	let result: unknown
	try {
		result = await auth.api.oauth2Continue({
			// `postLogin` is the provider's step after the login page: it authorizes the request again.
			body: { postLogin: true, oauth_query: oauthQuery },
			...oauthApiContext(new Request(request.url, { headers })),
		})
	} catch (error) {
		if (!(error instanceof APIError)) throw error
		result = error
	}
	return oauthRedirectUrl(result)
}
