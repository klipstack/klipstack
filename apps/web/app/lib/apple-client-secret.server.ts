import { createPrivateKey, sign } from "node:crypto"

/** Apple refuses a client secret that lives longer than six months. */
const LIFETIME_SECONDS = 180 * 24 * 60 * 60
/** A running server signs a new one each day, long before the old one runs out. */
const RENEW_AFTER_SECONDS = 24 * 60 * 60

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")

/**
 * Sign in with Apple's client secret: a JWT (ES256) that our key at Apple signs. `privateKey` is
 * the `.p8` file's PEM, its line breaks written as `\n` on one line, as `.env` holds it. A key that
 * does not parse throws here, at startup.
 */
export function appleClientSecret({
	teamId,
	clientId,
	keyId,
	privateKey,
}: {
	teamId: string
	clientId: string
	keyId: string
	privateKey: string
}): () => string {
	const key = createPrivateKey(privateKey.replaceAll("\\n", "\n"))
	let current: { jwt: string; issuedAt: number } | null = null
	return () => {
		const now = Math.floor(Date.now() / 1000)
		if (current && now - current.issuedAt < RENEW_AFTER_SECONDS) return current.jwt
		const input = `${base64url({ alg: "ES256", kid: keyId })}.${base64url({
			iss: teamId,
			iat: now,
			exp: now + LIFETIME_SECONDS,
			aud: "https://appleid.apple.com",
			sub: clientId,
		})}`
		const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" })
		current = { jwt: `${input}.${signature.toString("base64url")}`, issuedAt: now }
		return current.jwt
	}
}
