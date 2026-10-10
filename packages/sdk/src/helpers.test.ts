import { describe, expect, it } from "vitest"
import { KlipstackBatchError, KlipstackInputError } from "./errors"
import { batched, chunk, paginate } from "./helpers"

describe("paginate", () => {
	it("follows nextCursor until it is null", async () => {
		const pages: Record<string, { items: number[]; nextCursor: string | null }> = {
			first: { items: [1, 2], nextCursor: "c2" },
			c2: { items: [3], nextCursor: "c3" },
			c3: { items: [], nextCursor: null },
		}
		const asked: (string | undefined)[] = []
		const all: number[] = []
		for await (const n of paginate((cursor) => {
			asked.push(cursor)
			return Promise.resolve(pages[cursor ?? "first"]!)
		}))
			all.push(n)
		expect(all).toEqual([1, 2, 3])
		expect(asked).toEqual([undefined, "c2", "c3"])
	})
})

describe("batched", () => {
	it("splits ids into requests of 100, drops duplicates, and merges the results", async () => {
		const ids = Array.from({ length: 240 }, (_, i) => `id-${i % 220}`)
		const sizes: number[] = []
		const result = await batched(ids, (part) => {
			sizes.push(part.length)
			return Promise.resolve({ updated: part.slice(0, 2), notFound: part.slice(2, 3) })
		})
		expect(sizes).toEqual([100, 100, 20])
		expect(result.updated).toHaveLength(6)
		expect(result.notFound).toEqual(["id-2", "id-102", "id-202"])
	})

	it("refuses an empty batch before sending anything", async () => {
		let sent = 0
		const error = await batched([], () => {
			sent++
			return Promise.resolve({ updated: [] })
		}).catch((e: unknown) => e)
		expect(error).toBeInstanceOf(KlipstackInputError)
		expect((error as KlipstackInputError).issues[0]?.path).toEqual(["ids"])
		expect(sent).toBe(0)
	})

	it("keeps what earlier requests did when a later one fails", async () => {
		const ids = Array.from({ length: 240 }, (_, i) => `id-${i}`)
		const failure = new Error("rate limited")
		const error = await batched(ids, (part) =>
			part[0] === "id-100" ? Promise.reject(failure) : Promise.resolve({ trashed: part }),
		).catch((e: unknown) => e)
		expect(error).toBeInstanceOf(KlipstackBatchError)
		const batch = error as KlipstackBatchError<{ trashed: string[] }>
		expect(batch.cause).toBe(failure)
		expect(batch.completed.trashed).toEqual(ids.slice(0, 100))
		expect(batch.unsent).toEqual(ids.slice(100))
		// A failure on the first request is thrown as it is.
		await expect(batched(ids, () => Promise.reject(failure))).rejects.toBe(failure)
	})

	it("chunks exactly", () => {
		expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]])
		expect(chunk([], 2)).toEqual([])
	})
})
