import { publicStatus } from "~/services/status.server"

/** For the uptime monitor: one word and a status code, nothing about the system behind them. */
export async function loader() {
	const status = await publicStatus()
	return new Response(status, {
		status: status === "ok" ? 200 : 503,
		headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
	})
}
