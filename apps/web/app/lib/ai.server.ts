import { createAi } from "@klipstack/ai"
import { env } from "./env.server"

/** The AI module, set up from the env. */
export const ai = createAi({
	anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
	fake: env.AI_FAKE === "1",
})

/** Questions per account in a short window, on top of the monthly cap: stops a runaway client. */
export const AI_RATE_LIMIT = { limit: 30, windowMs: 5 * 60 * 1000 }
