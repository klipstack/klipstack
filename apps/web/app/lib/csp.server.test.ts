import { RouterContextProvider } from "react-router"
import { describe, expect, it } from "vitest"
import {
	allowFormTargets,
	BASE_POLICY,
	createNonce,
	documentPolicy,
	formActionSource,
	formTargetsOf,
} from "./csp.server"

/** The directives of a policy, by name. */
function directives(policy: string) {
	return new Map(
		policy
			.split(";")
			.map((part) => part.trim().split(/\s+/))
			.filter((words) => words[0])
			.map(([name, ...values]) => [name, values.join(" ")]),
	)
}

describe("documentPolicy", () => {
	it("keeps the base policy and runs only this origin's scripts and the page's nonce", () => {
		const policy = directives(documentPolicy("abc123=="))
		for (const [name, value] of directives(BASE_POLICY)) expect(policy.get(name)).toBe(value)
		expect(policy.get("script-src")).toBe("'self' 'nonce-abc123=='")
	})

	it("lets forms post only to this origin", () => {
		// Injected markup that got past the sanitizer could not post credentials to another site.
		expect(directives(documentPolicy(createNonce())).get("form-action")).toBe("'self'")
	})

	it("adds the origins a page's own forms are sent on to", () => {
		const policy = directives(
			documentPolicy("n", ["https://accounts.google.com", "http://127.0.0.1:47123"]),
		)
		expect(policy.get("form-action")).toBe(
			"'self' https://accounts.google.com http://127.0.0.1:47123",
		)
	})
})

describe("form targets", () => {
	it("are an address's origin, or an app's own scheme", () => {
		expect(formActionSource("http://127.0.0.1:47123/callback?x=1")).toBe("http://127.0.0.1:47123")
		expect(formActionSource("https://accounts.google.com/o/oauth2/v2/auth")).toBe(
			"https://accounts.google.com",
		)
		expect(formActionSource("com.klipstack.app:/oauth/callback")).toBe("com.klipstack.app:")
	})

	it("are never a scheme that runs or embeds what follows it, nor a relative address", () => {
		for (const url of [
			"javascript:alert(1)",
			"data:text/html,x",
			"blob:https://example.com/1",
			"about:blank",
			"file:///etc/passwd",
			"/settings",
			"not a url",
		])
			expect(formActionSource(url), url).toBeNull()
	})

	it("collect in the request's context, for the page's policy", () => {
		const context = new RouterContextProvider()
		expect(formTargetsOf(context)).toEqual([])
		allowFormTargets(context, ["https://github.com/login/oauth/authorize", null, "javascript:x"])
		allowFormTargets(context, ["http://127.0.0.1:47123/cb"])
		expect(formTargetsOf(context)).toEqual(["https://github.com", "http://127.0.0.1:47123"])
		// Another request starts with none.
		expect(formTargetsOf(new RouterContextProvider())).toEqual([])
	})
})

describe("BASE_POLICY", () => {
	it("forbids framing, <base> rewrites and plugins on every response", () => {
		const policy = directives(BASE_POLICY)
		expect(policy.get("frame-ancestors")).toBe("'none'")
		expect(policy.get("base-uri")).toBe("'self'")
		expect(policy.get("object-src")).toBe("'none'")
	})
})
