import { pool } from "@klipstack/db"
import { cleanE2eData } from "./cleanup"

/** `pnpm --filter @klipstack/web e2e:clean`: removes every browser-test leftover, of any age. */
try {
	console.log(await cleanE2eData())
} finally {
	await pool.end()
}
