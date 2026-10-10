import { BATCH_MAX } from "@klipstack/api-contract"
import { KlipstackBatchError, KlipstackInputError } from "./errors"

/** Pagination and batching, shared by the facade methods. */

export interface Page<T> {
	items: T[]
	nextCursor: string | null
}

/** Every item, page after page, following `nextCursor` until it is null. */
export async function* paginate<T>(
	fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): AsyncGenerator<T, void, undefined> {
	let cursor: string | undefined
	do {
		const page = await fetchPage(cursor)
		yield* page.items
		cursor = page.nextCursor ?? undefined
	} while (cursor)
}

/** Most ids one batch request takes; the server drops duplicates. */
export const BATCH_SIZE = BATCH_MAX

export function chunk<T>(items: readonly T[], size = BATCH_SIZE): T[][] {
	const out: T[][] = []
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
	return out
}

type Arrays = Record<string, unknown[]>

/**
 * Runs one request per chunk of ids (duplicates dropped) and concatenates every array field of
 * the results. No ids is an input error, as it is for the endpoints. When a request fails after
 * others succeeded, the error is a KlipstackBatchError that keeps their results.
 */
export async function batched<R extends Arrays>(
	ids: readonly string[],
	request: (ids: string[]) => Promise<R>,
	field = "ids",
): Promise<R> {
	const unique = [...new Set(ids)]
	if (unique.length === 0)
		throw new KlipstackInputError("body", [
			{ code: "custom", path: [field], message: `Pass at least one of ${field}.`, input: [] },
		])
	const merged: Arrays = {}
	const parts = chunk(unique)
	for (const [index, part] of parts.entries()) {
		let result: R
		try {
			result = await request(part)
		} catch (error) {
			if (index === 0) throw error
			throw new KlipstackBatchError(error, merged as R, parts.slice(index).flat())
		}
		for (const [key, value] of Object.entries(result)) {
			merged[key] = [...(merged[key] ?? []), ...value]
		}
	}
	return merged as R
}
