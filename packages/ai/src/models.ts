import { createAnthropic } from "@ai-sdk/anthropic"
import type { LanguageModel } from "ai"
import type { AiTier } from "./types"

/**
 * Where each tier goes: the one place that names providers and models. Another provider is a
 * case in `languageModel` and an `@ai-sdk/*` dependency; another model is a line here and its
 * price in `cost.ts`.
 */
export const TIERS: Record<
	AiTier,
	{ provider: "anthropic"; model: string; maxOutputTokens: number }
> = {
	quick: { provider: "anthropic", model: "claude-haiku-5-5", maxOutputTokens: 2048 },
	deep: { provider: "anthropic", model: "claude-haiku-5-5", maxOutputTokens: 4096 },
}

export interface AiConfig {
	anthropicApiKey?: string
	/** A fixed answer instead of a provider, for tests and local work without a key. */
	fake?: boolean
	/** For tests: what the provider's client sends requests with. */
	fetch?: typeof fetch
}

export function isConfigured(config: AiConfig): boolean {
	return !!config.fake || !!config.anthropicApiKey
}

/** The model for a tier, and its name as `provider:model`. */
export function languageModel(
	config: AiConfig,
	tier: AiTier,
	fake: () => LanguageModel,
): { model: LanguageModel; name: string } {
	if (config.fake) return { model: fake(), name: "fake:fixed" }
	const { provider, model } = TIERS[tier]
	switch (provider) {
		case "anthropic": {
			if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not set")
			const anthropic = createAnthropic({ apiKey: config.anthropicApiKey, fetch: config.fetch })
			return { model: anthropic(model), name: `anthropic:${model}` }
		}
	}
}
