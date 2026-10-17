import { afterEach, describe, expect, it } from "vitest"
import { documentPolicy } from "./csp.server"
import { env } from "./env.server"

const configured = env.SUPPYHQ_TENANT
afterEach(() => Object.assign(env, { SUPPYHQ_TENANT: configured }))

const scriptSources = (policy: string) =>
	/script-src ([^;]+)/.exec(policy)?.[1]?.split(" ").filter(Boolean)

describe("the page's script policy", () => {
	it("adds SuppyHQ only to a signed-in page on a server with a SuppyHQ account", () => {
		Object.assign(env, { SUPPYHQ_TENANT: "klipstack" })
		expect(scriptSources(documentPolicy("n0nce", { signedIn: true }))).toEqual([
			"'self'",
			"'nonce-n0nce'",
			"https://app.suppyhq.com",
		])
		expect(scriptSources(documentPolicy("n0nce", { signedIn: false }))).toEqual([
			"'self'",
			"'nonce-n0nce'",
		])
	})

	it("runs only this origin's scripts on a server without one", () => {
		Object.assign(env, { SUPPYHQ_TENANT: undefined })
		const policy = documentPolicy("n0nce", { signedIn: true })
		expect(scriptSources(policy)).toEqual(["'self'", "'nonce-n0nce'"])
		expect(policy).toContain("frame-ancestors 'none'")
	})
})
