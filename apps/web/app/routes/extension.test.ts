import { describe, expect, it, vi } from "vitest"
import { loader } from "./extension"

vi.mock("~/lib/session.server", () => ({ getSession: () => null }))
vi.mock("~/lib/i18n.server", async () => {
	const { createInstance } = await import("i18next")
	const { resources } = await import("@klipstack/i18n")
	const i18n = createInstance()
	await i18n.init({ resources, fallbackLng: "en", interpolation: { escapeValue: false } })
	return { getInstance: () => i18n }
})
const server = vi.hoisted(() => ({ appUrl: "https://klipstack.com" }))
vi.mock("~/lib/env.server", async (original) => {
	const actual = await original<typeof import("~/lib/env.server")>()
	return {
		...actual,
		env: new Proxy(actual.env, {
			get: (target, key) => (key === "APP_URL" ? server.appUrl : Reflect.get(target, key)),
		}),
	}
})

const page = (headers: Record<string, string> = {}) =>
	loader({
		request: new Request("http://localhost/extension", { headers }),
		context: {},
		params: {},
	} as never)

const chrome = { "sec-ch-ua": '"Chromium";v="142"', "sec-ch-ua-mobile": "?0" }
const safari = {
	"user-agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
}

describe("the extension page", () => {
	it("offers klipstack.com's readers the stores, and knows the visitor's browser", () => {
		const page_ = page(chrome)
		expect(page_.stores).toBe(true)
		expect(page_.chromeStore).toMatch(/^https:\/\/chromewebstore\.google\.com\/detail\//)
		// Not in the Mac App Store yet: the page says it is coming.
		expect(page_.safariStore).toBeNull()
		expect(page_.browser).toBe("chrome")
		expect(page(safari).browser).toBe("safari")
		expect(
			page({ "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Firefox/144.0" }).browser,
		).toBeNull()
	})

	it("leads another server's readers to the source: the stores' extensions save to klipstack.com only", () => {
		server.appUrl = "https://read.example.com"
		try {
			const page_ = page(chrome)
			expect(page_.stores).toBe(false)
			expect(page_.url).toBe("https://read.example.com/extension")
		} finally {
			server.appUrl = "https://klipstack.com"
		}
	})
})
