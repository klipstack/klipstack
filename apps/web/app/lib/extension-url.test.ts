import { describe, expect, it } from "vitest"
import { desktopBrowser, extensionUrl, safariMac } from "./extension-url"

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

describe("desktopBrowser", () => {
	const ask = (userAgent: string, hints: Record<string, string> = {}) =>
		desktopBrowser(new Headers({ "user-agent": userAgent, ...hints }))

	it("tells Safari and Firefox on a computer from the browsers that also say Safari", () => {
		expect(
			ask(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
			),
		).toBe("safari")
		expect(
			ask("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0"),
		).toBe("firefox")
		expect(
			ask("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0"),
		).toBe("firefox")
		const chrome =
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
		expect(
			ask(chrome, {
				"sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130"',
				"sec-ch-ua-mobile": "?0",
			}),
		).toBe("chromium")
		// Without its hints (on plain HTTP, say), Chrome is not taken for Safari.
		expect(ask(chrome)).toBeNull()
	})

	it("names no browser on a phone", () => {
		expect(
			ask(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
			),
		).toBeNull()
		expect(ask("Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0")).toBeNull()
	})
})
