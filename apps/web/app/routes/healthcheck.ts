import { db, sql } from "@klipstack/db"
import { logError } from "@klipstack/log"

export async function loader() {
	try {
		await db.execute(sql`select 1`)
		return new Response("ok", { status: 200 })
	} catch (error) {
		logError("[healthcheck] database unavailable", error)
		return new Response("db unavailable", { status: 503 })
	}
}
