import { describe, expect, it } from "vitest"
import { estimateCostUsd } from "./cost"
import { TIERS } from "./models"

describe("estimateCostUsd", () => {
	it("prices input, cached input and output at the model's rates", () => {
		// 10K of each: input less the cached part at $0.10 a million, cached at $0.01, output at $0.50.
		expect(
			estimateCostUsd("anthropic:claude-haiku-5-5", {
				inputTokens: 20_000,
				cacheReadTokens: 10_000,
				outputTokens: 10_000,
			}),
		).toBeCloseTo(0.001 + 0.0001 + 0.005, 10)
	})

	it("prices a request over 100K tokens of prompt at the long-prompt rates, all of it", () => {
		expect(
			estimateCostUsd("anthropic:claude-haiku-5-5", {
				inputTokens: 100_000,
				cacheReadTokens: 0,
				outputTokens: 0,
			}),
		).toBeCloseTo(0.01, 10)
		// $0.50 a million past the line: 200K tokens, half of them cached at $0.05.
		expect(
			estimateCostUsd("anthropic:claude-haiku-5-5", {
				inputTokens: 200_000,
				cacheReadTokens: 100_000,
				outputTokens: 1000,
			}),
		).toBeCloseTo(0.05 + 0.005 + 0.0025, 10)
	})

	it("knows the price of every model a tier uses", () => {
		for (const { provider, model } of Object.values(TIERS))
			expect(
				estimateCostUsd(`${provider}:${model}`, {
					inputTokens: 1000,
					outputTokens: 0,
					cacheReadTokens: 0,
				}),
			).toBeGreaterThan(0)
	})

	it("costs nothing for a model it does not know", () => {
		const usage = { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0 }
		expect(estimateCostUsd("other:model", usage)).toBe(0)
		expect(estimateCostUsd(null, usage)).toBe(0)
	})
})
