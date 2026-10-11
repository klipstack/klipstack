import { describe, expect, it } from "vitest"
import { namespaces, resources, supportedLanguages } from "./index"

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
	return Object.entries(obj).flatMap(([k, v]) =>
		typeof v === "object" && v !== null
			? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
			: [`${prefix}${k}`],
	)
}

describe("locales", () => {
	it("namespaces lists the english namespaces", () => {
		expect(namespaces).toEqual(Object.keys(resources.en))
	})
	it("every locale has the same keys as english", () => {
		const enKeys = flatten(resources.en).sort()
		for (const lng of supportedLanguages) {
			expect(flatten(resources[lng]).sort()).toEqual(enKeys)
		}
	})
	it("interpolation placeholders match english", () => {
		const placeholders = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort()
		const walk = (a: unknown, b: unknown, path: string) => {
			if (typeof a === "string" && typeof b === "string") {
				expect(placeholders(b), path).toEqual(placeholders(a))
			} else if (a && b && typeof a === "object" && typeof b === "object") {
				for (const k of Object.keys(a))
					walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`)
			}
		}
		for (const lng of supportedLanguages) walk(resources.en, resources[lng], lng)
	})
})
