import { endpoints, type getOpenApi } from "@klipstack/api-contract"
import { appVersion, env } from "~/lib/env.server"
import type { Handler } from "../handler.server"
import { buildOpenApiDocument } from "../openapi.server"

let document: Record<string, unknown> | undefined

export const openapi: Handler<typeof getOpenApi> = async () => {
	document ??= buildOpenApiDocument({
		endpoints,
		serverUrl: new URL("/api/v1", env.APP_URL).href,
		version: appVersion,
	})
	return document
}
