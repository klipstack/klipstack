import { db, eq, pool, user as userTable } from "@klipstack/db"
import { createApiKey } from "../app/services/api-keys.server"

const [email, name = "cli"] = process.argv.slice(2)
if (!email) {
	console.error("usage: pnpm --filter @klipstack/web exec tsx scripts/api-key.ts <email> [name]")
	process.exit(1)
}
const user = await db.query.user.findFirst({ where: eq(userTable.email, email.toLowerCase()) })
if (!user) {
	console.error(`no user with email ${email}`)
	await pool.end()
	process.exit(1)
}
const key = await createApiKey(user.id, name)
console.log(key.raw)
await pool.end()
