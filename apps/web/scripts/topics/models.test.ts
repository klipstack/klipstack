import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Models } from "./models"

const question = { instructions: "Is it about cats?", yes: "yes", no: "no" }

describe("the models' answer cache", () => {
	let dir: string
	const fetch = vi.fn(
		async () =>
			new Response(
				JSON.stringify({
					answers: { cats: { noul: 0.8 } },
					usage: { input_tokens: 100, output_tokens: 0 },
				}),
			),
	)

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "topics-cache-"))
		fetch.mockClear()
		vi.stubGlobal("fetch", fetch)
	})
	afterEach(async () => {
		vi.unstubAllGlobals()
		await rm(dir, { recursive: true, force: true })
	})

	it("asks Jev once for a request, and replays the answer in a later run", async () => {
		const first = new Models(dir, { typesafe: "test-key" })
		expect(await first.jev("sort", "An article", { cats: question })).toEqual({ cats: 0.8 })
		expect(await first.jev("sort", "An article", { cats: question })).toEqual({ cats: 0.8 })
		const later = new Models(dir, {})
		expect(await later.jev("sort", "An article", { cats: question })).toEqual({ cats: 0.8 })

		expect(fetch).toHaveBeenCalledTimes(1)
		expect(first.calls.map((c) => c.cached)).toEqual([false, true])
		expect(later.calls[0]).toMatchObject({ cached: true, inputTokens: 100 })
		expect(later.calls[0]!.cost).toBeCloseTo(0.0000042, 10)
	})

	it("asks again when the request changes", async () => {
		const models = new Models(dir, { typesafe: "test-key" })
		await models.jev("sort", "An article", { cats: question })
		await models.jev("sort", "Another article", { cats: question })
		await models.jev("sort", "An article", { cats: { ...question, instructions: "Cats?" } })
		expect(fetch).toHaveBeenCalledTimes(3)
	})

	it("fails at once without a key, instead of retrying", async () => {
		const models = new Models(dir, {})
		const started = Date.now()
		await expect(models.jev("sort", "An article", { cats: question })).rejects.toThrow(
			"TYPESAFE_API_KEY is not set",
		)
		expect(Date.now() - started).toBeLessThan(1000)
		expect(fetch).not.toHaveBeenCalled()
	})
})
