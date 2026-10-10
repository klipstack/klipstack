import { createHmac, timingSafeEqual } from "node:crypto"
import { env } from "./env.server"

/** Long past the toast that offers it; short enough that an old one is refused. */
export const UNDO_TTL_MS = 15 * 60_000

/**
 * What an undo writes back, carried by the page and signed here: the server takes back only what
 * it gave, to the user it gave it to, for a while. Base64url JSON, a dot, and its HMAC.
 */
export function signUndo(userId: string, payload: unknown, now = Date.now()): string {
	const body = Buffer.from(JSON.stringify({ u: userId, t: now, p: payload })).toString("base64url")
	return `${body}.${mac(body)}`
}

/** The payload, or null when the token is not one this server signed for this user, or too old. */
export function readUndo<T>(userId: string, token: string, now = Date.now()): T | null {
	const [body, sig, extra] = token.split(".")
	if (!body || !sig || extra !== undefined) return null
	const expected = Buffer.from(mac(body))
	const given = Buffer.from(sig)
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
	try {
		const { u, t, p } = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
			u: unknown
			t: unknown
			p: T
		}
		if (u !== userId || typeof t !== "number" || now - t > UNDO_TTL_MS || t > now + 60_000)
			return null
		return p
	} catch {
		return null
	}
}

const mac = (body: string) =>
	createHmac("sha256", env.BETTER_AUTH_SECRET).update(`undo:${body}`).digest("base64url")
