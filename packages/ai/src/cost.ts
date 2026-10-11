/**
 * Anthropic's list prices, in US dollars per million tokens, for the models in `TIERS`. An
 * estimate for admins: the bill itself is in Anthropic's console. Cache writes are priced as plain
 * input (they cost a quarter more), and Haiku's higher price past 100K tokens of prompt is left
 * out, so a month with very long articles costs a little more than this says.
 */
const PRICES: Record<string, { input: number; cacheRead: number; output: number }> = {
	"anthropic:claude-haiku-5-5": { input: 0.1, cacheRead: 0.01, output: 0.5 },
}

export interface TokenCounts {
	/** Every input token, the cached ones included. */
	inputTokens: number
	outputTokens: number
	cacheReadTokens: number
}

/** What these tokens cost with `model` (`provider:model`); nothing for one without a price. */
export function estimateCostUsd(model: string | null, tokens: TokenCounts): number {
	const price = model ? PRICES[model] : undefined
	if (!price) return 0
	const uncached = Math.max(0, tokens.inputTokens - tokens.cacheReadTokens)
	return (
		(uncached * price.input +
			tokens.cacheReadTokens * price.cacheRead +
			tokens.outputTokens * price.output) /
		1_000_000
	)
}
