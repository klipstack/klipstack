/**
 * What a mutation answers when its request never reached the server: a refusal like the server's
 * (`WebResult`), with the code `network`, which only the page uses.
 */
export const NETWORK_FAILURE = {
	ok: false,
	error: { code: "network", message: "The request did not reach Klipstack." },
} as const

/**
 * A fetcher whose request fails on the network (offline, a dropped connection) sends the error
 * to the route's error boundary, which replaces the page: reading a cached article offline, the
 * first progress save would end the reading. For a route's `clientAction`: such a failure answers
 * `NETWORK_FAILURE` instead, and the optimistic state falls back. `fetch` rejects with a
 * TypeError only when nothing came back; an error response still goes through.
 */
export async function answerNetworkFailure<T>(
	serverAction: () => Promise<T>,
): Promise<T | typeof NETWORK_FAILURE> {
	try {
		return await serverAction()
	} catch (error) {
		if (error instanceof TypeError) return NETWORK_FAILURE
		throw error
	}
}
