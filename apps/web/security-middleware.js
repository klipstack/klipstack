import { createHmac } from "node:crypto"

/** Only the server can supply the client identity consumed by authentication throttles. */
export function securityMiddleware(req, res, next) {
	const address = req.ip ?? req.socket.remoteAddress ?? "unknown"
	req.headers["x-klipstack-client-ip"] = address
	req.headers["x-klipstack-client-signature"] = createHmac(
		"sha256",
		process.env.BETTER_AUTH_SECRET || "dev-secret-not-for-production",
	)
		.update(address)
		.digest("hex")
	res.setHeader("X-Content-Type-Options", "nosniff")
	res.setHeader("X-Frame-Options", "DENY")
	res.setHeader("Referrer-Policy", "same-origin")
	// Production is HTTPS only (Caddy): browsers then never try plain HTTP, where someone on the
	// same network could intercept a first visit. Development serves plain HTTP.
	if (process.env.NODE_ENV === "production")
		res.setHeader("Strict-Transport-Security", "max-age=31536000")
	next()
}
