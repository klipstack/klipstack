import { describe, expect, it } from "vitest"
import { welcomeFrom } from "./index"

const signer = { WELCOME_FROM_NAME: "Ernesto", WELCOME_FROM_EMAIL: "ernesto@example.com" }

describe("welcomeFrom", () => {
	it("is off unless both the name and the address are set", () => {
		expect(welcomeFrom({})).toBeNull()
		expect(welcomeFrom({ WELCOME_FROM_NAME: "Ernesto" })).toBeNull()
		expect(welcomeFrom({ WELCOME_FROM_EMAIL: "ernesto@example.com" })).toBeNull()
		expect(
			welcomeFrom({ WELCOME_FROM_NAME: "  ", WELCOME_FROM_EMAIL: "ernesto@example.com" }),
		).toBeNull()
	})

	it("signs with the name, the address and the photo, trimmed", () => {
		expect(welcomeFrom({ ...signer, WELCOME_FROM_NAME: " Ernesto " })).toEqual({
			name: "Ernesto",
			email: "ernesto@example.com",
			photo: null,
		})
		expect(welcomeFrom({ ...signer, WELCOME_FROM_PHOTO: "/ernesto.jpg" })?.photo).toBe(
			"/ernesto.jpg",
		)
		expect(welcomeFrom({ ...signer, WELCOME_FROM_PHOTO: "https://example.com/e.jpg" })?.photo).toBe(
			"https://example.com/e.jpg",
		)
	})

	it("refuses an address that is not one, and a photo from anywhere but https or the app", () => {
		expect(() => welcomeFrom({ ...signer, WELCOME_FROM_EMAIL: "ernesto" })).toThrow(
			"WELCOME_FROM_EMAIL",
		)
		for (const photo of [
			"http://example.com/e.jpg",
			"//example.com/e.jpg",
			"javascript:alert(1)",
			"e.jpg",
		])
			expect(() => welcomeFrom({ ...signer, WELCOME_FROM_PHOTO: photo })).toThrow(
				"WELCOME_FROM_PHOTO",
			)
	})
})
