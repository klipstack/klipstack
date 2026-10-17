import { afterEach, describe, expect, it } from "vitest"
import { env } from "~/lib/env.server"
import { loader } from "./well-known.apple-app-site-association"

const configured = { APPLE_TEAM_ID: env.APPLE_TEAM_ID, APPLE_BUNDLE_ID: env.APPLE_BUNDLE_ID }
afterEach(() => Object.assign(env, configured))

describe("the apple-app-site-association file", () => {
	it("lets the configured app open only its sign-in callback", async () => {
		Object.assign(env, { APPLE_TEAM_ID: "AB12CD34EF", APPLE_BUNDLE_ID: "com.example.reader" })
		const response = loader()
		expect(response.status).toBe(200)
		expect(response.headers.get("Content-Type")).toMatch(/^application\/json/)
		expect(await response.json()).toEqual({
			applinks: {
				details: [
					{
						appIDs: ["AB12CD34EF.com.example.reader"],
						components: [{ "/": "/app/oauth/callback", comment: "The app's sign-in callback" }],
					},
				],
			},
			webcredentials: { apps: ["AB12CD34EF.com.example.reader"] },
		})
	})

	it("is not found without a team and a bundle", async () => {
		for (const config of [
			{ APPLE_TEAM_ID: undefined, APPLE_BUNDLE_ID: undefined },
			{ APPLE_TEAM_ID: "AB12CD34EF", APPLE_BUNDLE_ID: undefined },
			{ APPLE_TEAM_ID: undefined, APPLE_BUNDLE_ID: "com.example.reader" },
		]) {
			Object.assign(env, config)
			const response = loader()
			expect(response.status, JSON.stringify(config)).toBe(404)
			expect(await response.text()).not.toContain("applinks")
		}
	})
})
