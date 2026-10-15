import { briefSystemPrompt } from "@klipstack/ai"
import { describe, expect, it } from "vitest"
import { BRIEF_SECTIONS, briefSection, briefSummary } from "./brief"

describe("brief", () => {
	it("knows every heading the model is told to write, in both languages", () => {
		for (const language of ["en", "es"] as const)
			for (const heading of Object.keys(BRIEF_SECTIONS))
				expect(briefSystemPrompt(language)).toContain(`"## ${heading}"`)
		expect(briefSection(" Keep in mind")).toBe("caveats")
		expect(briefSection("Puntos clave")).toBeNull()
	})

	it("sums up a brief with sections by its gist", () => {
		const text = "It argues X.\nIt matters.\n\n## Key claims\n\n1. One.\n\n## Parts\n\n- **A**: a."
		expect(briefSummary(text)).toBe("It argues X.\nIt matters.")
	})

	it("sums up a brief of three bullets, written before the sections, by its bullets", () => {
		expect(briefSummary("- One.\n- Two.\n\n- Three.")).toBe("One. Two. Three.")
	})
})
