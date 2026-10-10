import { auth } from "~/lib/auth.server"
import type { Route } from "./+types/well-known.oauth-protected-resource"

// RFC 9728 metadata for /mcp (at /.well-known/oauth-protected-resource/mcp and the root alias).
// The MCP auth plugin serves it from the auth handler, which is otherwise mounted at /api/auth.
export async function loader({ request }: Route.LoaderArgs) {
	const response = await auth.handler(request)
	const headers = new Headers(response.headers)
	headers.set("Access-Control-Allow-Origin", "*")
	return new Response(response.body, { status: response.status, headers })
}
