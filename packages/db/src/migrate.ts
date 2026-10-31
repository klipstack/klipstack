import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { createPool } from "./client"
import { collationProblems } from "./collation"

// A pool of its own, without the app's limits: a migration may rewrite a large table, or wait for
// the app's transactions to let go of one.
const pool = createPool({ max: 1, timeouts: null })
const db = drizzle({ client: pool })

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
