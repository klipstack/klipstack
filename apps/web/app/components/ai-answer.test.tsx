import { describe, expect, it } from "vitest"
import { answerLead } from "./ai-answer"

describe("answerLead", () => {
	it("is the bold sentence the answer opens with", () => {
		expect(answerLead("**Makers need whole afternoons.** One meeting. **Not this.**")).toBe(
			"Makers need whole afternoons.",
		)
	})

	it("is the first sentence of an answer that doesn't open in bold", () => {
		expect(answerLead("It costs 3.5 hours, *not* one. The rest follows.")).toBe(
			"It costs 3.5 hours, not one.",
		)
		expect(answerLead("Mid-way through the answer **a bold word**. More.")).toBe(
			"Mid-way through the answer a bold word.",
		)
	})

	it("is what is written so far while the bold sentence is still coming", () => {
		expect(answerLead("**Makers need who")).toBe("Makers need who")
	})
})
