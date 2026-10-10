import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { generatedModule, OUTPUT } from "../../scripts/build-page.mjs"

describe("reader-page.generated.ts", () => {
	it("is the bundle of src/page as it is now (run `pnpm build:page` when this fails)", async () => {
		expect(readFileSync(OUTPUT, "utf8") === (await generatedModule())).toBe(true)
	})
})
