// Production server. TRUST_PROXY must name the actual TLS proxy addresses (loopback by default).
// This supplies the correct request origin for CSRF checks and client IP for authentication limits.
// Keep the web port private to that proxy; never accept arbitrary forwarding headers.
import { createRequestHandler } from "@react-router/express"
import compression from "compression"
import express from "express"
import morgan from "morgan"
import { securityMiddleware } from "./security-middleware.js"

const build = await import("./build/server/index.js")
const port = Number(process.env.PORT ?? 3000)

const app = express()
app.set("trust proxy", process.env.TRUST_PROXY || "loopback")
app.disable("x-powered-by")
app.use(securityMiddleware)
app.use(compression())
app.use("/assets", express.static("build/client/assets", { immutable: true, maxAge: "1y" }))
app.use(express.static("build/client", { maxAge: "1h" }))
// Like morgan's "tiny", without query strings: they carry search terms, signed OAuth requests,
// codes and saved URLs.
morgan.token("safe-url", (req) => (req.originalUrl ?? req.url ?? "").split(/[?#]/)[0])
app.use(morgan(":method :safe-url :status :res[content-length] - :response-time ms"))
// The app sets Referrer-Policy on its own responses: a public edition sends the origin to the sites
// it links to. The adapter appends headers rather than replacing them, so securityMiddleware's
// value goes first, or the page would carry both. Files served above keep it.
const handleRequest = createRequestHandler({ build, mode: process.env.NODE_ENV })
app.all("/{*splat}", (req, res, next) => {
	res.removeHeader("Referrer-Policy")
	return handleRequest(req, res, next)
})

const server = app.listen(port, () => console.log(`[web] listening on :${port}`))
server.headersTimeout = 15_000
server.requestTimeout = 120_000

// Stop within a few seconds (docker stop waits 10): refuse new connections, let requests finish,
// cut the live-update streams (they never end on their own), close the database, exit.
let stopping = false
function stop(signal) {
	if (stopping) process.exit(1)
	stopping = true
	console.log(`[web] ${signal}: stopping`)
	setTimeout(() => server.closeAllConnections(), 3_000).unref()
	setTimeout(() => process.exit(0), 8_000).unref()
	server.close(async () => {
		try {
			await build.entry.module.shutdown?.()
		} catch (error) {
			console.error("[web] shutdown failed:", error?.name ?? typeof error)
		}
		process.exit(0)
	})
	server.closeIdleConnections()
}
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => stop(signal))
