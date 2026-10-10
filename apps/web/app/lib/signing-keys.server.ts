import { db, eq, jwks } from "@klipstack/db"

/**
 * Our OAuth signing key ids. The token verifier fetches our key set (/api/auth/jwks) whenever a
 * token names a key it has not cached, so a token with a made-up `kid` would cost a fetch per
 * request. Tokens are checked against our keys first. A kid not seen yet is looked up by id, a
 * primary-key query, so a key created a moment ago (the first one, or after a rotation) works at
 * once; a list reloaded on a timer refused those for up to its interval.
 */

/** Longer kids are not ours (better-auth's are 36-character ids); skip the lookup. */
const KID_MAX = 128

export type KeyLookup = (kid: string) => Promise<boolean>

const lookupInDb: KeyLookup = async (kid) => {
	const [row] = await db.select({ id: jwks.id }).from(jwks).where(eq(jwks.id, kid)).limit(1)
	return Boolean(row)
}

/** The `kid` in a compact JWS header; null when the token is not one or names no key. */
export function tokenKeyId(token: string): string | null {
	const header = token.split(".")[0]
	if (!header) return null
	try {
		const parsed = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as unknown
		const kid = parsed && typeof parsed === "object" ? (parsed as { kid?: unknown }).kid : null
		return typeof kid === "string" && kid.length > 0 ? kid : null
	} catch {
		return null
	}
}

/** A check that remembers the keys it found; unknown kids are looked up each time. */
export function createSigningKeyCheck(lookup: KeyLookup) {
	const known = new Set<string>()
	return async (token: string): Promise<boolean> => {
		const kid = tokenKeyId(token)
		if (!kid || kid.length > KID_MAX) return false
		if (known.has(kid)) return true
		if (!(await lookup(kid))) return false
		known.add(kid)
		return true
	}
}

/** Whether the token names one of our signing keys. It still has to be verified. */
export const namesKnownSigningKey = createSigningKeyCheck(lookupInDb)
