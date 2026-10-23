import {
	CLIENT_HEADER,
	type ClientPlatform,
	isOlder,
	parseClient,
	type Version,
} from "@klipstack/api-contract/client"
import { ApiError } from "./errors.server"

/**
 * The oldest mobile app versions the API still serves. Raise one only after the version that
 * replaces it has been in the store for a while: older apps then get `client_outdated` and ask the
 * user to update. Then the old behavior can go.
 */
export const MIN_CLIENT_VERSIONS: Record<ClientPlatform, Version> = {
	ios: [0, 1, 0],
	android: [0, 1, 0],
}

/**
 * Refuses a mobile app older than its platform's minimum. Requests without the header (the web
 * app, the extension, the CLI, other apps) and with one it cannot read pass.
 */
export function checkClientVersion(
	request: Request,
	minimums: Record<ClientPlatform, Version> = MIN_CLIENT_VERSIONS,
): void {
	const client = parseClient(request.headers.get(CLIENT_HEADER))
	if (!client) return
	const minimum = minimums[client.platform]
	if (isOlder(client.version, minimum))
		throw ApiError.of("client_outdated", "This version of the app is too old. Update it.", {
			details: { minimum: minimum.join(".") },
		})
}
