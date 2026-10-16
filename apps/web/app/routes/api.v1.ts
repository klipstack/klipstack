import { endpoints } from "@klipstack/api-contract"
import { authenticateApiRequest } from "~/api/auth.server"
import { checkClientVersion } from "~/api/client-version.server"
import { handlers } from "~/api/handlers/index.server"
import { createApiRouter } from "~/api/router.server"
import { env } from "~/lib/env.server"
import { API_LIMIT, peekRateLimit, rateLimit, SAVE_LIMIT } from "~/lib/rate-limit.server"
import type { Route } from "./+types/api.v1"

/**
 * /api/v1/* — the HTTP API. Every endpoint is dispatched from the contract's route table; bearer
 * tokens only, never cookies.
 */
const router = createApiRouter({
	endpoints,
	handlers,
	authenticate: authenticateApiRequest,
	checkClient: checkClientVersion,
	rateLimit: (userId) => rateLimit(`api:${userId}`, API_LIMIT.limit, API_LIMIT.windowMs),
	// Saves and follows count together with the web app, the extension and MCP. One past the
	// limit is refused before its body is read; the command counts it.
	limits: {
		"articles.save": (userId) =>
			peekRateLimit(`save:${userId}`, SAVE_LIMIT.limit, SAVE_LIMIT.windowMs),
		// A retry fetches the page again: a save.
		"articles.retry": (userId) =>
			peekRateLimit(`save:${userId}`, SAVE_LIMIT.limit, SAVE_LIMIT.windowMs),
		"feeds.follow": (userId) =>
			peekRateLimit(`subscribe:${userId}`, SAVE_LIMIT.limit, SAVE_LIMIT.windowMs),
	},
	checkResponses: env.NODE_ENV !== "production" || env.API_CHECK_RESPONSES === "1",
})

export function loader({ request }: Route.LoaderArgs) {
	return router.handle(request)
}

export function action({ request }: Route.ActionArgs) {
	return router.handle(request)
}
