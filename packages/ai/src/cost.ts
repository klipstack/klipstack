/**
 * The providers' list prices, in US dollars per million tokens, for the models in `TIERS`. An
 * estimate for admins: the bills themselves are in the providers' consoles. Cache writes are priced as plain
 * input (they cost a quarter more). A request whose prompt is over `long.over` tokens is priced
 * at `long` for all of it.
 */
interface Price {
	input: number
	cacheRead: number
	output: number
	long?: { over: number; input: number; cacheRead: number; output: number }
}

const PRICES: Record<string, Price> = {
	"anthropic:claude-haiku-5-5": {
		input: 0.1,
		cacheRead: 0.01,
		output: 0.5,
		long: { over: 100_000, input: 0.5, cacheRead: 0.05, output: 2.5 },
	},
	// TypeSafe's Jev sorts articles into topics; its output is free.
	"typesafe:jev-1.13.0": { input: 0.042, cacheRead: 0, output: 0 },
	// The fake model costs nobody anything; a price lets the tests see answers priced.
	"fake:fixed": { input: 1, cacheRead: 0.1, output: 1 },
}

export interface TokenCounts {
	/** Every input token of the request, the cached ones included. */
	inputTokens: number
	outputTokens: number
	cacheReadTokens: number
}

/** What one request's tokens cost with `model` (`provider:model`); nothing for one without a price. */
export function estimateCostUsd(model: string | null, tokens: TokenCounts): number {
	const base = model ? PRICES[model] : undefined
	if (!base) return 0
	const price = base.long && tokens.inputTokens > base.long.over ? base.long : base
	const uncached = Math.max(0, tokens.inputTokens - tokens.cacheReadTokens)
	return (
		(uncached * price.input +
			tokens.cacheReadTokens * price.cacheRead +
			tokens.outputTokens * price.output) /
		1_000_000
	)
}
