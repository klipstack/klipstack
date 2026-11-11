import { describe, expect, it } from "vitest"
import type { PendingSignIn } from "./oauth"
import { type SignIn, type SignInEvent, signInStart, signInTransition } from "./sign-in-machine"

type Kind = "apple" | "email" | "code" | "twoFactor"

function run(state: SignIn<Kind>, ...events: SignInEvent<Kind>[]): SignIn<Kind> {
	return events.reduce(signInTransition, state)
}

const pending: PendingSignIn = { apiUrl: "http://x", token: "t", verifier: "v", challenge: "c" }
const start = signInStart<Kind>()
const codeSent = run(start, { type: "start", kind: "code" }, { type: "codeSent", email: "a@b.c" })
const twoFactor = run(
	codeSent,
	{ type: "start", kind: "email" },
	{ type: "twoFactorRequired", pending },
)

describe("signing in", () => {
	it("runs one thing at a time: a second tap while one runs changes nothing", () => {
		const busy = run(start, { type: "start", kind: "apple" })
		expect(busy).toMatchObject({ busy: "apple" })
		expect(signInTransition(busy, { type: "start", kind: "email" })).toBe(busy)
		// …nor does a check of what was typed: the running request keeps its spinner.
		expect(signInTransition(busy, { type: "invalid", message: "Enter it" })).toBe(busy)
	})

	it("clears the last error when something starts, and says the next one", () => {
		const failed = run(start, { type: "start", kind: "email" }, { type: "failed", message: "No" })
		expect(failed).toMatchObject({ busy: null, error: "No" })
		expect(run(failed, { type: "start", kind: "apple" })).toMatchObject({ error: null })
	})

	it("takes the emailed code for its address only", () => {
		expect(codeSent).toMatchObject({ step: "credentials", codeSentTo: "a@b.c", busy: null })
		expect(run(codeSent, { type: "emailChanged", email: " a@b.c " })).toBe(codeSent)
		expect(run(codeSent, { type: "emailChanged", email: "a@b.co" })).toMatchObject({
			codeSentTo: null,
		})
		expect(run(codeSent, { type: "usePassword" })).toMatchObject({ codeSentTo: null })
	})

	it("asks for the authenticator's code, and a wrong one keeps the step", () => {
		expect(twoFactor).toEqual({ step: "twoFactor", pending, busy: null, error: null })
		const wrong = run(
			twoFactor,
			{ type: "start", kind: "twoFactor" },
			{ type: "failed", message: "Wrong" },
		)
		expect(wrong).toEqual({ step: "twoFactor", pending, busy: null, error: "Wrong" })
	})

	it("starts over after the code step, without the emailed code it spent", () => {
		expect(run(twoFactor, { type: "back" })).toEqual(start)
		const ended = run(
			twoFactor,
			{ type: "start", kind: "twoFactor" },
			{ type: "ended", message: "Over" },
		)
		expect(ended).toEqual({ ...start, error: "Over" })
	})

	it("doesn't go back while the code is being checked", () => {
		const checking = run(twoFactor, { type: "start", kind: "twoFactor" })
		expect(signInTransition(checking, { type: "back" })).toBe(checking)
	})

	it("signs in from the code step", () => {
		const done = run(twoFactor, { type: "start", kind: "twoFactor" }, { type: "finished" })
		expect(done).toMatchObject({ step: "twoFactor", busy: null, error: null })
	})
})
