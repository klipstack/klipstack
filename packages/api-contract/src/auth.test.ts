import { describe, expect, it } from "vitest"
import { MOBILE_REDIRECT_URI, mobileRedirectUri } from "./auth"

describe("mobileRedirectUri", () => {
	it("is the server's universal link on https: no other app can open it", () => {
		expect(mobileRedirectUri("https://klipstack.com")).toBe(
			"https://klipstack.com/app/oauth/callback",
		)
		expect(mobileRedirectUri("https://klipstack.com/")).toBe(
			"https://klipstack.com/app/oauth/callback",
		)
		expect(mobileRedirectUri("https://read.example.com")).toBe(
			"https://read.example.com/app/oauth/callback",
		)
	})

	it("is the custom scheme on the http dev server, where a universal link can't work", () => {
		expect(mobileRedirectUri("http://localhost:5180")).toBe(MOBILE_REDIRECT_URI)
	})
})
