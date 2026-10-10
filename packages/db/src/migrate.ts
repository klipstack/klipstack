import { migrate } from "drizzle-orm/node-postgres/migrator"
import { db, pool } from "./client"
import { collationProblems } from "./collation"

async function main() {
	await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname })
	console.log("migrations applied")
	// A warning, not a failure: production moves to the builtin provider by a planned migration.
	for (const problem of await collationProblems(pool)) {
		console.warn(`warning: ${problem}. See docs/self-hosting/postgres-collation.md.`)
	}
	await pool.end()
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
