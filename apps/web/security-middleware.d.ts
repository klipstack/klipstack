import type { IncomingMessage, ServerResponse } from "node:http"
export function securityMiddleware(
	req: IncomingMessage & { ip?: string },
	res: ServerResponse,
	next: () => void,
): void
