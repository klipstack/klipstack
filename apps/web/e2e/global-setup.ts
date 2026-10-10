import { pool } from "@klipstack/db"
import { cleanE2eData } from "./cleanup"
import { resetLocalIpLimit } from "./helpers"

const STALE_MS = 60 * 60 * 1000

/**
 * Keeps the local database from filling up with test accounts. Before the run: whatever runs that
 * were interrupted left behind, if it is over an hour old (a run in another session is younger).
 * After the run, passed or failed: everything this run created.
 */
export default async function globalSetup() {
	const startedAt = new Date()
	await cleanE2eData({ before: new Date(startedAt.getTime() - STALE_MS) })
	// Every browser test comes from localhost, and the per-IP auth limits last 15 minutes: without
	// this, a few runs in a row fail on the limits instead of on the code. (Sign-up resets its own
	// counter for each invite, see helpers.ts.)
	for (const path of [
		"/sign-in/email",
		"/sign-in/magic-link",
		"/request-password-reset",
		"/send-verification-email",
	])
		await resetLocalIpLimit(path)
	return async () => {
		try {
			await cleanE2eData({ since: startedAt })
		} finally {
			await pool.end()
		}
	}
}
