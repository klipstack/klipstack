// Runs the trash purge right now (the worker also runs it daily). Usage: pnpm --filter @klipstack/worker purge
import { loadEnv, pool } from "@klipstack/db"
import { handlePurge } from "../src/jobs/purge"

loadEnv()
await handlePurge()
await pool.end()
