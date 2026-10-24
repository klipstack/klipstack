import { describe, expect, it } from "vitest"
import { extensionUrl, safariMac } from "./extension-url"

describe("extensionUrl", () => {
	it("leads to the server's own extension page, which offers each browser its store", () => {
		expect(extensionUrl("https://klipstack.com")).toBe("https://klipstack.com/extension")
		expect(extensionUrl("http://localhost:5180/")).toBe("http://localhost:5180/extension")
	})
})

describe("safariMac", () => {
	const agent = (ua: string) => new Headers({ "user-agent": ua })
	const mac =
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"

	it("knows Safari on a Mac", () => {
		expect(safariMac(agent(`${mac} Version/26.0 Safari/605.1.15`))).toBe(true)
	})

	it("refuses the other Mac browsers that also say Safari, and Safari on an iPhone", () => {
		for (const ua of [
			`${mac} Chrome/142.0.0.0 Safari/537.36`,
			`${mac} Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0`,
			`${mac} Chrome/142.0.0.0 Safari/537.36 OPR/120.0.0.0`,
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0",
			"Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
		])
			expect(safariMac(agent(ua)), ua).toBe(false)
	})
})
