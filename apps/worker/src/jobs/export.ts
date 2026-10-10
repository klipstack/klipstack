import type { JobPayloads } from "@klipstack/queue"
import type { JobWithMetadata } from "pg-boss"
import { log } from "../log"

export async function handleExport(job: JobWithMetadata<JobPayloads["export"]>) {
	// M3: JSON + Markdown export
	log.info("export (stub)", job.data)
}
