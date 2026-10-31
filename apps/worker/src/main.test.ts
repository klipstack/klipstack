import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// Importing main.ts starts the worker, so this reads its source: the call that gives the worker its
// statement limit must run when the module loads, before main() can send a query.
const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8")

describe("the worker's start", () => {
	it("takes the worker's database limits at load, before main() runs", () => {
		const call = source.search(/^setDatabaseProcess\("worker"\)$/m)
		expect(call).toBeGreaterThan(-1)
		expect(call).toBeLessThan(source.search(/^async function main\(\)/m))
	})
})
