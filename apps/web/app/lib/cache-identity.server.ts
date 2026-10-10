import { createHmac } from "node:crypto"
import { env } from "./env.server"

/** A cache partition identifier, never a session credential. */
export function cacheIdentity(sessionId: string | undefined) {
	return sessionId
		? createHmac("sha256", env.BETTER_AUTH_SECRET).update(`offline:${sessionId}`).digest("hex")
		: "none"
}
