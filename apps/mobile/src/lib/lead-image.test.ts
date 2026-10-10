import { describe, expect, it } from "vitest"
import { leadImageSource } from "./lead-image"

const api = "https://klipstack.com"
const headers = { authorization: "Bearer t" }
const stored = {
	url: "https://klipstack.com/assets/a",
	downloadUrl: "https://klipstack.com/api/v1/assets/a",
}

describe("leadImageSource", () => {
	it("loads a stored copy through the API, with the token", () => {
		expect(leadImageSource(stored, api, headers)).toEqual({ uri: stored.downloadUrl, headers })
	})

	it("sends the token nowhere but the app's own server", () => {
		const elsewhere = { ...stored, downloadUrl: "https://evil.example/api/v1/assets/a" }
		expect(leadImageSource(elsewhere, api, headers)).toBeNull()
	})

	it("waits for the token before loading a stored copy", () => {
		expect(leadImageSource(stored, api, null)).toBeNull()
	})

	it("loads a site's own image from the site, without the token", () => {
		const site = { url: "https://example.com/a.jpg", downloadUrl: null }
		expect(leadImageSource(site, api, headers)).toEqual({ uri: site.url })
		expect(leadImageSource({ ...site, url: "http://example.com/a.jpg" }, api, headers)).toBeNull()
	})

	it("has nothing for an article without a picture", () => {
		expect(leadImageSource(null, api, headers)).toBeNull()
		expect(leadImageSource(undefined, api, headers)).toBeNull()
	})
})
