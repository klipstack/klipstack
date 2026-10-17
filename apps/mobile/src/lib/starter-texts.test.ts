import { KlipstackApiError, type StarterText } from "@klipstack/sdk"
import { describe, expect, it, vi } from "vitest"
import { starterLabel, starterRefusal } from "./starter-texts"

// The offline store is not under test: no files.
vi.mock("expo-file-system", () => ({}))

const text: StarterText = {
	slug: "poe-tell-tale-heart",
	kind: "text",
	language: "en",
	topic: "stories",
	title: "The Tell-Tale Heart",
	author: "Edgar Allan Poe",
	description: null,
	minutes: 12,
	site: null,
	articleId: null,
}

describe("starterLabel", () => {
	it("says whether a tap adds the text, from where, or opens the reader's copy", () => {
		expect(starterLabel(text)).toBe("Add The Tell-Tale Heart to your library")
		expect(starterLabel({ ...text, kind: "link", site: "paulgraham.com" })).toBe(
			"Add The Tell-Tale Heart to your library from paulgraham.com",
		)
		expect(
			starterLabel({ ...text, articleId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", site: "x.com" }),
		).toBe("Open The Tell-Tale Heart")
	})
})

describe("starterRefusal", () => {
	it("tells being offline apart from the server's refusal", () => {
		expect(starterRefusal(new TypeError("fetch failed: Could not connect to the server"))).toBe(
			"Can't reach Klipstack. Connect to the internet to add it.",
		)
		const capped = new KlipstackApiError(
			403,
			"limit_reached",
			"You have saved 500 articles this month, the most an account can.",
		)
		expect(starterRefusal(capped)).toBe(
			"You have saved 500 articles this month, the most an account can.",
		)
	})
})
