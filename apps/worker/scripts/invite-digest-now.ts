// Sends the wait list digest right now (the worker also sends it daily, at 08:00 UTC).
// Usage: pnpm --filter @klipstack/worker invite-digest
import { loadEnv, pool } from "@klipstack/db"
import { handleInviteDigest } from "../src/jobs/invite-digest"

loadEnv()
console.log(await handleInviteDigest())
await pool.end()
