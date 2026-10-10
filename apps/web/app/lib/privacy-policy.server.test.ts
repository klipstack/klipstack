import { describe, expect, it } from "vitest"
import { type PolicyBlock, policies, privacyPolicy } from "./privacy-policy.server"

const shape = (blocks: PolicyBlock[]) =>
	blocks.map((block) => (typeof block === "string" ? "p" : `list:${block.list.length}`))

describe("privacy policy", () => {
	it("says the same things in every language", () => {
		const { en, ...others } = policies
		for (const policy of Object.values(others)) {
			expect(policy.email).toBe(en.email)
			expect(policy.sections.map((s) => s.id)).toEqual(en.sections.map((s) => s.id))
			policy.sections.forEach((section, i) => {
				expect(shape(section.blocks), section.id).toEqual(shape(en.sections[i]?.blocks ?? []))
			})
		}
	})

	it("falls back to English for other languages", () => {
		expect(privacyPolicy("fr")).toBe(policies.en)
		expect(privacyPolicy("es")).toBe(policies.es)
	})
})
