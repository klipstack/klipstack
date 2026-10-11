import { describe, expect, it } from "vitest"
import { estimateCostUsd } from "./cost"
import { TIERS } from "./models"

describe("estimateCostUsd", () => {
	it("prices input, cached input and output at the model's rates", () => {
		// A million of each: $0.10 input less the cached part, $0.01 cached, $0.50 output.
		expect(
			estimateCostUsd("anthropic:claude-haiku-5-5", {
				inputTokens: 2_000_000,
				cacheReadTokens: 1_000_000,
				outputTokens: 1_000_000,
			}),
		).toBeCloseTo(0.1 + 0.01 + 0.5, 10)
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

	it("costs nothing for the fake model, or a model it does not know", () => {
		const usage = { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0 }
		expect(estimateCostUsd("fake:fixed", usage)).toBe(0)
		expect(estimateCostUsd(null, usage)).toBe(0)
	})
})
