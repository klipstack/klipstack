import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createAnthropic } from "@ai-sdk/anthropic"
import { type DecisionQuestion, decide, decisionBody } from "@klipstack/ai"
import { generateText, Output } from "ai"
import type { z } from "zod"

/** Prices per million tokens, for the report. Jev's output is free. */
export const PRICES = {
	haiku: { model: "claude-haiku-5-5", input: 0.1, output: 0.5 },
	jev: { model: "jev-1.13.0", input: 0.042, output: 0 },
} as const

export type Provider = keyof typeof PRICES

/** One call to a model, as the run's ledger keeps it. */
export interface CallRecord {
	provider: Provider
	purpose: string
	inputTokens: number
	outputTokens: number
	/** How long the call took when it was made; a cached answer keeps the original time. */
	ms: number
	cached: boolean
	cost: number
}

/**
 * Every answer is kept on disk, keyed by the exact request: a rerun replays the same history for
 * free, and only a request that changed reaches a model.
 */
export class Models {
	readonly calls: CallRecord[] = []

	constructor(
		private readonly cacheDir: string,
		private readonly keys: { anthropic?: string; typesafe?: string },
	) {}

	private async cached<T>(
		provider: Provider,
		purpose: string,
		request: unknown,
		call: () => Promise<{ value: T; inputTokens: number; outputTokens: number }>,
	): Promise<T> {
		const key = createHash("sha256").update(JSON.stringify({ provider, request })).digest("hex")
		const file = join(this.cacheDir, `${key}.json`)
		let entry: { value: T; inputTokens: number; outputTokens: number; ms: number }
		let cached = true
		try {
			entry = JSON.parse(await readFile(file, "utf8"))
		} catch {
			cached = false
			const started = performance.now()
			const result = await withRetry(call)
			entry = { ...result, ms: Math.round(performance.now() - started) }
			await mkdir(this.cacheDir, { recursive: true })
			await writeFile(file, JSON.stringify(entry))
		}
		const price = PRICES[provider]
		this.calls.push({
			provider,
			purpose,
			inputTokens: entry.inputTokens,
			outputTokens: entry.outputTokens,
			ms: entry.ms,
			cached,
			cost: (entry.inputTokens * price.input + entry.outputTokens * price.output) / 1e6,
		})
		return entry.value
	}

	/** A structured answer from Haiku. */
	async haiku<S extends z.ZodType>(
		purpose: string,
		input: { system: string; prompt: string; schema: S; sample?: number },
	): Promise<z.infer<S>> {
		const request = {
			model: PRICES.haiku.model,
			system: input.system,
			prompt: input.prompt,
			schema: input.schema.toJSONSchema(),
			// Only in the cache key: another sample asks again.
			...(input.sample ? { sample: input.sample } : {}),
		}
		return this.cached("haiku", purpose, request, async () => {
			if (!this.keys.anthropic) throw notRetryable("ANTHROPIC_API_KEY is not set")
			const anthropic = createAnthropic({ apiKey: this.keys.anthropic })
			const result = await generateText({
				model: anthropic(PRICES.haiku.model),
				maxOutputTokens: 16000,
				system: input.system,
				prompt: input.prompt,
				output: Output.object({ schema: input.schema }),
			})
			return {
				value: result.output as z.infer<S>,
				inputTokens: result.usage.inputTokens ?? 0,
				outputTokens: result.usage.outputTokens ?? 0,
			}
		})
	}

	/**
	 * Yes/no questions to Jev about one text, answered in one pass: the probability of yes for each.
	 */
	async jev(
		purpose: string,
		state: string,
		questions: Record<string, DecisionQuestion>,
	): Promise<Record<string, number>> {
		return this.cached("jev", purpose, decisionBody(state, questions), async () => {
			if (!this.keys.typesafe) throw notRetryable("TYPESAFE_API_KEY is not set")
			const result = await decide({ apiKey: this.keys.typesafe }, state, questions)
			return { value: result.answers, ...result.usage }
		})
	}
}

function notRetryable(message: string): Error {
	return Object.assign(new Error(message), { retryable: false })
}

async function withRetry<T>(call: () => Promise<T>): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await call()
		} catch (error) {
			// A key that is missing, or a request Jev refused (DecisionError), will not work later.
			const retryable = (error as { retryable?: boolean }).retryable !== false
			if (attempt >= 4 || !retryable) throw error
			await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
		}
	}
}
