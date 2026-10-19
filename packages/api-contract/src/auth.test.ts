import { describe, expect, it } from "vitest"
import { MOBILE_REDIRECT_URI, mobileRedirectUri, mobileRedirectUris } from "./auth"

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

describe("mobileRedirectUris", () => {
	it("refuses the custom scheme on https: any app could claim it and catch a sign-in", () => {
		expect(mobileRedirectUris("https://klipstack.com")).toEqual([
			"https://klipstack.com/app/oauth/callback",
		])
	})

	it("accepts the custom scheme on the http dev server, which the app signs in with", () => {
		expect(mobileRedirectUris("http://localhost:5180")).toEqual([
			"http://localhost:5180/app/oauth/callback",
			MOBILE_REDIRECT_URI,
		])
	})
})
