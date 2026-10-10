import { pool } from "./client"
import { collationProblems } from "./collation"

/** `pnpm db:check-collation`: fails when the database could be corrupted by an OS update. */
async function main() {
	const problems = await collationProblems(pool)
	await pool.end()
	if (problems.length === 0) {
		console.log("collation: stable (builtin provider)")
		return
	}
	for (const problem of problems) console.error(`collation: ${problem}`)
	console.error(
		"An OS or ICU update can reorder this text and corrupt its indexes. Create databases with " +
			"the builtin provider: see docs/self-hosting/postgres-collation.md.",
	)
	process.exit(1)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
