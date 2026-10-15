import { describe, expect, it } from "vitest"
import { cn } from "./utils"

describe("cn", () => {
	it("lets a chip replace a button's own padding and corners, and keeps what comes after it", () => {
		expect(cn("rounded-md p-1.5 text-muted-fg", "chip")).toBe("text-muted-fg chip")
		expect(cn("chip", "marked", "self-stretch px-2")).toBe("chip marked self-stretch px-2")
	})
})
