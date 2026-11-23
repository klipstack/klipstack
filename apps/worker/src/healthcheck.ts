import { checkHealth } from "./health"

/**
 * The worker container's health check: exits 0 when the worker's heartbeat reached the database
 * recently, 1 otherwise. Run inside the container: `node --import tsx src/healthcheck.ts`.
 */
const health = await checkHealth()
if (!health.ok) console.error(`worker unhealthy: ${health.reason}`)
process.exit(health.ok ? 0 : 1)
