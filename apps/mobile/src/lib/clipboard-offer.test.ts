import { describe, expect, it } from "vitest"
import { nextOffer } from "./clipboard-offer"

describe("nextOffer", () => {
	it("offers a new copy with a link", () => {
		expect(nextOffer(null, { count: 7, hasLink: true }, 3)).toBe(7)
		expect(nextOffer(null, { count: 7, hasLink: true }, null)).toBe(7)
	})

	it("keeps offering the same copy", () => {
		expect(nextOffer(7, { count: 7, hasLink: true }, 7)).toBe(7)
	})

	it("offers a copy once", () => {
		expect(nextOffer(null, { count: 7, hasLink: true }, 7)).toBeNull()
	})

	it("takes the card away when the link is gone", () => {
		expect(nextOffer(7, { count: 7, hasLink: false }, 7)).toBeNull()
		expect(nextOffer(7, { count: 8, hasLink: false }, 7)).toBeNull()
		expect(nextOffer(null, { count: 8, hasLink: false }, 7)).toBeNull()
	})

	it("moves to a newer copy with a link", () => {
		expect(nextOffer(7, { count: 9, hasLink: true }, 7)).toBe(9)
	})
})
