import { describe, expect, it, vi } from "vitest"
import { describeError, errorLabel, logError, loggedHost, loggedPath, safeFields } from "./index"

describe("describeError", () => {
	it("logs names, codes and frames, never the message", () => {
		const failure = new Error(
			"Failed query: update documents set note = $1\nparams: my secret note",
		)
		Object.assign(failure, {
			cause: Object.assign(new Error("boom: my secret note"), { code: "22008" }),
		})
		const described = describeError(failure)
		expect(described).not.toContain("secret")
		expect(described).toMatch(/^Error cause=Error cause.code=22008\n {4}at /)
		expect(describeError("text")).toBe("non-Error thrown (string)")
		expect(describeError(new Error())).toMatch(/^Error\n {4}at /)
	})

	it("leaves out message lines that look like frames", () => {
		const pasted = new Error(
			"Failed query\nparams: see this\n    at secretFunction (/secret/file.ts:1:1)",
		)
		const log = describeError(pasted)
		expect(log).not.toContain("secret")
		expect(log).toMatch(/\n {4}at /)
	})

	it("drops the frames when the stack no longer matches the message", () => {
		const changed = new Error("hidden words\n    at leaked (/hidden/words.ts:1:1)")
		void changed.stack
		changed.message = "other"
		expect(describeError(changed)).toBe("Error")
		const odd = new Error("x")
		Object.defineProperty(odd, "message", { value: 42 })
		expect(describeError(odd)).toBe("Error")
		const noStack = new Error("x")
		Object.defineProperty(noStack, "stack", { value: { lines: ["at x"] } })
		expect(describeError(noStack)).toBe("Error")
	})

	it("never throws, and keeps names and codes short and plain", () => {
		const hostile = new Error("x")
		Object.defineProperty(hostile, "stack", {
			get() {
				throw new Error("no")
			},
		})
		Object.defineProperty(hostile, "code", {
			get() {
				throw new Error("no")
			},
		})
		expect(describeError(hostile)).toBe("Error")
		const noisy = Object.assign(new Error("x"), {
			name: "Name with secret words",
			code: "code with secret\nwords",
			cause: Object.assign(new Error("y"), { code: 42 }),
		})
		expect(describeError(noisy)).toMatch(/^Error cause=Error cause.code=42$/)
		const long = Object.assign(new Error("x"), { code: "x".repeat(41) })
		expect(describeError(long)).not.toContain("code=")
	})

	it("reads the code and status of better-auth's API errors", () => {
		const apiError = (body: unknown) =>
			Object.assign(new Error("secret@example.com"), {
				name: "APIError",
				status: "INTERNAL_SERVER_ERROR",
				statusCode: 500,
				body,
			})
		const failed = apiError({ code: "FAILED_TO_GET_SESSION", message: "secret@example.com" })
		expect(describeError(failed, { frames: false })).toBe(
			"APIError code=FAILED_TO_GET_SESSION status=500",
		)
		// Only plain constants: anything else in the body could be user data.
		for (const code of ["secret@example.com", "secretToken", "secret_token", `X${"_".repeat(60)}`])
			expect(errorLabel(apiError({ code }))).toBe("APIError status=500")
		expect(errorLabel(apiError(undefined))).toBe("APIError status=500")
		expect(errorLabel(apiError("secret"))).toBe("APIError status=500")
		const hostile = apiError(null)
		Object.defineProperty(hostile, "body", {
			get() {
				throw new Error("no")
			},
		})
		expect(errorLabel(hostile)).toBe("APIError status=500")
		// An own code wins, even when it is unusable.
		expect(errorLabel(Object.assign(apiError({ code: "BODY_CODE" }), { code: "own" }))).toBe(
			"APIError code=own status=500",
		)
		expect(errorLabel(Object.assign(apiError({ code: "BODY_CODE" }), { code: "a b" }))).toBe(
			"APIError status=500",
		)
	})
})

describe("loggedPath", () => {
	it("keeps only the path", () => {
		expect(loggedPath("/library?q=secret")).toBe("/library")
		expect(loggedPath("/login?oauthQuery=a%26b")).toBe("/login")
		expect(loggedPath("/api/v1/me")).toBe("/api/v1/me")
		expect(loggedPath("/read/x#frag")).toBe("/read/x")
	})
})

/** What Drizzle throws when a query fails: the parameters are in the message. */
function drizzleError(params: string) {
	class DrizzleQueryError extends Error {
		constructor(query: string, cause: unknown) {
			super(`Failed query: ${query}\nparams: ${params}`)
			this.cause = cause
			Error.captureStackTrace(this, DrizzleQueryError)
		}
	}
	return new DrizzleQueryError(
		'insert into "document_versions" ("html", "text") values ($1, $2)',
		Object.assign(new Error(`value too long for type: ${params}`), { code: "22001" }),
	)
}

describe("Drizzle errors", () => {
	it("never reach any output", () => {
		const error = drizzleError("secret page text, secret@example.com")
		const outputs = [
			describeError(error),
			errorLabel(error),
			JSON.stringify(safeFields({ documentId: "d1", error })),
			JSON.stringify(safeFields(error)),
		]
		for (const out of outputs) expect(out).not.toContain("secret")
		expect(errorLabel(error)).toBe("Error cause=Error cause.code=22001")
		const spy = vi.spyOn(console, "error").mockImplementation(() => {})
		logError("[job] failed", error)
		const logged = spy.mock.calls.flat().join("\n")
		spy.mockRestore()
		expect(logged).toMatch(/^\[job\] failed\nError cause=Error cause.code=22001\n {4}at /)
		expect(logged).not.toContain("secret")
	})
})

describe("log fields", () => {
	it("keep safe values, and name errors by their label", () => {
		const httpError = Object.assign(
			new Error("HTTP 404 for https://site.test/private?token=secret"),
			{
				name: "ExtractError",
				code: "http_error",
				status: 404,
			},
		)
		expect(safeFields({ feedId: "f1", count: 2, error: httpError })).toEqual({
			feedId: "f1",
			count: 2,
			error: "ExtractError code=http_error status=404",
		})
		expect(safeFields("plain")).toBe("plain")
		expect(safeFields(undefined)).toBeUndefined()
		expect(errorLabel(Object.assign(new Error("x"), { status: 999 }))).toBe("Error")
	})

	it("log a URL's host only", () => {
		expect(loggedHost("https://cdn.site.test/a.png?signature=secret")).toBe("cdn.site.test")
		expect(loggedHost("not a url")).toBe("(invalid url)")
	})
})
